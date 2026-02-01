import type { Env, PodcastIndex, EpisodeMeta, TemplatesIndex, DescriptionTemplate, PublishStatus, TranscribeStatus } from "../types";

/**
 * storageKey 用のランダム文字列を生成（8文字の英数小文字）
 */
export function generateStorageToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

/**
 * slug から storageKey を生成
 */
export function generateStorageKey(slug: string): string {
  return `${slug}-${generateStorageToken()}`;
}

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
      applePodcastsId: null,
      applePodcastsAutoFetch: false,
    },
    episodes: [],
  };
}

/**
 * index.json を取得（公開用: published エピソードのみ）
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
 * index.json を保存（公開用: published エピソードのみ）
 */
export async function saveIndex(env: Env, index: PodcastIndex): Promise<void> {
  await env.R2_BUCKET.put("index.json", JSON.stringify(index, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * R2 binding の list() を使って全エピソードを列挙
 * index.json を使わず、R2のディレクトリ構造から直接取得
 */
export async function listAllEpisodes(env: Env): Promise<EpisodeMeta[]> {
  const storageKeys: string[] = [];
  let cursor: string | undefined;

  // ページネーション対応で全ディレクトリを取得
  do {
    const listed = await env.R2_BUCKET.list({
      prefix: "episodes/",
      delimiter: "/",
      cursor,
    });

    for (const prefix of listed.delimitedPrefixes) {
      // prefix = "episodes/ep-015-a7f3c2b1/"
      const key = prefix.replace("episodes/", "").replace(/\/$/, "");
      if (key) {
        storageKeys.push(key);
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // 各ディレクトリの meta.json を並列で読み込み
  const episodes = await Promise.all(
    storageKeys.map(async (key) => {
      try {
        return await getEpisodeMeta(env, key);
      } catch {
        return null;
      }
    })
  );

  return episodes.filter((ep): ep is EpisodeMeta => ep !== null);
}

/**
 * エピソードの meta.json を取得
 * @param storageKey R2ディレクトリ名（storageKey）
 */
export async function getEpisodeMeta(
  env: Env,
  storageKey: string
): Promise<EpisodeMeta> {
  const obj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);

  if (!obj) {
    throw new Error(`Episode not found: ${storageKey}`);
  }

  const text = await obj.text();
  const data = JSON.parse(text);

  // 後方互換性のため、存在しないフィールドにデフォルト値を設定
  // 古いstatusフィールドからpublishStatus/transcribeStatusへの移行
  let publishStatus = data.publishStatus;
  let transcribeStatus = data.transcribeStatus;

  if (!publishStatus && data.status) {
    // 古いstatus形式からの移行
    const oldStatus = data.status as string;
    if (oldStatus === "transcribing") {
      publishStatus = "draft";
      transcribeStatus = "transcribing";
    } else if (["draft", "uploading", "scheduled", "published"].includes(oldStatus)) {
      publishStatus = oldStatus;
      // transcribeStatusを推測
      if (data.transcriptUrl) {
        transcribeStatus = "completed";
      } else if (data.skipTranscription) {
        transcribeStatus = "skipped";
      } else {
        transcribeStatus = "none";
      }
    } else {
      publishStatus = "new";
      transcribeStatus = "none";
    }
  }

  // デフォルト値
  if (!publishStatus) {
    publishStatus = "new";
  }
  if (!transcribeStatus) {
    if (data.transcriptUrl) {
      transcribeStatus = "completed";
    } else if (data.skipTranscription) {
      transcribeStatus = "skipped";
    } else {
      transcribeStatus = "none";
    }
  }

  return {
    ...data,
    storageKey: data.storageKey || storageKey,
    publishStatus,
    transcribeStatus,
    referenceLinks: data.referenceLinks ?? [],
    sourceGuid: data.sourceGuid ?? null,
  } as EpisodeMeta;
}

/**
 * エピソードの meta.json を保存
 * storageKey をディレクトリ名として使用
 */
export async function saveEpisodeMeta(
  env: Env,
  meta: EpisodeMeta
): Promise<void> {
  await env.R2_BUCKET.put(
    `episodes/${meta.storageKey}/meta.json`,
    JSON.stringify(meta, null, 2),
    {
      httpMetadata: {
        contentType: "application/json",
      },
    }
  );
}

/**
 * slug から storageKey を解決してエピソードを検索
 * R2.list() で prefix "episodes/{slug}-" を検索し、slug が一致するものを返す
 */
export async function findEpisodeBySlug(env: Env, slug: string): Promise<EpisodeMeta | null> {
  // まず prefix で絞り込み（slug- にマッチするディレクトリを検索）
  const listed = await env.R2_BUCKET.list({
    prefix: `episodes/${slug}-`,
    delimiter: "/",
  });

  for (const prefix of listed.delimitedPrefixes) {
    const storageKey = prefix.replace("episodes/", "").replace(/\/$/, "");
    try {
      const meta = await getEpisodeMeta(env, storageKey);
      if (meta.slug === slug || meta.id === slug) {
        return meta;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 公開用 index.json のエピソード部分を同期
 * published → index に追加、それ以外 → index から除去
 */
export async function syncPublishedIndex(
  env: Env,
  meta: EpisodeMeta
): Promise<void> {
  const index = await getIndex(env);
  const existingIdx = index.episodes.findIndex((ep) => ep.id === meta.id);

  if (meta.publishStatus === "published") {
    // 公開済 → index に追加 or 更新
    const entry = { id: meta.id, storageKey: meta.storageKey };
    if (existingIdx >= 0) {
      index.episodes[existingIdx] = entry;
    } else {
      index.episodes.push(entry);
    }
  } else {
    // 非公開 → index から除去
    if (existingIdx >= 0) {
      index.episodes.splice(existingIdx, 1);
    }
  }

  await saveIndex(env, index);
}

/**
 * エピソードを削除（R2からファイルを削除）
 * @param storageKey R2ディレクトリ名
 */
export async function deleteEpisode(env: Env, storageKey: string): Promise<void> {
  const prefix = `episodes/${storageKey}/`;

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
 * @param storageKey R2ディレクトリ名
 */
export async function saveAudioFile(
  env: Env,
  storageKey: string,
  audioData: ArrayBuffer
): Promise<{ size: number }> {
  const key = `episodes/${storageKey}/audio.mp3`;

  await env.R2_BUCKET.put(key, audioData, {
    httpMetadata: {
      contentType: "audio/mpeg",
    },
  });

  return { size: audioData.byteLength };
}

/**
 * 音声ファイルを R2 から取得
 * @param storageKey R2ディレクトリ名
 */
export async function getAudioFile(
  env: Env,
  storageKey: string
): Promise<R2ObjectBody | null> {
  const key = `episodes/${storageKey}/audio.mp3`;
  return env.R2_BUCKET.get(key);
}

/**
 * 文字起こしファイル（VTT）を取得
 * @param storageKey R2ディレクトリ名
 */
export async function getTranscript(
  env: Env,
  storageKey: string
): Promise<string | null> {
  const obj = await env.R2_BUCKET.get(`episodes/${storageKey}/transcript.vtt`);

  if (!obj) {
    return null;
  }

  return obj.text();
}

/**
 * 公開済みエピソードの一覧を取得
 * index.json（published のみ）から storageKey を使って meta を取得
 */
export async function getPublishedEpisodes(env: Env): Promise<EpisodeMeta[]> {
  const index = await getIndex(env);

  const episodes = await Promise.all(
    index.episodes.map((ref) => getEpisodeMeta(env, ref.storageKey))
  );

  return episodes
    .filter((ep) => ep.publishStatus === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime()
    );
}

/**
 * テンプレートインデックスを取得
 */
export async function getTemplatesIndex(env: Env): Promise<TemplatesIndex> {
  const obj = await env.R2_BUCKET.get("templates/descriptions.json");

  if (!obj) {
    return { templates: [] };
  }

  const text = await obj.text();
  return JSON.parse(text) as TemplatesIndex;
}

/**
 * テンプレートインデックスを保存
 */
export async function saveTemplatesIndex(env: Env, index: TemplatesIndex): Promise<void> {
  await env.R2_BUCKET.put("templates/descriptions.json", JSON.stringify(index, null, 2), {
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
  data: ArrayBuffer,
  contentType: string
): Promise<string> {
  const extension = contentType === "image/png" ? "png" : "jpg";
  const key = `assets/artwork.${extension}`;

  await env.R2_BUCKET.put(key, data, {
    httpMetadata: {
      contentType,
    },
  });

  // 公開URLを返す
  return `${env.WEBSITE_URL}/${key}`;
}

/**
 * R2バケット内の全データを削除
 */
export async function deleteAllData(env: Env): Promise<{
  deletedCount: number;
  deletedKeys: string[];
}> {
  const deletedKeys: string[] = [];
  let cursor: string | undefined;

  // 全オブジェクトを一覧して削除（ページネーション対応）
  do {
    const listed = await env.R2_BUCKET.list({ cursor, limit: 1000 });

    if (listed.objects.length > 0) {
      const keys = listed.objects.map((obj) => obj.key);
      deletedKeys.push(...keys);

      // バッチ削除
      await Promise.all(keys.map((key) => env.R2_BUCKET.delete(key)));
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return {
    deletedCount: deletedKeys.length,
    deletedKeys,
  };
}

/**
 * エピソードを別のstorageKey（フォルダ）に移動
 */
export async function moveEpisode(
  env: Env,
  oldStorageKey: string,
  newStorageKey: string
): Promise<void> {
  const oldPrefix = `episodes/${oldStorageKey}/`;
  const newPrefix = `episodes/${newStorageKey}/`;

  // 古いフォルダ内のオブジェクトを一覧
  const listed = await env.R2_BUCKET.list({ prefix: oldPrefix });

  // 各オブジェクトをコピーして削除
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
