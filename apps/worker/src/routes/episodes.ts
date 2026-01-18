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
  syncEpisodeStatusToIndex,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";
import { postEpisodeToBluesky } from "../services/bluesky";
import { triggerWebRebuild } from "../services/deploy";
import { convertToVtt, validateTranscriptData } from "../services/vtt";

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
        sourceGuid: meta.sourceGuid || null,
        applePodcastsUrl: meta.applePodcastsUrl || null,
        spotifyUrl: meta.spotifyUrl || null,
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
    artworkUrl: null,
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
    spotifyUrl: null,
  };

  // メタデータを保存
  await saveEpisodeMeta(c.env, newMeta);

  // インデックスを更新（statusも含める）
  index.episodes.push({ id: slug, status: newMeta.status });
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
    // skipTranscription: 文字起こしがまだない場合は変更可能
    // スキップを解除した場合（false にした場合）、scheduled/published なら transcribing に戻す
    if (body.skipTranscription !== undefined) {
      // 文字起こしが完了している場合は変更不可
      if (!meta.transcriptUrl) {
        const wasSkipped = meta.skipTranscription;
        meta.skipTranscription = body.skipTranscription;

        // スキップ解除 + scheduled/published → transcribing に戻す
        if (wasSkipped && !body.skipTranscription && (meta.status === "scheduled" || meta.status === "published")) {
          meta.status = "transcribing";
        }
      }
    }
    // hideTranscription（文字起こしの非表示）はいつでも変更可能
    if (body.hideTranscription !== undefined) {
      meta.hideTranscription = body.hideTranscription;
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
    // Apple Podcasts
    if (body.applePodcastsUrl !== undefined) {
      meta.applePodcastsUrl = body.applePodcastsUrl;
    }
    // Spotify
    if (body.spotifyUrl !== undefined) {
      meta.spotifyUrl = body.spotifyUrl;
    }

    // ステータス変更（リトライ用: failed → transcribing）
    if (body.status !== undefined) {
      // failed → transcribing のみ許可（リトライ）
      if (meta.status === "failed" && body.status === "transcribing") {
        // 音声ファイルがあることを確認
        if (!meta.audioUrl && !meta.sourceAudioUrl) {
          return c.json({ error: "Cannot retry: no audio file available" }, 400);
        }
        meta.status = "transcribing";
        meta.transcriptionLockedAt = null; // ロックをクリア
      } else {
        return c.json(
          { error: `Status change from '${meta.status}' to '${body.status}' is not allowed` },
          400
        );
      }
    }

    // slugが変わる場合はファイルを移動
    if (needsMove) {
      await moveEpisode(c.env, meta.id, newSlug);
      // インデックスのIDを更新
      const indexEntry = index.episodes.find((ep) => ep.id === meta.id);
      if (indexEntry) {
        indexEntry.id = newSlug;
        indexEntry.status = meta.status; // statusも同期
      }
      meta.id = newSlug;
      meta.slug = newSlug;
    } else {
      // slugが変わらない場合もstatusを同期
      const indexEntry = index.episodes.find((ep) => ep.id === meta.id);
      if (indexEntry) {
        indexEntry.status = meta.status;
      }
    }

    await saveEpisodeMeta(c.env, meta);
    await saveIndex(c.env, index);

    // 公開済みの場合はフィードを再生成してWebをリビルド
    // ただし applePodcastsUrl / spotifyUrl のみの更新はスキップ（RSSに含まれず、頻繁な更新があり得るため）
    const isPlatformUrlOnlyUpdate =
      (body.applePodcastsUrl !== undefined || body.spotifyUrl !== undefined) &&
      body.title === undefined &&
      body.description === undefined &&
      body.publishAt === undefined &&
      body.skipTranscription === undefined &&
      body.blueskyPostText === undefined &&
      body.blueskyPostEnabled === undefined &&
      body.referenceLinks === undefined &&
      body.slug === undefined;

    if (meta.status === "published" && !isPlatformUrlOnlyUpdate) {
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
 *
 * 完了時の処理:
 * 1. R2から transcript.json を読み込み
 * 2. VTT形式に変換して transcript.vtt として保存
 * 3. メタデータ更新（transcriptUrl, ステータス変更）
 * 4. ロック解除
 */
episodes.post("/:id/transcription-complete", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<TranscriptionCompleteRequest>();

  try {
    const meta = await getEpisodeMeta(c.env, id);

    if (body.status === "completed") {
      // R2 から transcript.json を読み込み
      const jsonKey = `episodes/${meta.id}/transcript.json`;
      const jsonObj = await c.env.R2_BUCKET.get(jsonKey);

      if (!jsonObj) {
        return c.json({ error: "Transcript JSON not found in R2. Please upload first." }, 400);
      }

      const jsonText = await jsonObj.text();
      let transcriptData: unknown;

      try {
        transcriptData = JSON.parse(jsonText);
      } catch {
        return c.json({ error: "Invalid JSON format in transcript file" }, 400);
      }

      // バリデーション
      if (!validateTranscriptData(transcriptData)) {
        return c.json({ error: "Invalid transcript data structure" }, 400);
      }

      // VTT に変換
      const vttContent = convertToVtt(transcriptData);

      // VTT を R2 に保存
      const vttKey = `episodes/${meta.id}/transcript.vtt`;
      await c.env.R2_BUCKET.put(vttKey, vttContent, {
        httpMetadata: {
          contentType: "text/vtt",
        },
      });

      // メタデータ更新
      meta.transcriptUrl = `${c.env.R2_PUBLIC_URL}/${vttKey}`;

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

          // Bluesky に投稿（OGP画像のフォールバックとしてartworkUrlを渡す）
          const index = await getIndex(c.env);
          const posted = await postEpisodeToBluesky(c.env, meta, c.env.WEBSITE_URL, index.podcast.artworkUrl);
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

    // ロック解除
    meta.transcriptionLockedAt = null;

    await saveEpisodeMeta(c.env, meta);
    await syncEpisodeStatusToIndex(c.env, meta.id, meta.status);

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
