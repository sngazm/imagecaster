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
import { findEpisodeBySlug, listAllEpisodes } from "../services/r2";

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
 * 版を追加する。生成側（手元の道具）から呼ぶ。
 *
 * 版は上書きしない。悪くなったときに戻れるようにするため、積むだけにする。
 */
clips.put("/:id/clips/:clipId", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const clipId = c.req.param("clipId");
  const body = await c.req.json<Partial<ClipMeta> & { appliedRequest?: string }>();
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
    note: body.versions?.[0]?.note,
    fromRequest: body.appliedRequest,
  });

  // 反映済みの指示に印を付ける。付け忘れると手元が何度も拾ってしまう
  if (body.appliedRequest) {
    const req = next.requests.find((r) => r.id === body.appliedRequest);
    if (req) req.appliedIn = next.latest;
  }

  await writeJson(c.env, key, next);
  await refreshIndex(c.env, meta.storageKey, next);
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

pendingClips.get("/pending", async (c) => {
  const episodes = await listAllEpisodes(c.env);
  const out: PendingClip[] = [];

  for (const ep of episodes) {
    const index = await readJson<ClipIndex>(
      c.env,
      `${clipsPrefix(ep.storageKey)}/index.json`
    );
    if (!index) continue;

    for (const entry of index.clips) {
      const clip = await readJson<ClipMeta>(
        c.env,
        `${clipsPrefix(ep.storageKey)}/${entry.id}/meta.json`
      );
      if (!clip) continue;

      for (const req of clip.requests) {
        if (req.appliedIn !== null) continue;
        out.push({
          episodeId: ep.id,
          storageKey: ep.storageKey,
          clipId: clip.id,
          label: clip.label,
          requestId: req.id,
          baseVersion: req.baseVersion,
          items: req.items,
        });
      }
    }
  }

  return c.json({ pending: out });
});
