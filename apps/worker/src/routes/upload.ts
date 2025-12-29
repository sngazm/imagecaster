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
  getEpisodeMeta,
  saveEpisodeMeta,
  saveAudioFile,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";
import { postEpisodeToBluesky } from "../services/bluesky";
import { triggerWebRebuild } from "../services/deploy";

const upload = new Hono<{ Bindings: Env }>();

/**
 * NextCloud共有リンクを直接ダウンロードURLに変換
 */
function convertToDirectDownloadUrl(url: string): string {
  const nextcloudPattern = /^(https?:\/\/[^/]+)(\/index\.php)?(\/s\/[a-zA-Z0-9]+)\/?$/;
  const match = url.match(nextcloudPattern);

  if (match) {
    const baseUrl = match[1] + (match[2] || "") + match[3];
    return `${baseUrl}/download`;
  }

  return url;
}

/**
 * POST /api/podcasts/:podcastId/episodes/:id/upload-url - Presigned URL 発行
 */
upload.post("/:id/upload-url", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<UploadUrlRequest>();

  if (!body.contentType || !body.fileSize) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    const meta = await getEpisodeMeta(c.env, podcastId, id);

    if (meta.status !== "draft" && meta.status !== "failed") {
      return c.json(
        { error: "Episode is not in draft or failed status" },
        400
      );
    }

    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `podcasts/${podcastId}/episodes/${id}/audio.mp3`;
    const url = new URL(
      `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`
    );

    const signed = await r2.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": body.contentType },
      }),
      { aws: { signQuery: true }, expiresIn: 3600 }
    );

    meta.status = "uploading";
    meta.fileSize = body.fileSize;
    await saveEpisodeMeta(c.env, podcastId, meta);

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
 * POST /api/podcasts/:podcastId/episodes/:id/upload-complete - アップロード完了通知
 */
upload.post("/:id/upload-complete", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<UploadCompleteRequest>();

  try {
    const meta = await getEpisodeMeta(c.env, podcastId, id);
    const index = await getIndex(c.env, podcastId);

    if (meta.status !== "uploading") {
      return c.json({ error: "Episode is not in uploading status" }, 400);
    }

    const audioKey = `podcasts/${podcastId}/episodes/${id}/audio.mp3`;
    let fileSize = body.fileSize || 0;

    if (c.env.IS_DEV !== "true") {
      const audioObj = await c.env.R2_BUCKET.head(audioKey);
      if (!audioObj) {
        return c.json({ error: "Audio file not found in R2" }, 400);
      }
      fileSize = audioObj.size;
    }

    meta.duration = body.duration;
    meta.fileSize = fileSize;
    meta.audioUrl = `${c.env.R2_PUBLIC_URL}/${audioKey}`;

    if (meta.publishAt === null) {
      meta.status = "draft";
    } else if (meta.skipTranscription) {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.status = "published";
        meta.publishedAt = now.toISOString();

        const posted = await postEpisodeToBluesky(c.env, podcastId, meta, index.podcast.websiteUrl);
        if (posted) {
          meta.blueskyPostedAt = now.toISOString();
        }
      } else {
        meta.status = "scheduled";
      }
    } else {
      meta.status = "transcribing";
    }

    await saveEpisodeMeta(c.env, podcastId, meta);

    if (meta.status === "published") {
      await regenerateFeed(c.env, podcastId);
      await triggerWebRebuild(c.env, podcastId);
    }

    return c.json({ id: meta.id, status: meta.status });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/podcasts/:podcastId/episodes/:id/upload-from-url - URL から音声を取得
 */
upload.post("/:id/upload-from-url", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<UploadFromUrlRequest>();

  if (!body.sourceUrl) {
    return c.json({ error: "Missing sourceUrl" }, 400);
  }

  try {
    const meta = await getEpisodeMeta(c.env, podcastId, id);
    const index = await getIndex(c.env, podcastId);

    if (meta.status !== "draft" && meta.status !== "failed") {
      return c.json(
        { error: "Episode is not in draft or failed status" },
        400
      );
    }

    meta.status = "processing";
    await saveEpisodeMeta(c.env, podcastId, meta);

    const downloadUrl = convertToDirectDownloadUrl(body.sourceUrl);
    const audioResponse = await fetch(downloadUrl);

    if (!audioResponse.ok) {
      meta.status = "failed";
      await saveEpisodeMeta(c.env, podcastId, meta);
      return c.json({ error: "Failed to download audio file" }, 400);
    }

    const audioData = await audioResponse.arrayBuffer();
    const { size } = await saveAudioFile(c.env, podcastId, id, audioData);

    meta.fileSize = size;
    meta.audioUrl = `${c.env.R2_PUBLIC_URL}/podcasts/${podcastId}/episodes/${id}/audio.mp3`;

    if (meta.publishAt === null) {
      meta.status = "draft";
    } else if (meta.skipTranscription) {
      const now = new Date();
      if (new Date(meta.publishAt) <= now) {
        meta.status = "published";
        meta.publishedAt = now.toISOString();

        const posted = await postEpisodeToBluesky(c.env, podcastId, meta, index.podcast.websiteUrl);
        if (posted) {
          meta.blueskyPostedAt = now.toISOString();
        }
      } else {
        meta.status = "scheduled";
      }
    } else {
      meta.status = "transcribing";
    }

    await saveEpisodeMeta(c.env, podcastId, meta);

    if (meta.status === "published") {
      await regenerateFeed(c.env, podcastId);
      await triggerWebRebuild(c.env, podcastId);
    }

    return c.json({ id: meta.id, status: meta.status });
  } catch (error) {
    try {
      const meta = await getEpisodeMeta(c.env, podcastId, id);
      meta.status = "failed";
      await saveEpisodeMeta(c.env, podcastId, meta);
    } catch {
      // ignore
    }
    return c.json({ error: "Failed to process audio file" }, 500);
  }
});

/**
 * POST /api/podcasts/:podcastId/episodes/:id/og-image/upload-url - エピソードOGP画像のPresigned URL発行
 */
upload.post("/:id/og-image/upload-url", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<{ contentType: string; fileSize: number }>();
  const index = await getIndex(c.env, podcastId);

  const { contentType, fileSize } = body;

  if (!["image/jpeg", "image/png"].includes(contentType)) {
    return c.json({ error: "Invalid content type. Use image/jpeg or image/png" }, 400);
  }

  if (fileSize > 5 * 1024 * 1024) {
    return c.json({ error: "File too large. Max 5MB" }, 400);
  }

  try {
    const meta = await getEpisodeMeta(c.env, podcastId, id);

    const extension = contentType === "image/png" ? "png" : "jpg";
    const key = `podcasts/${podcastId}/episodes/${meta.slug}/og-image.${extension}`;

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
      ogImageUrl: `${index.podcast.websiteUrl}/episodes/${meta.slug}/og-image.${extension}`,
    });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/podcasts/:podcastId/episodes/:id/og-image/upload-complete - エピソードOGP画像アップロード完了通知
 */
upload.post("/:id/og-image/upload-complete", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<{ ogImageUrl: string }>();

  try {
    const meta = await getEpisodeMeta(c.env, podcastId, id);
    meta.ogImageUrl = body.ogImageUrl;
    await saveEpisodeMeta(c.env, podcastId, meta);

    return c.json({ success: true, ogImageUrl: body.ogImageUrl });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { upload };
