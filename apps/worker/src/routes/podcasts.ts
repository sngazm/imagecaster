import { Hono } from "hono";
import type { Env, CreatePodcastRequest, UpdatePodcastRequest } from "../types";
import {
  getPodcastsIndex,
  savePodcastsIndex,
  getIndex,
  saveIndex,
  deletePodcast,
  podcastExists,
} from "../services/r2";
import { deleteSecrets } from "../services/kv";

export const podcasts = new Hono<{ Bindings: Env }>();

/**
 * slugのバリデーション（英数字とハイフンのみ）
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * GET /api/podcasts - ポッドキャスト一覧を取得
 */
podcasts.get("/", async (c) => {
  const index = await getPodcastsIndex(c.env);
  return c.json({ podcasts: index.podcasts });
});

/**
 * POST /api/podcasts - 新規ポッドキャスト作成
 */
podcasts.post("/", async (c) => {
  const body = await c.req.json<CreatePodcastRequest>();

  // バリデーション
  if (!body.id || !body.title) {
    return c.json({ error: "id and title are required" }, 400);
  }

  if (!isValidSlug(body.id)) {
    return c.json({ error: "Invalid id. Use lowercase letters, numbers, and hyphens only" }, 400);
  }

  // 重複チェック
  const exists = await podcastExists(c.env, body.id);
  if (exists) {
    return c.json({ error: `Podcast "${body.id}" already exists` }, 400);
  }

  const now = new Date().toISOString();

  // ポッドキャスト一覧に追加
  const podcastsIndex = await getPodcastsIndex(c.env);
  podcastsIndex.podcasts.push({
    id: body.id,
    title: body.title,
    createdAt: now,
  });
  await savePodcastsIndex(c.env, podcastsIndex);

  // 個別ポッドキャストのインデックスを作成
  const podcastIndex = {
    podcast: {
      id: body.id,
      title: body.title,
      description: "",
      author: "",
      email: "",
      language: "ja",
      category: "Technology",
      artworkUrl: "",
      ogImageUrl: "",
      websiteUrl: "",
      explicit: false,
    },
    episodes: [],
  };
  await saveIndex(c.env, body.id, podcastIndex);

  return c.json({ id: body.id, title: body.title, createdAt: now }, 201);
});

/**
 * GET /api/podcasts/:podcastId - ポッドキャスト詳細を取得
 */
podcasts.get("/:podcastId", async (c) => {
  const podcastId = c.req.param("podcastId");

  const exists = await podcastExists(c.env, podcastId);
  if (!exists) {
    return c.json({ error: "Podcast not found" }, 404);
  }

  const index = await getIndex(c.env, podcastId);
  return c.json({
    id: podcastId,
    ...index.podcast,
    episodeCount: index.episodes.length,
  });
});

/**
 * PUT /api/podcasts/:podcastId - ポッドキャスト更新（タイトルのみ）
 */
podcasts.put("/:podcastId", async (c) => {
  const podcastId = c.req.param("podcastId");
  const body = await c.req.json<UpdatePodcastRequest>();

  const exists = await podcastExists(c.env, podcastId);
  if (!exists) {
    return c.json({ error: "Podcast not found" }, 404);
  }

  // ポッドキャスト一覧のタイトルを更新
  if (body.title) {
    const podcastsIndex = await getPodcastsIndex(c.env);
    const podcast = podcastsIndex.podcasts.find((p) => p.id === podcastId);
    if (podcast) {
      podcast.title = body.title;
      await savePodcastsIndex(c.env, podcastsIndex);
    }

    // 個別インデックスのタイトルも更新
    const index = await getIndex(c.env, podcastId);
    index.podcast.title = body.title;
    await saveIndex(c.env, podcastId, index);
  }

  return c.json({ success: true });
});

/**
 * DELETE /api/podcasts/:podcastId - ポッドキャスト削除
 */
podcasts.delete("/:podcastId", async (c) => {
  const podcastId = c.req.param("podcastId");

  const exists = await podcastExists(c.env, podcastId);
  if (!exists) {
    return c.json({ error: "Podcast not found" }, 404);
  }

  // R2からすべてのファイルを削除
  await deletePodcast(c.env, podcastId);

  // KVからシークレットを削除
  await deleteSecrets(c.env, podcastId);

  // ポッドキャスト一覧から削除
  const podcastsIndex = await getPodcastsIndex(c.env);
  podcastsIndex.podcasts = podcastsIndex.podcasts.filter((p) => p.id !== podcastId);
  await savePodcastsIndex(c.env, podcastsIndex);

  return c.json({ success: true });
});
