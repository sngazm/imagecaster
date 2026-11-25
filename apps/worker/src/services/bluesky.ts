/**
 * Bluesky API クライアント
 * AT Protocol を使用してBlueskyに投稿
 *
 * 公開した瞬間には投稿しない。公開サイトは静的ビルドなので、公開から数分はエピソードの
 * ページも、そのページの OGP 画像（1200x630。ビルド時に描く）もまだ無い。
 * その間に投稿すると、リンクを押しても何も出ないうえ、カードの画像に正方形のアートワークを
 * 使うしかなく、Bluesky がそれを横長に切り抜いて上下が欠ける。
 *
 * そこで公開の時点では待ち行列（index.json の blueskyPostIds）に入れるだけにして、
 * Cron がページが出たのを確かめてから、そのページの OGP 画像を付けて投稿する。
 */

import type { Env, EpisodeMeta } from "../types";
import { getIndex, saveIndex, findEpisodeBySlug, saveEpisodeMeta } from "./r2";
import { fetchLiveEpisodePage, extractOgImageUrl } from "./episode-page";

/** ページが出ないまま、これだけ経ったら諦める。古い回を後から投稿しないため */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

const BLUESKY_API_URL = "https://bsky.social/xrpc";

/**
 * セッション情報
 */
export interface BlueskySession {
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
export async function createSession(
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
export function detectUrls(text: string): Facet[] {
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
  imageUrls: string[] = []
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
    // 先頭から順に試し、最初にアップロードできた画像をサムネイルにする
    let thumbBlob: BlobRef | null = null;
    for (const imageUrl of imageUrls) {
      thumbBlob = await uploadImageBlob(session, imageUrl);
      if (thumbBlob) break;
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
 * @param imageUrls - カードの画像の候補。先頭から順に試す（ページの OGP 画像 > アートワーク）
 * @returns 投稿成功時はtrue
 */
export async function postEpisodeToBluesky(
  env: Env,
  meta: EpisodeMeta,
  websiteUrl: string,
  imageUrls: Array<string | null | undefined> = []
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

    // 投稿
    const result = await createPost(
      session,
      postText,
      episodeUrl,
      meta.title,
      meta.description.slice(0, 300), // 説明文は300文字まで
      imageUrls.filter((url): url is string => Boolean(url))
    );

    console.log(`Posted to Bluesky: ${result.uri}`);
    return true;
  } catch (error) {
    console.error("Failed to post to Bluesky:", error);
    return false;
  }
}

/**
 * 公開されたエピソードを、Bluesky への投稿の待ち行列に入れる
 *
 * 投稿しない設定のもの・すでに投稿したものは入れない（待ち行列が溜まり続けるのを避ける）。
 */
export async function queueBlueskyPost(env: Env, meta: EpisodeMeta): Promise<void> {
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_PASSWORD) return;
  if (!meta.blueskyPostEnabled || !meta.blueskyPostText || meta.blueskyPostedAt) return;

  const index = await getIndex(env);
  const ids = index.blueskyPostIds ?? [];
  if (ids.includes(meta.id)) return;

  index.blueskyPostIds = [...ids, meta.id];
  await saveIndex(env, index);
}

/**
 * Cron 処理: 待ち行列のエピソードのうち、ページが出たものを Bluesky に投稿する
 *
 * ページがまだ無いもの・投稿に失敗したものは残して、次の回でやり直す。
 */
export async function handleBlueskyPosts(env: Env): Promise<void> {
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_PASSWORD) return;

  const index = await getIndex(env);
  const ids = index.blueskyPostIds ?? [];
  if (ids.length === 0) return;

  const now = new Date();
  const settled: string[] = [];

  for (const id of ids) {
    const meta = await findEpisodeBySlug(env, id);

    // 消された・公開をやめた・投稿をやめた・すでに出したものは待たない
    if (
      !meta ||
      meta.publishStatus !== "published" ||
      !meta.blueskyPostEnabled ||
      !meta.blueskyPostText ||
      meta.blueskyPostedAt
    ) {
      settled.push(id);
      continue;
    }

    const publishedAt = meta.publishedAt ? new Date(meta.publishedAt).getTime() : now.getTime();
    const expired = now.getTime() - publishedAt > GIVE_UP_AFTER_MS;

    const page = await fetchLiveEpisodePage(env.WEBSITE_URL, meta.slug);
    const posted =
      page !== null &&
      (await postEpisodeToBluesky(env, meta, env.WEBSITE_URL, [
        // ページの OGP 画像（横長）。取れなければアートワーク（正方形なので上下が切れる）
        extractOgImageUrl(page),
        meta.artworkUrl,
        index.podcast.artworkUrl,
      ]));

    if (posted) {
      meta.blueskyPostedAt = now.toISOString();
      await saveEpisodeMeta(env, meta);
      settled.push(id);
      console.log(`[Bluesky] 投稿した: ${id}`);
    } else if (expired) {
      settled.push(id);
      console.error(`[Bluesky] 24 時間たっても出せなかったので諦める: ${id}（ページ: ${page ? "あり" : "なし"}）`);
    } else {
      console.log(`[Bluesky] 次の回に持ち越す: ${id}（ページ: ${page ? "あり" : "なし"}）`);
    }
  }

  if (settled.length === 0) return;

  // 確認している間に別の公開で待ち行列が増えているかもしれないので読み直す
  const current = await getIndex(env);
  current.blueskyPostIds = (current.blueskyPostIds ?? []).filter((id) => !settled.includes(id));
  await saveIndex(env, current);
}
