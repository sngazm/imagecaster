import type { Env, PodcastIndex, EpisodeMeta } from "../types";

/**
 * デフォルトの Podcast インデックス
 */
function createDefaultIndex(env: Env): PodcastIndex {
  return {
    podcast: {
      title: env.PODCAST_TITLE || "Podcast",
      description: "",
      author: "",
      email: "",
      language: "ja",
      category: "Technology",
      artworkUrl: "",
      websiteUrl: env.WEBSITE_URL || "",
      explicit: false,
    },
    episodes: [],
  };
}

/**
 * index.json を取得
 */
export async function getIndex(env: Env): Promise<PodcastIndex> {
  const obj = await env.R2_BUCKET.get("index.json");

  if (!obj) {
    return createDefaultIndex(env);
  }

  const text = await obj.text();
  return JSON.parse(text) as PodcastIndex;
}

/**
 * index.json を保存
 */
export async function saveIndex(env: Env, index: PodcastIndex): Promise<void> {
  await env.R2_BUCKET.put("index.json", JSON.stringify(index, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * エピソードの meta.json を取得
 */
export async function getEpisodeMeta(
  env: Env,
  episodeId: string
): Promise<EpisodeMeta> {
  const obj = await env.R2_BUCKET.get(`episodes/${episodeId}/meta.json`);

  if (!obj) {
    throw new Error(`Episode not found: ${episodeId}`);
  }

  const text = await obj.text();
  return JSON.parse(text) as EpisodeMeta;
}

/**
 * エピソードの meta.json を保存
 */
export async function saveEpisodeMeta(
  env: Env,
  meta: EpisodeMeta
): Promise<void> {
  await env.R2_BUCKET.put(
    `episodes/${meta.id}/meta.json`,
    JSON.stringify(meta, null, 2),
    {
      httpMetadata: {
        contentType: "application/json",
      },
    }
  );
}

/**
 * エピソードを削除（R2からファイルを削除）
 */
export async function deleteEpisode(env: Env, episodeId: string): Promise<void> {
  const prefix = `episodes/${episodeId}/`;

  // エピソードディレクトリ内のすべてのオブジェクトを一覧
  const listed = await env.R2_BUCKET.list({ prefix });

  // すべてのオブジェクトを削除
  const deletePromises = listed.objects.map((obj) =>
    env.R2_BUCKET.delete(obj.key)
  );

  await Promise.all(deletePromises);
}

/**
 * 音声ファイルを R2 に保存
 */
export async function saveAudioFile(
  env: Env,
  episodeId: string,
  audioData: ArrayBuffer
): Promise<{ size: number }> {
  const key = `episodes/${episodeId}/audio.mp3`;

  await env.R2_BUCKET.put(key, audioData, {
    httpMetadata: {
      contentType: "audio/mpeg",
    },
  });

  return { size: audioData.byteLength };
}

/**
 * 文字起こしファイル（VTT）を取得
 */
export async function getTranscript(
  env: Env,
  episodeId: string
): Promise<string | null> {
  const obj = await env.R2_BUCKET.get(`episodes/${episodeId}/transcript.vtt`);

  if (!obj) {
    return null;
  }

  return obj.text();
}

/**
 * 公開済みエピソードの一覧を取得
 */
export async function getPublishedEpisodes(env: Env): Promise<EpisodeMeta[]> {
  const index = await getIndex(env);

  const episodes = await Promise.all(
    index.episodes.map((ref) => getEpisodeMeta(env, ref.id))
  );

  return episodes
    .filter((ep) => ep.status === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime()
    );
}
