/**
 * Bluesky API クライアント
 * AT Protocol を使用してBlueskyに投稿
 */

import type { Env, EpisodeMeta } from "../types";

const BLUESKY_API_URL = "https://bsky.social/xrpc";

/**
 * セッション情報
 */
interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
}

/**
 * Facet (リンク等のリッチテキスト要素)
 */
interface Facet {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: Array<{
    $type: string;
    uri?: string;
  }>;
}

/**
 * Blobアップロード結果
 */
interface BlobRef {
  $type: "blob";
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}

/**
 * 投稿レコード
 */
interface PostRecord {
  $type: "app.bsky.feed.post";
  text: string;
  createdAt: string;
  facets?: Facet[];
  embed?: {
    $type: "app.bsky.embed.external";
    external: {
      uri: string;
      title: string;
      description: string;
      thumb?: BlobRef;
    };
  };
}

/**
 * Blueskyにログイン
 */
async function createSession(
  identifier: string,
  password: string
): Promise<BlueskySession> {
  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.server.createSession`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bluesky login failed: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * 画像をダウンロードしてBlueskyにアップロード
 */
async function uploadImageBlob(
  session: BlueskySession,
  imageUrl: string
): Promise<BlobRef | null> {
  try {
    // 画像をダウンロード
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageResponse.status} - ${imageUrl}`);
      return null;
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await imageResponse.arrayBuffer();

    // Blueskyの画像サイズ制限 (1MB)
    if (imageBuffer.byteLength > 1000000) {
      console.warn(`Image too large for Bluesky (${imageBuffer.byteLength} bytes), skipping thumbnail`);
      return null;
    }

    // Blueskyにアップロード
    const uploadResponse = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      console.error(`Failed to upload blob to Bluesky: ${uploadResponse.status} - ${error}`);
      return null;
    }

    const result = await uploadResponse.json() as { blob: BlobRef };
    return result.blob;
  } catch (error) {
    console.error("Error uploading image to Bluesky:", error);
    return null;
  }
}

/**
 * テキスト内のURLを検出してfacetsを生成
 */
function detectUrls(text: string): Facet[] {
  const facets: Facet[] = [];
  const urlRegex = /https?:\/\/[^\s\u3000]+/g;

  // テキストをUTF-8バイト列に変換してバイト位置を計算
  const encoder = new TextEncoder();
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0];
    const beforeText = text.slice(0, match.index);
    const byteStart = encoder.encode(beforeText).length;
    const byteEnd = byteStart + encoder.encode(url).length;

    facets.push({
      index: {
        byteStart,
        byteEnd,
      },
      features: [
        {
          $type: "app.bsky.richtext.facet#link",
          uri: url,
        },
      ],
    });
  }

  return facets;
}

/**
 * 投稿を作成
 */
async function createPost(
  session: BlueskySession,
  text: string,
  episodeUrl?: string,
  episodeTitle?: string,
  episodeDescription?: string,
  ogImageUrl?: string
): Promise<{ uri: string; cid: string }> {
  const facets = detectUrls(text);

  const record: PostRecord = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };

  if (facets.length > 0) {
    record.facets = facets;
  }

  // エピソードURLがある場合は外部リンクカードを追加
  if (episodeUrl && episodeTitle) {
    // OGP画像があればアップロードしてサムネイルとして設定
    let thumbBlob: BlobRef | null = null;
    if (ogImageUrl) {
      thumbBlob = await uploadImageBlob(session, ogImageUrl);
    }

    record.embed = {
      $type: "app.bsky.embed.external",
      external: {
        uri: episodeUrl,
        title: episodeTitle,
        description: episodeDescription || "",
        ...(thumbBlob && { thumb: thumbBlob }),
      },
    };
  }

  const response = await fetch(`${BLUESKY_API_URL}/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bluesky post failed: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * エピソードをBlueskyに投稿
 *
 * @param env - 環境変数
 * @param meta - エピソードメタデータ
 * @param websiteUrl - ウェブサイトのベースURL
 * @param fallbackImageUrl - OGP画像がない場合のフォールバック画像URL（artworkUrl等）
 * @returns 投稿成功時はtrue
 */
export async function postEpisodeToBluesky(
  env: Env,
  meta: EpisodeMeta,
  websiteUrl: string,
  fallbackImageUrl?: string
): Promise<boolean> {
  // 認証情報がない場合はスキップ
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_PASSWORD) {
    console.log("Bluesky credentials not configured, skipping post");
    return false;
  }

  // 投稿が無効または投稿テキストがない場合はスキップ
  if (!meta.blueskyPostEnabled || !meta.blueskyPostText) {
    console.log(`Bluesky post disabled or no text for episode: ${meta.id}`);
    return false;
  }

  // すでに投稿済みの場合はスキップ
  if (meta.blueskyPostedAt) {
    console.log(`Already posted to Bluesky for episode: ${meta.id}`);
    return false;
  }

  try {
    // ログイン
    const session = await createSession(
      env.BLUESKY_IDENTIFIER,
      env.BLUESKY_PASSWORD
    );

    // エピソードURL
    const episodeUrl = `${websiteUrl}/episodes/${meta.slug}`;

    // プレースホルダを置換
    const postText = meta.blueskyPostText
      .replace(/\{\{EPISODE_URL\}\}/g, episodeUrl)
      .replace(/\{\{TITLE\}\}/g, meta.title)
      .replace(/\{\{AUDIO_URL\}\}/g, meta.audioUrl || "");

    // サムネイル画像URL（エピソード固有のアートワーク > Podcastアートワーク）
    const ogImageUrl = meta.artworkUrl || fallbackImageUrl;

    // 投稿
    const result = await createPost(
      session,
      postText,
      episodeUrl,
      meta.title,
      meta.description.slice(0, 300), // 説明文は300文字まで
      ogImageUrl || undefined
    );

    console.log(`Posted to Bluesky: ${result.uri}`);
    return true;
  } catch (error) {
    console.error("Failed to post to Bluesky:", error);
    return false;
  }
}
