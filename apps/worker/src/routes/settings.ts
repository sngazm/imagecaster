import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type { Env, UpdatePodcastSettingsRequest } from "../types";
import { getIndex, saveIndex, saveArtwork } from "../services/r2";

export const settings = new Hono<{ Bindings: Env }>();

/**
 * Podcast設定を取得
 */
settings.get("/", async (c) => {
  const index = await getIndex(c.env);
  return c.json(index.podcast);
});

/**
 * Podcast設定を更新
 */
settings.put("/", async (c) => {
  const body = await c.req.json<UpdatePodcastSettingsRequest>();
  const index = await getIndex(c.env);

  // 更新可能なフィールドのみ反映
  if (body.title !== undefined) index.podcast.title = body.title;
  if (body.description !== undefined) index.podcast.description = body.description;
  if (body.author !== undefined) index.podcast.author = body.author;
  if (body.email !== undefined) index.podcast.email = body.email;
  if (body.language !== undefined) index.podcast.language = body.language;
  if (body.category !== undefined) index.podcast.category = body.category;
  if (body.websiteUrl !== undefined) index.podcast.websiteUrl = body.websiteUrl;
  if (body.explicit !== undefined) index.podcast.explicit = body.explicit;
  if (body.applePodcastsId !== undefined) index.podcast.applePodcastsId = body.applePodcastsId;
  // 購読リンク
  if (body.applePodcastsUrl !== undefined) index.podcast.applePodcastsUrl = body.applePodcastsUrl;
  if (body.spotifyUrl !== undefined) index.podcast.spotifyUrl = body.spotifyUrl;

  await saveIndex(c.env, index);

  return c.json(index.podcast);
});

/**
 * アートワークアップロード用のPresigned URL発行
 */
settings.post("/artwork/upload-url", async (c) => {
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

  const extension = contentType === "image/png" ? "png" : "jpg";
  const key = `assets/artwork.${extension}`;

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
    artworkUrl: `${c.env.WEBSITE_URL}/${key}`,
  });
});

/**
 * アートワークアップロード完了通知
 */
settings.post("/artwork/upload-complete", async (c) => {
  const body = await c.req.json<{ artworkUrl: string }>();
  const index = await getIndex(c.env);

  index.podcast.artworkUrl = body.artworkUrl;
  await saveIndex(c.env, index);

  return c.json({ success: true, artworkUrl: body.artworkUrl });
});

/**
 * OGP画像アップロード用のPresigned URL発行
 */
settings.post("/og-image/upload-url", async (c) => {
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

  const extension = contentType === "image/png" ? "png" : "jpg";
  const key = `assets/og-image.${extension}`;

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
    ogImageUrl: `${c.env.WEBSITE_URL}/${key}`,
  });
});

/**
 * OGP画像アップロード完了通知
 */
settings.post("/og-image/upload-complete", async (c) => {
  const body = await c.req.json<{ ogImageUrl: string }>();
  const index = await getIndex(c.env);

  index.podcast.ogImageUrl = body.ogImageUrl;
  await saveIndex(c.env, index);

  return c.json({ success: true, ogImageUrl: body.ogImageUrl });
});
