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
  getEpisodeMeta,
  saveEpisodeMeta,
  saveAudioFile,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";

const upload = new Hono<{ Bindings: Env }>();

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
    const meta = await getEpisodeMeta(c.env, id);

    // draft または failed 状態のみ許可
    if (meta.status !== "draft" && meta.status !== "failed") {
      return c.json(
        { error: "Episode is not in draft or failed status" },
        400
      );
    }

    // Presigned URL 生成
    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `episodes/${id}/audio.mp3`;
    const url = new URL(
      `https://${c.env.R2_BUCKET_NAME}.${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
    );

    const signed = await r2.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": body.contentType },
      }),
      { aws: { signQuery: true }, expiresIn: 3600 }
    );

    // ステータス更新
    meta.status = "uploading";
    meta.fileSize = body.fileSize;
    await saveEpisodeMeta(c.env, meta);

    const response: UploadUrlResponse = {
      uploadUrl: signed.url,
      expiresIn: 3600,
    };

    return c.json(response);
  } catch {
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
    const meta = await getEpisodeMeta(c.env, id);

    // uploading 状態のみ許可
    if (meta.status !== "uploading") {
      return c.json({ error: "Episode is not in uploading status" }, 400);
    }

    // R2 にファイルが存在するか確認
    const audioKey = `episodes/${id}/audio.mp3`;
    const audioObj = await c.env.R2_BUCKET.head(audioKey);

    if (!audioObj) {
      return c.json({ error: "Audio file not found in R2" }, 400);
    }

    // メタデータ更新
    meta.duration = body.duration;
    meta.fileSize = audioObj.size;
    meta.audioUrl = `https://${c.env.R2_BUCKET_NAME}.${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${audioKey}`;

    // skipTranscription に応じてステータスを設定
    if (meta.skipTranscription) {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.status = "published";
        meta.publishedAt = now.toISOString();
      } else {
        meta.status = "scheduled";
      }
    } else {
      meta.status = "transcribing";
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開された場合はフィードを再生成
    if (meta.status === "published") {
      await regenerateFeed(c.env);
    }

    return c.json({ id: meta.id, status: meta.status });
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
    const meta = await getEpisodeMeta(c.env, id);

    // draft または failed 状態のみ許可
    if (meta.status !== "draft" && meta.status !== "failed") {
      return c.json(
        { error: "Episode is not in draft or failed status" },
        400
      );
    }

    // ステータスを processing に更新
    meta.status = "processing";
    await saveEpisodeMeta(c.env, meta);

    // 音声ファイルをダウンロード
    const audioResponse = await fetch(body.sourceUrl);

    if (!audioResponse.ok) {
      meta.status = "failed";
      await saveEpisodeMeta(c.env, meta);
      return c.json({ error: "Failed to download audio file" }, 400);
    }

    const audioData = await audioResponse.arrayBuffer();

    // R2 に保存
    const { size } = await saveAudioFile(c.env, id, audioData);

    // メタデータ更新
    meta.fileSize = size;
    meta.audioUrl = `https://${c.env.R2_BUCKET_NAME}.${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/episodes/${id}/audio.mp3`;

    // skipTranscription に応じてステータスを設定
    if (meta.skipTranscription) {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.status = "published";
        meta.publishedAt = now.toISOString();
      } else {
        meta.status = "scheduled";
      }
    } else {
      meta.status = "transcribing";
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開された場合はフィードを再生成
    if (meta.status === "published") {
      await regenerateFeed(c.env);
    }

    return c.json({ id: meta.id, status: meta.status });
  } catch (error) {
    // エラー時は failed に
    try {
      const meta = await getEpisodeMeta(c.env, id);
      meta.status = "failed";
      await saveEpisodeMeta(c.env, meta);
    } catch {
      // ignore
    }
    return c.json({ error: "Failed to process audio file" }, 500);
  }
});

export { upload };
