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
  findEpisodeBySlug,
  moveEpisode,
  getAudioFile,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";
import { postEpisodeToBluesky } from "../services/bluesky";
import { triggerWebRebuild } from "../services/deploy";

const episodes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/episodes - エピソード一覧を取得（publishAt降順）
 */
episodes.get("/", async (c) => {
  const index = await getIndex(c.env);

  const episodeList = await Promise.all(
    index.episodes.map(async (ref) => {
      const meta = await getEpisodeMeta(c.env, ref.id);
      return {
        id: meta.id,
        slug: meta.slug || meta.id,
        title: meta.title,
        status: meta.status,
        publishAt: meta.publishAt,
        publishedAt: meta.publishedAt,
      };
    })
  );

  // publishAt降順でソート（nullは最後）
  episodeList.sort((a, b) => {
    if (!a.publishAt && !b.publishAt) return 0;
    if (!a.publishAt) return 1;
    if (!b.publishAt) return -1;
    return new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime();
  });

  return c.json({ episodes: episodeList });
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
 * slugのバリデーション（英数字とハイフンのみ）
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * ユニークなslugを生成
 */
function generateUniqueSlug(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `ep-${timestamp}-${random}`;
}

/**
 * POST /api/episodes - 新規エピソード作成（メタデータのみ）
 */
episodes.post("/", async (c) => {
  const body = await c.req.json<CreateEpisodeRequest>();

  // バリデーション（titleのみ必須、publishAtはnull許可で下書き）
  if (!body.title) {
    return c.json({ error: "Title is required" }, 400);
  }

  const index = await getIndex(c.env);

  // slugの決定（指定がなければ自動生成）
  let slug: string;
  if (body.slug) {
    // バリデーション
    if (!isValidSlug(body.slug)) {
      return c.json({ error: "Invalid slug. Use lowercase letters, numbers, and hyphens only" }, 400);
    }
    // 重複チェック
    const existing = await findEpisodeBySlug(c.env, body.slug);
    if (existing) {
      return c.json({ error: `Slug "${body.slug}" already exists` }, 400);
    }
    slug = body.slug;
  } else {
    slug = generateUniqueSlug();
  }

  const now = new Date().toISOString();

  // 新しいエピソードメタデータを作成
  const newMeta: EpisodeMeta = {
    id: slug,
    slug,
    title: body.title,
    description: body.description || "",
    duration: 0,
    fileSize: 0,
    audioUrl: "",
    sourceAudioUrl: null,
    sourceGuid: null,
    transcriptUrl: null,
    ogImageUrl: null,
    skipTranscription: body.skipTranscription ?? false,
    status: "draft",
    createdAt: now,
    publishAt: body.publishAt ?? null,
    publishedAt: null,
    blueskyPostText: body.blueskyPostText ?? null,
    blueskyPostEnabled: body.blueskyPostEnabled ?? false,
    blueskyPostedAt: null,
    referenceLinks: body.referenceLinks ?? [],
    applePodcastsUrl: null,
    applePodcastsCheckedAt: null,
  };

  // メタデータを保存
  await saveEpisodeMeta(c.env, newMeta);

  // インデックスを更新
  index.episodes.push({ id: slug });
  await saveIndex(c.env, index);

  const response: CreateEpisodeResponse = {
    id: slug,
    slug,
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
    const index = await getIndex(c.env);
    let needsMove = false;
    let newSlug = meta.slug || meta.id;

    // slugの更新（ドラフト状態のみ）
    if (body.slug !== undefined && body.slug !== meta.slug) {
      if (meta.status !== "draft") {
        return c.json({ error: "Cannot change slug after upload started" }, 400);
      }
      if (!isValidSlug(body.slug)) {
        return c.json({ error: "Invalid slug. Use lowercase letters, numbers, and hyphens only" }, 400);
      }
      const existing = await findEpisodeBySlug(c.env, body.slug);
      if (existing && existing.id !== meta.id) {
        return c.json({ error: `Slug "${body.slug}" already exists` }, 400);
      }
      newSlug = body.slug;
      needsMove = true;
    }

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
    // skipTranscription は draft または failed 状態のときのみ変更可能
    if (body.skipTranscription !== undefined) {
      if (meta.status === "draft" || meta.status === "failed") {
        meta.skipTranscription = body.skipTranscription;
      }
    }
    // Bluesky 投稿設定
    if (body.blueskyPostText !== undefined) {
      meta.blueskyPostText = body.blueskyPostText;
    }
    if (body.blueskyPostEnabled !== undefined) {
      meta.blueskyPostEnabled = body.blueskyPostEnabled;
    }
    // 参考リンク
    if (body.referenceLinks !== undefined) {
      meta.referenceLinks = body.referenceLinks;
    }

    // slugが変わる場合はファイルを移動
    if (needsMove) {
      await moveEpisode(c.env, meta.id, newSlug);
      // インデックスのIDを更新
      const indexEntry = index.episodes.find((ep) => ep.id === meta.id);
      if (indexEntry) {
        indexEntry.id = newSlug;
      }
      meta.id = newSlug;
      meta.slug = newSlug;
    }

    await saveEpisodeMeta(c.env, meta);
    await saveIndex(c.env, index);

    // 公開済みの場合はフィードを再生成してWebをリビルド
    if (meta.status === "published") {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
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

    // 公開済みだった場合はフィードを再生成してWebをリビルド
    if (wasPublished) {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
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

      // publishAt がnullなら下書きのまま
      if (meta.publishAt === null) {
        meta.status = "draft";
      } else {
        // publishAt が過去なら即座に published に
        const now = new Date();
        if (new Date(meta.publishAt) <= now) {
          meta.status = "published";
          meta.publishedAt = now.toISOString();

          // Bluesky に投稿
          const posted = await postEpisodeToBluesky(c.env, meta, c.env.WEBSITE_URL);
          if (posted) {
            meta.blueskyPostedAt = now.toISOString();
          }
        } else {
          meta.status = "scheduled";
        }
      }
    } else {
      meta.status = "failed";
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開された場合はフィードを再生成してWebをリビルド
    if (meta.status === "published") {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
    }

    return c.json({ success: true, status: meta.status });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { episodes };
