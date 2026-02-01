import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type {
  Env,
  UploadUrlRequest,
  UploadUrlResponse,
  UploadCompleteRequest,
  UploadFromUrlRequest,
} from "../types";
import {
  getIndex,
  findEpisodeBySlug,
  saveEpisodeMeta,
  saveAudioFile,
  syncPublishedIndex,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";
import { postEpisodeToBluesky } from "../services/bluesky";
import { triggerWebRebuild } from "../services/deploy";

const upload = new Hono<{ Bindings: Env }>();

/**
 * NextCloud共有リンクを直接ダウンロードURLに変換
 * 例: https://cloud.example.com/s/AbCdEf123 -> https://cloud.example.com/s/AbCdEf123/download
 */
function convertToDirectDownloadUrl(url: string): string {
  // NextCloud/ownCloud共有リンクのパターン: /s/ または /index.php/s/
  const nextcloudPattern = /^(https?:\/\/[^/]+)(\/index\.php)?(\/s\/[a-zA-Z0-9]+)\/?$/;
  const match = url.match(nextcloudPattern);

  if (match) {
    // 既に /download が付いていなければ追加
    const baseUrl = match[1] + (match[2] || "") + match[3];
    return `${baseUrl}/download`;
  }

  return url;
}

/**
 * POST /api/episodes/:id/upload-url - Presigned URL 発行
 */
upload.post("/:id/upload-url", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UploadUrlRequest>();

  // バリデーション
  if (!body.contentType || !body.fileSize) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    console.log(`[upload-url] Looking for episode: ${id}`);
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }
    console.log(`[upload-url] Found episode:`, meta);

    // new 状態のみ許可
    if (meta.publishStatus !== "new") {
      return c.json(
        { error: "Episode is not in new status" },
        400
      );
    }

    // Presigned URL 生成
    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `episodes/${meta.storageKey}/audio.mp3`;
    const url = new URL(
      `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`
    );
    url.searchParams.set("X-Amz-Expires", "3600");

    const signed = await r2.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": body.contentType },
      }),
      { aws: { signQuery: true } }
    );

    // ステータス更新
    meta.publishStatus = "uploading";
    meta.fileSize = body.fileSize;
    await saveEpisodeMeta(c.env, meta);

    const response: UploadUrlResponse = {
      uploadUrl: signed.url,
      expiresIn: 3600,
    };

    return c.json(response);
  } catch (err) {
    console.error(`[upload-url] Error for episode ${id}:`, err);
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/upload-complete - アップロード完了通知
 */
upload.post("/:id/upload-complete", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UploadCompleteRequest>();

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }
    console.log(`[upload-complete] Episode ${id} publishStatus: ${meta.publishStatus}`);

    // uploading 状態のみ許可
    if (meta.publishStatus !== "uploading") {
      console.log(`[upload-complete] Rejected: publishStatus is ${meta.publishStatus}, expected uploading`);
      return c.json({ error: "Episode is not in uploading status" }, 400);
    }

    // R2 にファイルが存在するか確認
    const audioKey = `episodes/${meta.storageKey}/audio.mp3`;
    let fileSize = body.fileSize || 0;

    // ローカル開発時は R2 Binding が実際のバケットを参照しないためスキップ
    if (c.env.IS_DEV !== "true") {
      console.log(`[upload-complete] Checking R2 for key: ${audioKey}`);
      const audioObj = await c.env.R2_BUCKET.head(audioKey);
      console.log(`[upload-complete] R2 head result:`, audioObj ? `found (${audioObj.size} bytes)` : "not found");

      if (!audioObj) {
        return c.json({ error: "Audio file not found in R2" }, 400);
      }
      fileSize = audioObj.size;
    } else {
      console.log(`[upload-complete] Skipping R2 check (dev mode)`);
    }

    // メタデータ更新
    meta.duration = body.duration;
    meta.fileSize = fileSize;
    meta.audioUrl = `${c.env.R2_PUBLIC_URL}/${audioKey}`;

    // transcribeStatus を設定
    if (meta.skipTranscription) {
      meta.transcribeStatus = "skipped";
    } else {
      meta.transcribeStatus = "pending";
    }

    // publishAt がnullの場合はdraft状態を維持（下書き保存）
    if (meta.publishAt === null) {
      meta.publishStatus = "draft";
    } else {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.publishStatus = "published";
        // 既に publishedAt が設定されている場合は維持（RSSインポートなど）
        if (!meta.publishedAt) {
          meta.publishedAt = now.toISOString();
        }

        // Bluesky に投稿（OGP画像のフォールバックとしてartworkUrlを渡す）
        const index = await getIndex(c.env);
        const posted = await postEpisodeToBluesky(c.env, meta, c.env.WEBSITE_URL, index.podcast.artworkUrl);
        if (posted) {
          meta.blueskyPostedAt = now.toISOString();
        }
      } else {
        meta.publishStatus = "scheduled";
      }
    }

    await saveEpisodeMeta(c.env, meta);
    await syncPublishedIndex(c.env, meta);

    // 公開された場合はフィードを再生成してWebをリビルド
    if (meta.publishStatus === "published") {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
    }

    return c.json({
      id: meta.id,
      publishStatus: meta.publishStatus,
      transcribeStatus: meta.transcribeStatus,
    });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/upload-from-url - URL から音声を取得
 */
upload.post("/:id/upload-from-url", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UploadFromUrlRequest>();

  // バリデーション
  if (!body.sourceUrl) {
    return c.json({ error: "Missing sourceUrl" }, 400);
  }

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    // new 状態のみ許可
    if (meta.publishStatus !== "new") {
      return c.json(
        { error: "Episode is not in new status" },
        400
      );
    }

    // ステータスを uploading に更新
    meta.publishStatus = "uploading";
    await saveEpisodeMeta(c.env, meta);

    // 音声ファイルをダウンロード（NextCloud共有リンクは自動変換）
    const downloadUrl = convertToDirectDownloadUrl(body.sourceUrl);
    const audioResponse = await fetch(downloadUrl);

    if (!audioResponse.ok) {
      // 失敗時は new に戻す
      meta.publishStatus = "new";
      await saveEpisodeMeta(c.env, meta);
      return c.json({ error: "Failed to download audio file" }, 400);
    }

    const audioData = await audioResponse.arrayBuffer();

    // R2 に保存
    const { size } = await saveAudioFile(c.env, meta.storageKey, audioData);

    // メタデータ更新
    meta.fileSize = size;
    meta.audioUrl = `${c.env.R2_PUBLIC_URL}/episodes/${meta.storageKey}/audio.mp3`;

    // transcribeStatus を設定
    if (meta.skipTranscription) {
      meta.transcribeStatus = "skipped";
    } else {
      meta.transcribeStatus = "pending";
    }

    // publishAt がnullの場合はdraft状態を維持（下書き保存）
    if (meta.publishAt === null) {
      meta.publishStatus = "draft";
    } else {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.publishStatus = "published";
        // 既に publishedAt が設定されている場合は維持（RSSインポートなど）
        if (!meta.publishedAt) {
          meta.publishedAt = now.toISOString();
        }

        // Bluesky に投稿（OGP画像のフォールバックとしてartworkUrlを渡す）
        const index = await getIndex(c.env);
        const posted = await postEpisodeToBluesky(c.env, meta, c.env.WEBSITE_URL, index.podcast.artworkUrl);
        if (posted) {
          meta.blueskyPostedAt = now.toISOString();
        }
      } else {
        meta.publishStatus = "scheduled";
      }
    }

    await saveEpisodeMeta(c.env, meta);
    await syncPublishedIndex(c.env, meta);

    // 公開された場合はフィードを再生成してWebをリビルド
    if (meta.publishStatus === "published") {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
    }

    return c.json({
      id: meta.id,
      publishStatus: meta.publishStatus,
      transcribeStatus: meta.transcribeStatus,
    });
  } catch (error) {
    // エラー時は new に戻す
    try {
      const meta = await findEpisodeBySlug(c.env, id);
      if (meta) {
        meta.publishStatus = "new";
        await saveEpisodeMeta(c.env, meta);
      }
    } catch {
      // ignore
    }
    return c.json({ error: "Failed to process audio file" }, 500);
  }
});

/**
 * POST /api/episodes/:id/artwork/upload-url - エピソードアートワークのPresigned URL発行
 */
upload.post("/:id/artwork/upload-url", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ contentType: string; fileSize: number }>();

  const { contentType, fileSize } = body;

  // 画像形式のバリデーション
  if (!["image/jpeg", "image/png"].includes(contentType)) {
    return c.json({ error: "Invalid content type. Use image/jpeg or image/png" }, 400);
  }

  // ファイルサイズ上限（5MB）
  if (fileSize > 5 * 1024 * 1024) {
    return c.json({ error: "File too large. Max 5MB" }, 400);
  }

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    const extension = contentType === "image/png" ? "png" : "jpg";
    const key = `episodes/${meta.storageKey}/artwork.${extension}`;

    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const url = new URL(
      `https://${c.env.R2_BUCKET_NAME}.${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
    );

    url.searchParams.set("X-Amz-Expires", "3600");

    const signedRequest = await r2.sign(
      new Request(url, {
        method: "PUT",
      }),
      {
        aws: { signQuery: true },
      }
    );

    return c.json({
      uploadUrl: signedRequest.url,
      expiresIn: 3600,
      artworkUrl: `${c.env.R2_PUBLIC_URL}/${key}`,
    });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/artwork/upload-complete - エピソードアートワークアップロード完了通知
 */
upload.post("/:id/artwork/upload-complete", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ artworkUrl: string }>();

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    meta.artworkUrl = body.artworkUrl;
    await saveEpisodeMeta(c.env, meta);

    // 公開済みの場合はフィードを再生成（<itunes:image>が変わる）
    if (meta.publishStatus === "published") {
      await regenerateFeed(c.env);
      await triggerWebRebuild(c.env);
    }

    return c.json({ success: true, artworkUrl: body.artworkUrl });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { upload };
