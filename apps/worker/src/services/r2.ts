import type { Env, PodcastsIndex, PodcastIndex, EpisodeMeta, TemplatesIndex } from "../types";

/**
 * ポッドキャスト一覧を取得 (podcasts/index.json)
 */
export async function getPodcastsIndex(env: Env): Promise<PodcastsIndex> {
  const obj = await env.R2_BUCKET.get("podcasts/index.json");

  if (!obj) {
    return { podcasts: [] };
  }

  const text = await obj.text();
  return JSON.parse(text) as PodcastsIndex;
}

/**
 * ポッドキャスト一覧を保存
 */
export async function savePodcastsIndex(env: Env, index: PodcastsIndex): Promise<void> {
  await env.R2_BUCKET.put("podcasts/index.json", JSON.stringify(index, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * デフォルトの Podcast インデックス
 */
function createDefaultIndex(podcastId: string): PodcastIndex {
  return {
    podcast: {
      id: podcastId,
      title: "新しいポッドキャスト",
      description: "",
      author: "",
      email: "",
      language: "ja",
      category: "Technology",
      artworkUrl: "",
      ogImageUrl: "",
      websiteUrl: "",
      explicit: false,
    },
    episodes: [],
  };
}

/**
 * 個別ポッドキャストのインデックスを取得 (podcasts/{podcastId}/index.json)
 */
export async function getIndex(env: Env, podcastId: string): Promise<PodcastIndex> {
  const obj = await env.R2_BUCKET.get(`podcasts/${podcastId}/index.json`);

  if (!obj) {
    return createDefaultIndex(podcastId);
  }

  const text = await obj.text();
  return JSON.parse(text) as PodcastIndex;
}

/**
 * 個別ポッドキャストのインデックスを保存
 */
export async function saveIndex(env: Env, podcastId: string, index: PodcastIndex): Promise<void> {
  await env.R2_BUCKET.put(`podcasts/${podcastId}/index.json`, JSON.stringify(index, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * ポッドキャストが存在するかチェック
 */
export async function podcastExists(env: Env, podcastId: string): Promise<boolean> {
  const obj = await env.R2_BUCKET.head(`podcasts/${podcastId}/index.json`);
  return obj !== null;
}

/**
 * ポッドキャストを削除
 */
export async function deletePodcast(env: Env, podcastId: string): Promise<void> {
  const prefix = `podcasts/${podcastId}/`;
  const listed = await env.R2_BUCKET.list({ prefix });

  const deletePromises = listed.objects.map((obj) =>
    env.R2_BUCKET.delete(obj.key)
  );

  await Promise.all(deletePromises);
}

/**
 * エピソードの meta.json を取得
 */
export async function getEpisodeMeta(
  env: Env,
  podcastId: string,
  episodeId: string
): Promise<EpisodeMeta> {
  const obj = await env.R2_BUCKET.get(`podcasts/${podcastId}/episodes/${episodeId}/meta.json`);

  if (!obj) {
    throw new Error(`Episode not found: ${episodeId}`);
  }

  const text = await obj.text();
  const data = JSON.parse(text);

  // 後方互換性のため、存在しないフィールドにデフォルト値を設定
  return {
    ...data,
    referenceLinks: data.referenceLinks ?? [],
  } as EpisodeMeta;
}

/**
 * エピソードの meta.json を保存
 */
export async function saveEpisodeMeta(
  env: Env,
  podcastId: string,
  meta: EpisodeMeta
): Promise<void> {
  await env.R2_BUCKET.put(
    `podcasts/${podcastId}/episodes/${meta.id}/meta.json`,
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
export async function deleteEpisode(env: Env, podcastId: string, episodeId: string): Promise<void> {
  const prefix = `podcasts/${podcastId}/episodes/${episodeId}/`;

  const listed = await env.R2_BUCKET.list({ prefix });

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
  podcastId: string,
  episodeId: string,
  audioData: ArrayBuffer
): Promise<{ size: number }> {
  const key = `podcasts/${podcastId}/episodes/${episodeId}/audio.mp3`;

  await env.R2_BUCKET.put(key, audioData, {
    httpMetadata: {
      contentType: "audio/mpeg",
    },
  });

  return { size: audioData.byteLength };
}

/**
 * 音声ファイルを R2 から取得
 */
export async function getAudioFile(
  env: Env,
  podcastId: string,
  episodeId: string
): Promise<R2ObjectBody | null> {
  const key = `podcasts/${podcastId}/episodes/${episodeId}/audio.mp3`;
  return env.R2_BUCKET.get(key);
}

/**
 * 文字起こしファイル（VTT）を取得
 */
export async function getTranscript(
  env: Env,
  podcastId: string,
  episodeId: string
): Promise<string | null> {
  const obj = await env.R2_BUCKET.get(`podcasts/${podcastId}/episodes/${episodeId}/transcript.vtt`);

  if (!obj) {
    return null;
  }

  return obj.text();
}

/**
 * 公開済みエピソードの一覧を取得
 */
export async function getPublishedEpisodes(env: Env, podcastId: string): Promise<EpisodeMeta[]> {
  const index = await getIndex(env, podcastId);

  const episodes = await Promise.all(
    index.episodes.map((ref) => getEpisodeMeta(env, podcastId, ref.id))
  );

  return episodes
    .filter((ep) => ep.status === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime()
    );
}

/**
 * テンプレートインデックスを取得
 */
export async function getTemplatesIndex(env: Env, podcastId: string): Promise<TemplatesIndex> {
  const obj = await env.R2_BUCKET.get(`podcasts/${podcastId}/templates/descriptions.json`);

  if (!obj) {
    return { templates: [] };
  }

  const text = await obj.text();
  return JSON.parse(text) as TemplatesIndex;
}

/**
 * テンプレートインデックスを保存
 */
export async function saveTemplatesIndex(env: Env, podcastId: string, index: TemplatesIndex): Promise<void> {
  await env.R2_BUCKET.put(`podcasts/${podcastId}/templates/descriptions.json`, JSON.stringify(index, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * アートワークを保存
 */
export async function saveArtwork(
  env: Env,
  podcastId: string,
  data: ArrayBuffer,
  contentType: string
): Promise<string> {
  const extension = contentType === "image/png" ? "png" : "jpg";
  const key = `podcasts/${podcastId}/assets/artwork.${extension}`;

  await env.R2_BUCKET.put(key, data, {
    httpMetadata: {
      contentType,
    },
  });

  return `${env.R2_PUBLIC_URL}/${key}`;
}

/**
 * エピソードをslugで検索
 */
export async function findEpisodeBySlug(env: Env, podcastId: string, slug: string): Promise<EpisodeMeta | null> {
  const index = await getIndex(env, podcastId);

  for (const ref of index.episodes) {
    try {
      const meta = await getEpisodeMeta(env, podcastId, ref.id);
      if (meta.slug === slug) {
        return meta;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * エピソードを別のslug（フォルダ）に移動
 */
export async function moveEpisode(
  env: Env,
  podcastId: string,
  oldId: string,
  newSlug: string
): Promise<void> {
  const oldPrefix = `podcasts/${podcastId}/episodes/${oldId}/`;
  const newPrefix = `podcasts/${podcastId}/episodes/${newSlug}/`;

  const listed = await env.R2_BUCKET.list({ prefix: oldPrefix });

  for (const obj of listed.objects) {
    const newKey = obj.key.replace(oldPrefix, newPrefix);
    const data = await env.R2_BUCKET.get(obj.key);
    if (data) {
      await env.R2_BUCKET.put(newKey, await data.arrayBuffer(), {
        httpMetadata: data.httpMetadata,
      });
      await env.R2_BUCKET.delete(obj.key);
    }
  }
}

/**
 * フィードを保存
 */
export async function saveFeed(env: Env, podcastId: string, feedXml: string): Promise<void> {
  await env.R2_BUCKET.put(`podcasts/${podcastId}/feed.xml`, feedXml, {
    httpMetadata: {
      contentType: "application/xml; charset=utf-8",
    },
  });
}

/**
 * フィードを取得
 */
export async function getFeedFromR2(env: Env, podcastId: string): Promise<string | null> {
  const obj = await env.R2_BUCKET.get(`podcasts/${podcastId}/feed.xml`);

  if (!obj) {
    return null;
  }

  return obj.text();
}
