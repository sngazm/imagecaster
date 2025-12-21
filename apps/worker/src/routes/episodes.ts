import { Hono } from "hono";
import type {
  Env,
  CreateEpisodeRequest,
  UpdateEpisodeRequest,
  TranscriptionCompleteRequest,
  EpisodesListResponse,
  CreateEpisodeResponse,
  EpisodeMeta,
} from "../types";
import {
  getIndex,
  getEpisodeMeta,
  saveEpisodeMeta,
  saveIndex,
  deleteEpisode,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";

const episodes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/episodes - エピソード一覧を取得
 */
episodes.get("/", async (c) => {
  const index = await getIndex(c.env);

  const episodeList = await Promise.all(
    index.episodes.map(async (ref) => {
      const meta = await getEpisodeMeta(c.env, ref.id);
      return {
        id: meta.id,
        episodeNumber: meta.episodeNumber,
        title: meta.title,
        status: meta.status,
        publishedAt: meta.publishedAt,
      };
    })
  );

  const response: EpisodesListResponse = {
    episodes: episodeList,
  };

  return c.json(response);
});

/**
 * GET /api/episodes/:id - エピソード詳細を取得
 */
episodes.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await getEpisodeMeta(c.env, id);
    return c.json(meta);
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes - 新規エピソード作成（メタデータのみ）
 */
episodes.post("/", async (c) => {
  const body = await c.req.json<CreateEpisodeRequest>();

  // バリデーション
  if (!body.title || !body.publishAt) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const index = await getIndex(c.env);

  // 新しいエピソード番号を採番
  const maxEpisodeNumber = index.episodes.reduce(
    (max, ep) => Math.max(max, ep.episodeNumber),
    0
  );
  const newEpisodeNumber = maxEpisodeNumber + 1;
  const newId = `ep-${String(newEpisodeNumber).padStart(3, "0")}`;

  const now = new Date().toISOString();

  // 新しいエピソードメタデータを作成
  const newMeta: EpisodeMeta = {
    id: newId,
    episodeNumber: newEpisodeNumber,
    title: body.title,
    description: body.description || "",
    duration: 0,
    fileSize: 0,
    audioUrl: "",
    transcriptUrl: null,
    skipTranscription: body.skipTranscription ?? false,
    status: "draft",
    createdAt: now,
    publishAt: body.publishAt,
    publishedAt: null,
  };

  // メタデータを保存
  await saveEpisodeMeta(c.env, newMeta);

  // インデックスを更新
  index.episodes.push({
    id: newId,
    episodeNumber: newEpisodeNumber,
  });
  await saveIndex(c.env, index);

  const response: CreateEpisodeResponse = {
    id: newId,
    episodeNumber: newEpisodeNumber,
    status: "draft",
  };

  return c.json(response, 201);
});

/**
 * PUT /api/episodes/:id - エピソード更新
 */
episodes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UpdateEpisodeRequest>();

  try {
    const meta = await getEpisodeMeta(c.env, id);

    // 更新可能なフィールドを更新
    if (body.title !== undefined) {
      meta.title = body.title;
    }
    if (body.description !== undefined) {
      meta.description = body.description;
    }
    if (body.publishAt !== undefined) {
      meta.publishAt = body.publishAt;
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開済みの場合はフィードを再生成
    if (meta.status === "published") {
      await regenerateFeed(c.env);
    }

    return c.json(meta);
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * DELETE /api/episodes/:id - エピソード削除
 */
episodes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await getEpisodeMeta(c.env, id);
    const wasPublished = meta.status === "published";

    await deleteEpisode(c.env, id);

    // インデックスから削除
    const index = await getIndex(c.env);
    index.episodes = index.episodes.filter((ep) => ep.id !== id);
    await saveIndex(c.env, index);

    // 公開済みだった場合はフィードを再生成
    if (wasPublished) {
      await regenerateFeed(c.env);
    }

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/transcription-complete - 文字起こし完了通知
 */
episodes.post("/:id/transcription-complete", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<TranscriptionCompleteRequest>();

  try {
    const meta = await getEpisodeMeta(c.env, id);

    if (body.status === "completed") {
      // duration が提供されていれば更新
      if (body.duration !== undefined) {
        meta.duration = body.duration;
      }

      // publishAt が過去なら即座に published に
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.status = "published";
        meta.publishedAt = now.toISOString();
      } else {
        meta.status = "scheduled";
      }
    } else {
      meta.status = "failed";
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開された場合はフィードを再生成
    if (meta.status === "published") {
      await regenerateFeed(c.env);
    }

    return c.json({ success: true, status: meta.status });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { episodes };
