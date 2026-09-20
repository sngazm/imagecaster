import { Hono } from "hono";
import type {
  Env,
  ClipDraft,
  ClipDraftCard,
  ClipDraftSub,
  ClipIndex,
  ClipLayoutName,
  ClipMeta,
  ClipPost,
  ClipPostTarget,
  ClipSpan,
  PendingClip,
} from "../types";
import {
  CLIP_DEFAULT_SPEED,
  CLIP_LAYOUTS,
  CLIP_POST_TARGETS,
  CLIP_SPEED_RANGE,
} from "../types";
import {
  createPresignedUrl,
  findEpisodeBySlug,
  getIndex,
  listAllEpisodes,
  saveIndex,
} from "../services/r2";

/**
 * 切り抜き動画の API。
 *
 * 描画はここではできない。ffmpeg も素材も手元（WSL）にある。一方、確かめて直すのに
 * 描画は要らないので、下書き（字幕と時刻の並び）を R2 に置いてもらい、管理画面が
 * それを音声と一緒にプレビューして直す。OK が出たら手元が拾って 3 本描く。
 * R2 を共有の置き場にするのは、音声・書き起こしと同じ考え方で、新しい経路を
 * 増やさないため。
 *
 * 詳しくは docs/clip-viewer-spec.md を参照。
 */

const clipsPrefix = (storageKey: string) => `episodes/${storageKey}/clips`;

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const obj = await env.R2_BUCKET.get(key);
  if (!obj) return null;
  return JSON.parse(await obj.text()) as T;
}

async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  await env.R2_BUCKET.put(key, JSON.stringify(value, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** 投稿先ごとの既定のレイアウト。縦長を受ける先には縦、タイムラインに流れる先には収まりのよい形 */
const DEFAULT_POST_LAYOUT: Record<ClipPostTarget, ClipLayoutName> = {
  bluesky: "square",
  x: "landscape",
  youtube: "portrait",
  instagram: "portrait",
};

function defaultPosts(): Record<ClipPostTarget, ClipPost> {
  return Object.fromEntries(
    CLIP_POST_TARGETS.map((t) => [
      t,
      { enabled: true, layout: DEFAULT_POST_LAYOUT[t], postedAt: null, url: null, error: null },
    ])
  ) as Record<ClipPostTarget, ClipPost>;
}

/**
 * 下書きより前に作られた meta には、あとから足した項目が無い。読むたびに補う
 */
function normalize(clip: ClipMeta): ClipMeta {
  return {
    ...clip,
    approvedRevision: clip.approvedRevision ?? null,
    publishAt: clip.publishAt ?? null,
    postText: clip.postText ?? "",
    posts: { ...defaultPosts(), ...(clip.posts ?? {}) },
  };
}

async function readClip(env: Env, storageKey: string, clipId: string): Promise<ClipMeta | null> {
  const clip = await readJson<ClipMeta>(env, `${clipsPrefix(storageKey)}/${clipId}/meta.json`);
  return clip ? normalize(clip) : null;
}

/**
 * 一覧を meta から作り直す。
 *
 * index.json は meta.json の写しなので、meta を書いたら必ず揃える。ずれると
 * 一覧に出ないものが出てくる。
 */
async function refreshIndex(env: Env, storageKey: string, meta: ClipMeta): Promise<void> {
  const key = `${clipsPrefix(storageKey)}/index.json`;
  const index = (await readJson<ClipIndex>(env, key)) ?? { clips: [] };
  const entry = {
    id: meta.id,
    label: meta.label,
    latest: meta.latest,
    status: meta.status,
  };
  const at = index.clips.findIndex((c) => c.id === meta.id);
  if (at >= 0) index.clips[at] = entry;
  else index.clips.push(entry);
  await writeJson(env, key, index);
}

/** まだ出していない投稿先があるか */
function hasUnposted(clip: ClipMeta): boolean {
  if (!clip.publishAt) return false;
  return CLIP_POST_TARGETS.some((t) => clip.posts[t].enabled && !clip.posts[t].postedAt);
}

const waitsForRender = (clip: ClipMeta) => clip.status === "approved";
const waitsForPost = (clip: ClipMeta) => clip.status === "rendered" && hasUnposted(clip);

/**
 * 描画待ち・投稿待ちの索引を、index.json の中で更新する。
 *
 * 手元の道具は 1 時間おきに /api/clips/pending を叩き、Cron は 5 分おきに投稿待ちを
 * 見る。全エピソードの meta.json を読んでから各回の clips/index.json を読む作りだと、
 * 1 リクエストで 500 回以上 R2 を読むことになり、Worker のリソース制限（Error 1102）に
 * 達する。文字起こしキューが同じ形で一度詰まっているので、同じ手当て
 * （transcriptionQueueIds）をそのまま持ってきている。
 *
 * 索引が未構築（undefined）なら何もしない。全件走査による初期化は巡回側が担う。
 */
async function syncQueues(env: Env, clip: ClipMeta): Promise<void> {
  const index = await getIndex(env);
  if (index.clipRenderIds === undefined) return;

  const key = `${clip.episodeId}/${clip.id}`;
  const before = JSON.stringify([index.clipRenderIds, index.clipPostIds]);

  const put = (ids: string[] | undefined, listed: boolean) => {
    const rest = (ids ?? []).filter((k) => k !== key);
    return listed ? [...rest, key] : rest;
  };
  index.clipRenderIds = put(index.clipRenderIds, waitsForRender(clip));
  index.clipPostIds = put(index.clipPostIds, waitsForPost(clip));

  // 変わっていなければ index.json を書き換えない
  if (JSON.stringify([index.clipRenderIds, index.clipPostIds]) === before) return;
  await saveIndex(env, index);
}

async function saveClip(env: Env, storageKey: string, clip: ClipMeta): Promise<void> {
  await writeJson(env, `${clipsPrefix(storageKey)}/${clip.id}/meta.json`, clip);
  await refreshIndex(env, storageKey, clip);
  await syncQueues(env, clip);
}

// ---------------------------------------------------------------------------
// 下書きの検算
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 字数。生成側（Python）と同じくコードポイントで数える。length だとサロゲートで食い違う */
const charCount = (s: string) => [...s].length;

/** 生成側が決めるもの。管理画面からは変えられない */
const FIXED_BY_GENERATOR = ["gap", "edgeFade", "lead", "trail", "audio", "pool"] as const;

type DraftBody = Omit<ClipDraft, "revision">;

const isRange = (r: unknown): r is { start: number; end: number } =>
  !!r && isNum((r as ClipSpan).start) && isNum((r as ClipSpan).end) && (r as ClipSpan).start < (r as ClipSpan).end;

/**
 * 下書きとして形が成り立っているか。成り立っていなければ理由を返す
 */
function draftProblem(draft: DraftBody): string | null {
  const { speed, gap, edgeFade, lead, trail, audio, pool, spans, subs, cards } = draft;
  if (!isNum(speed) || speed < CLIP_SPEED_RANGE[0] || speed > CLIP_SPEED_RANGE[1]) {
    return `speed は ${CLIP_SPEED_RANGE[0]}〜${CLIP_SPEED_RANGE[1]} の数です`;
  }
  if (!isNum(gap) || gap < 0 || gap > 5) return "gap は 0〜5 秒の数です";
  if (!isNum(edgeFade) || edgeFade < 0 || edgeFade > 0.5) return "edgeFade は 0〜0.5 秒の数です";
  if (!isNum(lead) || !isNum(trail) || lead < 0 || trail < 0 || lead > 2 || trail > 2) {
    return "lead / trail は 0〜2 秒の数です";
  }
  if (
    !audio ||
    typeof audio.format !== "string" ||
    ![audio.headerBytes, audio.bitrate, audio.sampleRate, audio.skipSamples].every(isNum)
  ) {
    return "audio が揃っていません";
  }
  if (!Array.isArray(pool) || pool.length === 0 || !pool.every(isRange)) {
    return "pool が範囲の並びになっていません";
  }

  if (!Array.isArray(spans) || spans.length === 0) return "spans が空です";
  const spanIds = new Set<string>();
  for (const [i, span] of spans.entries()) {
    const at = `spans[${i}]`;
    if (!span || typeof span.id !== "string" || !span.id) return `${at}: id がありません`;
    if (spanIds.has(span.id)) return `${at}: id が重なっています（${span.id}）`;
    spanIds.add(span.id);
    if (typeof span.group !== "string" || !span.group) return `${at}: group がありません`;
    if (!isRange(span)) return `${at}: start / end が範囲になっていません`;
    if (span.gap !== null && (!isNum(span.gap) || span.gap < 0 || span.gap > 5)) {
      return `${at}: gap は null か 0〜5 秒の数です`;
    }
    if (!pool.some((p) => span.start >= p.start && span.end <= p.end)) {
      return `${at}: pool の外に出ています`;
    }
  }
  const active = spans.filter((sp) => !sp.off).sort((a, b) => a.start - b.start);
  if (active.length === 0) return "鳴らす区間がひとつもありません";
  for (let i = 1; i < active.length; i++) {
    // 同じところを 2 回鳴らすと、その字幕がどちらの区間のものか決まらない
    if (active[i].start < active[i - 1].end) {
      return `区間が重なっています（${active[i - 1].id} と ${active[i].id}）`;
    }
  }

  if (!Array.isArray(subs) || subs.length === 0) return "subs が空です";

  const ids = new Set<string>();
  for (const [i, sub] of subs.entries()) {
    const at = `subs[${i}]`;
    if (!sub || typeof sub.id !== "string" || !sub.id) return `${at}: id がありません`;
    if (ids.has(sub.id)) return `${at}: id が重なっています（${sub.id}）`;
    ids.add(sub.id);
    if (typeof sub.speaker !== "string") return `${at}: speaker が文字列ではありません`;
    if (!isNum(sub.start) || !isNum(sub.end) || sub.start > sub.end) {
      return `${at}: start / end が範囲になっていません`;
    }
    if (typeof sub.of !== "string") return `${at}: of が文字列ではありません`;
    if (!Array.isArray(sub.chars) || !sub.chars.every(isNum)) {
      return `${at}: chars が数の並びではありません`;
    }
    if (sub.chars.length !== charCount(sub.of)) {
      return `${at}: chars の数（${sub.chars.length}）が of の字数（${charCount(sub.of)}）と合いません`;
    }
    if (!Array.isArray(sub.rows) || !sub.rows.every((r) => typeof r === "string")) {
      return `${at}: rows が文字列の並びではありません`;
    }
    if (typeof sub.skip !== "boolean") return `${at}: skip が真偽値ではありません`;
    if (!sub.skip && sub.rows.join("").trim() === "") {
      return `${at}: 出す字幕なのに文字がありません`;
    }
  }

  if (!Array.isArray(cards)) return "cards が並びではありません";
  for (const [i, card] of cards.entries()) {
    if (!card || !isNum(card.at) || typeof card.image !== "string" || typeof card.word !== "string") {
      return `cards[${i}]: at / word / image が揃っていません`;
    }
  }
  return null;
}

/** 元の書き起こしの文字を連ねたもの。管理画面からの保存で、これが変わってはいけない */
const sourceText = (subs: ClipDraftSub[]) => subs.map((s) => s.of).join("");

export const clips = new Hono<{ Bindings: Env }>();

/**
 * この回の切り抜き一覧
 */
clips.get("/:id/clips", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const index = await readJson<ClipIndex>(
    c.env,
    `${clipsPrefix(meta.storageKey)}/index.json`
  );
  return c.json(index ?? { clips: [] });
});

/**
 * 切り抜き 1 本分の meta
 */
clips.get("/:id/clips/:clipId", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const clip = await readClip(c.env, meta.storageKey, clipId);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  // 動画は R2 の公開 URL から直接読ませる。音声と同じ扱いで Worker を通さない。
  // 版ごとのパスは baseUrl + /v{n}/{layout}.mp4（下書きより前の版は /v{n}/clip.mp4）
  return c.json({
    ...clip,
    baseUrl: `${c.env.R2_PUBLIC_URL}/${clipsPrefix(meta.storageKey)}/${clipId}`,
  });
});

/**
 * 下書きを置く。生成側（手元の道具）から呼ぶ。
 *
 * 切り抜きが無ければ作る。あれば下書きを置き換える。区間を外へ広げたいときや、
 * 区切りを作り直したいときにここへ戻ってくる。置き換えたら OK は取り消す。
 * 確かめたのは前の下書きだから。投稿が済んだものは置き換えない。
 */
clips.put("/:id/clips/:clipId", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const body = await c.req.json<{
    label?: string;
    draft?: Omit<DraftBody, "speed" | "cards"> & Partial<Pick<DraftBody, "speed" | "cards">>;
  }>();
  if (!body.draft) return c.json({ error: "draft がありません" }, 400);

  const draftKey = `${clipsPrefix(meta.storageKey)}/${clipId}/draft.json`;
  const previous = await readJson<ClipDraft>(c.env, draftKey);

  // 速さは、置き直しても画面で決めたものを保つ。生成側が知っているのは区切りと時刻だけ
  const draft: DraftBody = {
    ...body.draft,
    speed: body.draft.speed ?? previous?.speed ?? CLIP_DEFAULT_SPEED,
    cards: body.draft.cards ?? [],
  };
  const problem = draftProblem(draft);
  if (problem) return c.json({ error: problem }, 400);

  const existing = await readClip(c.env, meta.storageKey, clipId);
  if (existing?.status === "published") {
    return c.json({ error: "投稿が済んだ切り抜きの下書きは置き換えられません" }, 409);
  }

  const next: ClipMeta = existing ?? {
    id: clipId,
    episodeId: meta.id,
    label: body.label ?? clipId,
    latest: 0,
    status: "draft",
    approvedRevision: null,
    versions: [],
    publishAt: null,
    postText: "",
    posts: defaultPosts(),
  };
  if (body.label) next.label = body.label;
  next.status = "draft";
  next.approvedRevision = null;

  const saved: ClipDraft = { revision: (previous?.revision ?? 0) + 1, ...draft };
  await writeJson(c.env, draftKey, saved);
  await saveClip(c.env, meta.storageKey, next);
  return c.json({ ...next, revision: saved.revision });
});

/**
 * 下書き
 */
clips.get("/:id/clips/:clipId/draft", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const draft = await readJson<ClipDraft>(
    c.env,
    `${clipsPrefix(meta.storageKey)}/${c.req.param("clipId")}/draft.json`
  );
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  return c.json(draft);
});

/**
 * 下書きを保存する。管理画面から呼ぶ。
 *
 * 直せるのは、画面に出す文字と改行（rows）、出す／出さない（skip）、枚の割り方、
 * 区間の端と間と外す／戻す、速さ、画像。区間の並べ替えも形の上では通るが、画面からは
 * やらない。どこをどの順に繋ぐかは手元の AI が決める。元の書き起こしの文字（of）は変えられない。生成側は of を
 * 連ねたものが元の書き起こしと一字一句一致することを確かめてから描くので、ここで
 * 変わってしまうと、OK を出したあとの描画で止まる。止まるなら保存のときに止める。
 */
clips.put("/:id/clips/:clipId/draft", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const clip = await readClip(c.env, meta.storageKey, clipId);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  const draftKey = `${clipsPrefix(meta.storageKey)}/${clipId}/draft.json`;
  const current = await readJson<ClipDraft>(c.env, draftKey);
  if (!current) return c.json({ error: "Draft not found" }, 404);

  if (clip.status !== "draft") {
    return c.json({ error: "OK を出した下書きは直せません。先に OK を取り消してください" }, 409);
  }

  const body = await c.req.json<Partial<ClipDraft>>();

  // 別の画面で先に保存されていたら、黙って上書きしない
  if (body.revision !== current.revision) {
    return c.json(
      { error: "ほかの画面で先に保存されています。読み込み直してください", revision: current.revision },
      409
    );
  }

  for (const key of FIXED_BY_GENERATOR) {
    if (body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(current[key])) {
      return c.json({ error: `${key} は管理画面からは変えられません` }, 400);
    }
  }

  const next: DraftBody = {
    speed: body.speed ?? current.speed ?? CLIP_DEFAULT_SPEED,
    gap: current.gap,
    edgeFade: current.edgeFade,
    lead: current.lead,
    trail: current.trail,
    audio: current.audio,
    pool: current.pool,
    spans: body.spans ?? current.spans,
    subs: body.subs ?? current.subs,
    cards: body.cards ?? current.cards,
  };
  const problem = draftProblem(next);
  if (problem) return c.json({ error: problem }, 400);

  if (sourceText(next.subs) !== sourceText(current.subs)) {
    return c.json({ error: "元の書き起こしの文字（of）が変わっています" }, 400);
  }

  const saved: ClipDraft = { revision: current.revision + 1, ...next };
  await writeJson(c.env, draftKey, saved);
  return c.json(saved);
});

/**
 * OK / 取り消し / ボツ。
 *
 * OK には投稿の予定を添える。OK を出した時点の下書きの revision を控えておき、
 * 描く側はそれと違う下書きを描かない。
 */
clips.put("/:id/clips/:clipId/status", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const body = await c.req.json<{
    status?: string;
    publishAt?: string | null;
    postText?: string;
    posts?: Partial<Record<ClipPostTarget, Partial<Pick<ClipPost, "enabled" | "layout">>>>;
  }>();
  if (body.status !== "draft" && body.status !== "approved" && body.status !== "rejected") {
    return c.json({ error: "invalid status" }, 400);
  }

  const clipId = c.req.param("clipId");
  const clip = await readClip(c.env, meta.storageKey, clipId);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  if (clip.status === "published") {
    return c.json({ error: "投稿が済んだ切り抜きの状態は変えられません" }, 409);
  }

  if (body.status === "approved") {
    const draft = await readJson<ClipDraft>(
      c.env,
      `${clipsPrefix(meta.storageKey)}/${clipId}/draft.json`
    );
    if (!draft) return c.json({ error: "下書きが無い切り抜きには OK を出せません" }, 409);

    if (body.publishAt != null && Number.isNaN(Date.parse(body.publishAt))) {
      return c.json({ error: "publishAt が日時として読めません" }, 400);
    }
    for (const [target, post] of Object.entries(body.posts ?? {})) {
      if (!CLIP_POST_TARGETS.includes(target as ClipPostTarget)) {
        return c.json({ error: `知らない投稿先です: ${target}` }, 400);
      }
      if (post?.layout && !CLIP_LAYOUTS.includes(post.layout)) {
        return c.json({ error: `知らないレイアウトです: ${post.layout}` }, 400);
      }
    }

    if (body.publishAt !== undefined) {
      clip.publishAt = body.publishAt ? new Date(body.publishAt).toISOString() : null;
    }
    if (body.postText !== undefined) clip.postText = body.postText;
    for (const target of CLIP_POST_TARGETS) {
      const post = body.posts?.[target];
      if (!post) continue;
      if (post.enabled !== undefined) clip.posts[target].enabled = post.enabled;
      if (post.layout) clip.posts[target].layout = post.layout;
    }
    clip.approvedRevision = draft.revision;
  } else {
    clip.approvedRevision = null;
  }

  clip.status = body.status;
  await saveClip(c.env, meta.storageKey, clip);
  return c.json(clip);
});

/**
 * 動画を置くための Presigned URL を出す。レイアウトごとに 1 本。
 *
 * 動画は数十 MB になる。Worker の本体に流さず、置き場だけ渡して手元から直に
 * R2 へ入れさせる。音声・アートワーク・話者トラックと同じ扱いで、鍵は Worker が
 * 持ったままにする。
 *
 * 版を指定しなければ次の版を返す。3 本置いてから版として登録すれば番号が揃う。
 */
clips.post("/:id/clips/:clipId/upload-url", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const body = await c.req
    .json<{ n?: number; layout?: ClipLayoutName }>()
    .catch(() => ({}) as { n?: number; layout?: ClipLayoutName });

  if (!body.layout || !CLIP_LAYOUTS.includes(body.layout)) {
    return c.json({ error: "layout は portrait / landscape / square のどれかです" }, 400);
  }

  let n = body.n;
  if (!n) {
    const clip = await readClip(c.env, meta.storageKey, clipId);
    n = (clip?.latest ?? 0) + 1;
  }

  const key = `${clipsPrefix(meta.storageKey)}/${clipId}/v${n}/${body.layout}.mp4`;
  const { url, expiresIn } = await createPresignedUrl(c.env, key, {
    method: "PUT",
    contentType: "video/mp4",
  });

  return c.json({ n, layout: body.layout, key, uploadUrl: url, expiresIn });
});

/**
 * 描いた版を登録する。生成側（手元の道具）から呼ぶ。
 *
 * 動画は先に Presigned URL で入れておく。逆にすると、登録は済んでいるのに動画が
 * 無い版が画面に出る。
 *
 * 描いた下書きの revision が、OK を出したときのものと違えば受け取らない。描いて
 * いる間に OK が取り消されて直された、ということで、その動画は確かめたものと違う。
 */
clips.post("/:id/clips/:clipId/versions", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const clip = await readClip(c.env, meta.storageKey, clipId);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  const body = await c.req.json<{
    revision?: number;
    layouts?: ClipLayoutName[];
    manifest?: unknown;
    note?: string;
  }>();

  if (clip.status !== "approved" || body.revision !== clip.approvedRevision) {
    return c.json(
      {
        error: "OK が出ている下書きと違うものを描いています",
        status: clip.status,
        approvedRevision: clip.approvedRevision,
      },
      409
    );
  }
  const layouts = body.layouts ?? [];
  if (layouts.length === 0 || !layouts.every((l) => CLIP_LAYOUTS.includes(l))) {
    return c.json({ error: "layouts が空か、知らないレイアウトを含んでいます" }, 400);
  }
  // 投稿に使うレイアウトが描かれていなければ、予定日に出せない
  const needed = CLIP_POST_TARGETS.filter((t) => clip.posts[t].enabled).map(
    (t) => clip.posts[t].layout
  );
  const lacking = needed.filter((l) => !layouts.includes(l));
  if (clip.publishAt && lacking.length > 0) {
    return c.json({ error: `投稿に使うレイアウトがありません: ${[...new Set(lacking)].join(", ")}` }, 400);
  }

  const prefix = `${clipsPrefix(meta.storageKey)}/${clipId}`;
  const draft = await readJson<ClipDraft>(c.env, `${prefix}/draft.json`);

  clip.latest += 1;
  clip.versions.push({
    n: clip.latest,
    createdAt: new Date().toISOString(),
    revision: body.revision,
    layouts,
    note: body.note,
  });
  clip.status = "rendered";

  // 描いたときの下書きを控える。下書きはこのあとも直されうる
  const dir = `${prefix}/v${clip.latest}`;
  if (draft) await writeJson(c.env, `${dir}/draft.json`, draft);
  if (body.manifest) await writeJson(c.env, `${dir}/manifest.json`, body.manifest);

  await saveClip(c.env, meta.storageKey, clip);
  return c.json(clip, 201);
});

/**
 * 描画待ちのものを集める。手元の watch.py がこれを見て拾う。
 */
export const pendingClips = new Hono<{ Bindings: Env }>();

function toPending(ep: { id: string; storageKey: string }, clip: ClipMeta): PendingClip[] {
  if (!waitsForRender(clip) || clip.approvedRevision === null) return [];
  return [
    {
      episodeId: ep.id,
      storageKey: ep.storageKey,
      clipId: clip.id,
      label: clip.label,
      revision: clip.approvedRevision,
    },
  ];
}

/**
 * 全件走査で索引を作り直す。索引が未構築のときだけ通る。
 */
export async function scanClipQueues(
  env: Env
): Promise<{ renderIds: string[]; postIds: string[]; pending: PendingClip[] }> {
  const episodes = await listAllEpisodes(env);
  const renderIds: string[] = [];
  const postIds: string[] = [];
  const pending: PendingClip[] = [];

  for (const ep of episodes) {
    const index = await readJson<ClipIndex>(env, `${clipsPrefix(ep.storageKey)}/index.json`);
    if (!index) continue;

    for (const entry of index.clips) {
      // 一覧に状態が写してあるので、待っていないものは meta を読まずに飛ばす
      if (entry.status !== "approved" && entry.status !== "rendered") continue;
      const clip = await readClip(env, ep.storageKey, entry.id);
      if (!clip) continue;

      const key = `${ep.id}/${clip.id}`;
      if (waitsForRender(clip)) renderIds.push(key);
      if (waitsForPost(clip)) postIds.push(key);
      pending.push(...toPending(ep, clip));
    }
  }

  return { renderIds, postIds, pending };
}

pendingClips.get("/pending", async (c) => {
  const index = await getIndex(c.env);

  // 索引があれば、載っているものだけを読む。手元は 1 時間おきに叩くので、
  // ここで全エピソードを走査すると Worker のリソース制限に達する
  if (index.clipRenderIds !== undefined) {
    const found = await Promise.all(
      index.clipRenderIds.map(async (id) => {
        const [episodeId, clipId] = id.split("/");
        if (!episodeId || !clipId) return [];
        const ep = await findEpisodeBySlug(c.env, episodeId);
        if (!ep) return [];
        const clip = await readClip(c.env, ep.storageKey, clipId);
        return clip ? toPending(ep, clip) : [];
      })
    );
    return c.json({ pending: found.flat() });
  }

  // 未構築。ここで一度だけ全件走査して覚える
  const { renderIds, postIds, pending } = await scanClipQueues(c.env);
  const current = await getIndex(c.env);
  current.clipRenderIds = renderIds;
  current.clipPostIds = postIds;
  await saveIndex(c.env, current);
  console.log(
    `[clips-pending] Built clip queues from a full scan: ${renderIds.length} to render, ${postIds.length} to post`
  );

  return c.json({ pending });
});
