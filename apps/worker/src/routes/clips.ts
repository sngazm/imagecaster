import { Hono } from "hono";
import type {
  Env,
  ClipIndex,
  ClipMeta,
  ClipRequest,
  ClipRequestItem,
  ClipStatus,
  ClipSubtitle,
  PendingClip,
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
 * 描画はここではできない。ffmpeg も素材も手元（WSL）にあるので、管理画面は
 * 指示を預かるだけで、実際の作り直しは手元の道具が引き取る。R2 を共有の置き場に
 * するのは、音声・書き起こしと同じ考え方で、新しい経路を増やさないため。
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

/**
 * 未処理の指示がある切り抜きの索引を、index.json の中で更新する。
 *
 * 手元の道具は 1 時間おきに /api/clips/pending を叩く。全エピソードの meta.json を
 * 読んでから各回の clips/index.json を読む作りだと、1 リクエストで 500 回以上
 * R2 を読むことになり、Worker のリソース制限（Error 1102）に達する。文字起こし
 * キューが同じ形で一度詰まっているので、同じ手当て（transcriptionQueueIds）を
 * そのまま持ってきている。
 *
 * 索引が未構築（undefined）なら何もしない。全件走査による初期化は巡回側が担う。
 */
async function syncPendingIndex(env: Env, clip: ClipMeta): Promise<void> {
  const index = await getIndex(env);
  if (index.clipRequestIds === undefined) return;

  const key = `${clip.episodeId}/${clip.id}`;
  const shouldBeListed = clip.requests.some((r) => r.appliedIn === null);
  const isListed = index.clipRequestIds.includes(key);

  // 変わっていなければ index.json を書き換えない
  if (shouldBeListed === isListed) return;

  index.clipRequestIds = shouldBeListed
    ? [...index.clipRequestIds, key]
    : index.clipRequestIds.filter((k) => k !== key);
  await saveIndex(env, index);
}

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
  const clip = await readJson<ClipMeta>(
    c.env,
    `${clipsPrefix(meta.storageKey)}/${clipId}/meta.json`
  );
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  // 動画は R2 の公開 URL から直接読ませる。音声と同じ扱いで Worker を通さない。
  // 版ごとのパスは baseUrl + /v{n}/clip.mp4
  return c.json({
    ...clip,
    baseUrl: `${c.env.R2_PUBLIC_URL}/${clipsPrefix(meta.storageKey)}/${clipId}`,
  });
});

/**
 * 版の動画を置くための Presigned URL を出す。
 *
 * 動画は数十 MB になる。Worker の本体に流さず、置き場だけ渡して手元から直に
 * R2 へ入れさせる。音声・アートワーク・話者トラックと同じ扱いで、鍵は Worker が
 * 持ったままにする。
 *
 * 版を指定しなければ次の版を返す。そのまま PUT で登録すれば番号が揃う。
 */
clips.post("/:id/clips/:clipId/upload-url", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const body = await c.req
    .json<{ n?: number }>()
    // 本文なしでも「次の版」として通す
    .catch(() => ({}) as { n?: number });

  let n = body.n;
  if (!n) {
    const clip = await readJson<ClipMeta>(
      c.env,
      `${clipsPrefix(meta.storageKey)}/${clipId}/meta.json`
    );
    n = (clip?.latest ?? 0) + 1;
  }

  const key = `${clipsPrefix(meta.storageKey)}/${clipId}/v${n}/clip.mp4`;
  const { url, expiresIn } = await createPresignedUrl(c.env, key, {
    method: "PUT",
    contentType: "video/mp4",
  });

  return c.json({ n, key, uploadUrl: url, expiresIn });
});

/**
 * 版を追加する。生成側（手元の道具）から呼ぶ。
 *
 * 版は上書きしない。悪くなったときに戻れるようにするため、積むだけにする。
 * 動画は先に Presigned URL で v{n}/clip.mp4 へ入れておき、ここでは版として
 * 登録するのと、その版で使ったもの（字幕の区切り・画像・出どころ）を一緒に
 * 置くのを引き受ける。
 */
clips.put("/:id/clips/:clipId", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const body = await c.req.json<
    Partial<ClipMeta> & {
      appliedRequest?: string;
      note?: string;
      subs?: ClipSubtitle[];
      cards?: unknown;
      manifest?: unknown;
    }
  >();
  const key = `${clipsPrefix(meta.storageKey)}/${clipId}/meta.json`;
  const existing = await readJson<ClipMeta>(c.env, key);

  const now = new Date().toISOString();
  const next: ClipMeta = existing ?? {
    id: clipId,
    episodeId: meta.id,
    label: body.label ?? clipId,
    range: body.range ?? ["0:00", "0:00"],
    clip: body.clip ?? { start: 0, duration: 0 },
    latest: 0,
    status: "draft",
    versions: [],
    requests: [],
  };

  if (body.label) next.label = body.label;
  if (body.range) next.range = body.range;
  if (body.clip) next.clip = body.clip;

  next.latest += 1;
  next.versions.push({
    n: next.latest,
    createdAt: now,
    note: body.note ?? body.versions?.[0]?.note,
    fromRequest: body.appliedRequest,
  });

  // OK / ボツ はその版に対して出したもの。作り直したら見直しからやり直す
  if (next.status !== "draft") next.status = "draft";

  // 反映済みの指示に印を付ける。付け忘れると手元が何度も拾ってしまう
  if (body.appliedRequest) {
    const req = next.requests.find((r) => r.id === body.appliedRequest);
    if (req) req.appliedIn = next.latest;
  }

  // その版で使ったものを一緒に置く。あとで版を見比べるときの手掛かりになる
  const dir = `${clipsPrefix(meta.storageKey)}/${clipId}/v${next.latest}`;
  if (body.subs) await writeJson(c.env, `${dir}/subs.json`, body.subs);
  if (body.cards) await writeJson(c.env, `${dir}/cards.json`, body.cards);
  if (body.manifest) await writeJson(c.env, `${dir}/manifest.json`, body.manifest);

  await writeJson(c.env, key, next);
  await refreshIndex(c.env, meta.storageKey, next);
  await syncPendingIndex(c.env, next);
  return c.json(next);
});

/**
 * その版の字幕
 */
clips.get("/:id/clips/:clipId/versions/:n/subs", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const key =
    `${clipsPrefix(meta.storageKey)}/${c.req.param("clipId")}` +
    `/v${c.req.param("n")}/subs.json`;
  const subs = await readJson<ClipSubtitle[]>(c.env, key);
  if (!subs) return c.json({ error: "Subtitles not found" }, 404);
  return c.json(subs);
});

/**
 * 直しの指示を預かる。
 *
 * ここでは字幕を書き換えない。字幕は音のタイムスタンプに紐づいているので、
 * 文字だけ差し替えると音とずれる。読んで区切りを決め直すのは作り直す側の仕事。
 */
clips.post("/:id/clips/:clipId/requests", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const body = await c.req.json<{ baseVersion?: number; items?: ClipRequestItem[] }>();
  const items = body.items ?? [];
  if (items.length === 0) {
    return c.json({ error: "items is empty" }, 400);
  }

  const key = `${clipsPrefix(meta.storageKey)}/${c.req.param("clipId")}/meta.json`;
  const clip = await readJson<ClipMeta>(c.env, key);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  const request: ClipRequest = {
    id: `r${clip.requests.length + 1}`,
    createdAt: new Date().toISOString(),
    baseVersion: body.baseVersion ?? clip.latest,
    appliedIn: null,
    items,
  };
  clip.requests.push(request);
  await writeJson(c.env, key, clip);
  await syncPendingIndex(c.env, clip);
  return c.json(request, 201);
});

/**
 * OK / ボツ
 */
clips.put("/:id/clips/:clipId/status", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const body = await c.req.json<{ status?: ClipStatus }>();
  const allowed: ClipStatus[] = ["draft", "approved", "rejected"];
  if (!body.status || !allowed.includes(body.status)) {
    return c.json({ error: "invalid status" }, 400);
  }

  const key = `${clipsPrefix(meta.storageKey)}/${c.req.param("clipId")}/meta.json`;
  const clip = await readJson<ClipMeta>(c.env, key);
  if (!clip) return c.json({ error: "Clip not found" }, 404);

  clip.status = body.status;
  await writeJson(c.env, key, clip);
  await refreshIndex(c.env, meta.storageKey, clip);
  return c.json(clip);
});

/**
 * 未処理の指示があるものを集める。手元の watch.py がこれを見て拾う。
 */
export const pendingClips = new Hono<{ Bindings: Env }>();

/** 1 本の切り抜きから、まだ反映されていない指示を取り出す */
function unapplied(
  ep: { id: string; storageKey: string },
  clip: ClipMeta
): PendingClip[] {
  return clip.requests
    .filter((req) => req.appliedIn === null)
    .map((req) => ({
      episodeId: ep.id,
      storageKey: ep.storageKey,
      clipId: clip.id,
      label: clip.label,
      requestId: req.id,
      baseVersion: req.baseVersion,
      items: req.items,
    }));
}

/**
 * 全件走査で索引を作り直す。索引が未構築のときだけ通る。
 */
async function scanPending(
  env: Env
): Promise<{ ids: string[]; pending: PendingClip[] }> {
  const episodes = await listAllEpisodes(env);
  const ids: string[] = [];
  const pending: PendingClip[] = [];

  for (const ep of episodes) {
    const index = await readJson<ClipIndex>(
      env,
      `${clipsPrefix(ep.storageKey)}/index.json`
    );
    if (!index) continue;

    for (const entry of index.clips) {
      const clip = await readJson<ClipMeta>(
        env,
        `${clipsPrefix(ep.storageKey)}/${entry.id}/meta.json`
      );
      if (!clip) continue;

      const items = unapplied(ep, clip);
      if (items.length === 0) continue;
      ids.push(`${ep.id}/${clip.id}`);
      pending.push(...items);
    }
  }

  return { ids, pending };
}

pendingClips.get("/pending", async (c) => {
  const index = await getIndex(c.env);

  // 索引があれば、載っているものだけを読む。手元は 1 時間おきに叩くので、
  // ここで全エピソードを走査すると Worker のリソース制限に達する
  if (index.clipRequestIds !== undefined) {
    const found = await Promise.all(
      index.clipRequestIds.map(async (id) => {
        const [episodeId, clipId] = id.split("/");
        if (!episodeId || !clipId) return [];
        const ep = await findEpisodeBySlug(c.env, episodeId);
        if (!ep) return [];
        const clip = await readJson<ClipMeta>(
          c.env,
          `${clipsPrefix(ep.storageKey)}/${clipId}/meta.json`
        );
        return clip ? unapplied(ep, clip) : [];
      })
    );
    return c.json({ pending: found.flat() });
  }

  // 未構築。ここで一度だけ全件走査して覚える
  const { ids, pending } = await scanPending(c.env);
  const current = await getIndex(c.env);
  current.clipRequestIds = ids;
  await saveIndex(c.env, current);
  console.log(
    `[clips-pending] Built clipRequestIds from a full scan: ${ids.length} clip(s) waiting`
  );

  return c.json({ pending });
});
