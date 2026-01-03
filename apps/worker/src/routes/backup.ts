import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type { Env, EpisodeMeta, DescriptionTemplate } from "../types";
import {
  getIndex,
  saveIndex,
  getEpisodeMeta,
  saveEpisodeMeta,
  getTemplatesIndex,
  saveTemplatesIndex,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";

/**
 * エクスポートマニフェストの型定義
 */
export interface ExportManifest {
  version: number;
  exportedAt: string;
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    explicit: boolean;
  };
  templates: DescriptionTemplate[];
  episodes: Array<{
    meta: EpisodeMeta;
    files: {
      audio?: { key: string; url: string };
      transcript?: { key: string; url: string };
      ogImage?: { key: string; url: string };
    };
  }>;
  assets: {
    artwork?: { key: string; url: string };
    ogImage?: { key: string; url: string };
  };
}

/**
 * インポートリクエストの型定義
 */
export interface ImportBackupRequest {
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    explicit: boolean;
  };
  templates: DescriptionTemplate[];
  episodes: Array<{
    meta: Omit<EpisodeMeta, "audioUrl" | "transcriptUrl" | "ogImageUrl"> & {
      audioUrl?: string;
      transcriptUrl?: string;
      ogImageUrl?: string;
    };
    hasAudio: boolean;
    hasTranscript: boolean;
    hasOgImage: boolean;
  }>;
  hasArtwork: boolean;
  hasOgImage: boolean;
}

/**
 * インポートレスポンスの型定義
 */
export interface ImportBackupResponse {
  success: boolean;
  uploadUrls: {
    episodes: Array<{
      id: string;
      audio?: string;
      transcript?: string;
      ogImage?: string;
    }>;
    assets: {
      artwork?: string;
      ogImage?: string;
    };
  };
}

const backup = new Hono<{ Bindings: Env }>();

/**
 * presigned URL for GET（ダウンロード用）を生成
 */
async function generateDownloadUrl(
  env: Env,
  key: string
): Promise<string | null> {
  // ファイルが存在するか確認
  const obj = await env.R2_BUCKET.head(key);
  if (!obj) {
    return null;
  }

  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", "3600");

  const signed = await r2.sign(
    new Request(url, { method: "GET" }),
    { aws: { signQuery: true } }
  );

  return signed.url;
}

/**
 * presigned URL for PUT（アップロード用）を生成
 */
async function generateUploadUrl(
  env: Env,
  key: string,
  contentType: string
): Promise<string> {
  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", "3600");

  const signed = await r2.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } }
  );

  return signed.url;
}

/**
 * GET /api/backup/export - エクスポートマニフェスト取得
 */
backup.get("/export", async (c) => {
  const index = await getIndex(c.env);
  const templatesIndex = await getTemplatesIndex(c.env);

  // 全エピソードのメタデータを取得
  const episodesWithFiles: ExportManifest["episodes"] = [];

  for (const epRef of index.episodes) {
    try {
      const meta = await getEpisodeMeta(c.env, epRef.id);

      const files: ExportManifest["episodes"][0]["files"] = {};

      // 音声ファイル
      const audioKey = `episodes/${meta.id}/audio.mp3`;
      const audioUrl = await generateDownloadUrl(c.env, audioKey);
      if (audioUrl) {
        files.audio = { key: audioKey, url: audioUrl };
      }

      // 文字起こし
      const transcriptKey = `episodes/${meta.id}/transcript.vtt`;
      const transcriptUrl = await generateDownloadUrl(c.env, transcriptKey);
      if (transcriptUrl) {
        files.transcript = { key: transcriptKey, url: transcriptUrl };
      }

      // OG画像（jpg/pngどちらかを確認）
      for (const ext of ["jpg", "png"]) {
        const ogKey = `episodes/${meta.id}/og-image.${ext}`;
        const ogUrl = await generateDownloadUrl(c.env, ogKey);
        if (ogUrl) {
          files.ogImage = { key: ogKey, url: ogUrl };
          break;
        }
      }

      episodesWithFiles.push({ meta, files });
    } catch {
      // エピソードが見つからない場合はスキップ
      continue;
    }
  }

  // アセットのURL取得
  const assets: ExportManifest["assets"] = {};

  // アートワーク
  for (const ext of ["jpg", "png"]) {
    const artworkKey = `assets/artwork.${ext}`;
    const artworkUrl = await generateDownloadUrl(c.env, artworkKey);
    if (artworkUrl) {
      assets.artwork = { key: artworkKey, url: artworkUrl };
      break;
    }
  }

  // サイトOG画像
  for (const ext of ["jpg", "png"]) {
    const ogKey = `assets/og-image.${ext}`;
    const ogUrl = await generateDownloadUrl(c.env, ogKey);
    if (ogUrl) {
      assets.ogImage = { key: ogKey, url: ogUrl };
      break;
    }
  }

  const manifest: ExportManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    podcast: {
      title: index.podcast.title,
      description: index.podcast.description,
      author: index.podcast.author,
      email: index.podcast.email,
      language: index.podcast.language,
      category: index.podcast.category,
      explicit: index.podcast.explicit,
    },
    templates: templatesIndex.templates,
    episodes: episodesWithFiles,
    assets,
  };

  return c.json(manifest);
});

/**
 * POST /api/backup/import - バックアップからインポート開始
 *
 * クライアントはmanifest.jsonの内容を解析して送信する。
 * このエンドポイントは：
 * 1. Podcast設定を更新
 * 2. テンプレートをインポート
 * 3. エピソードのメタデータを作成
 * 4. 各ファイルのアップロードURLを返す
 */
backup.post("/import", async (c) => {
  const body = await c.req.json<ImportBackupRequest>();

  // Podcast設定を更新
  const index = await getIndex(c.env);
  index.podcast = {
    ...index.podcast,
    title: body.podcast.title,
    description: body.podcast.description,
    author: body.podcast.author,
    email: body.podcast.email,
    language: body.podcast.language,
    category: body.podcast.category,
    explicit: body.podcast.explicit,
  };

  // テンプレートをインポート
  if (body.templates.length > 0) {
    await saveTemplatesIndex(c.env, { templates: body.templates });
  }

  // エピソードのアップロードURL
  const episodeUploadUrls: ImportBackupResponse["uploadUrls"]["episodes"] = [];

  for (const ep of body.episodes) {
    const meta: EpisodeMeta = {
      id: ep.meta.id,
      slug: ep.meta.slug,
      title: ep.meta.title,
      description: ep.meta.description,
      duration: ep.meta.duration,
      fileSize: ep.meta.fileSize,
      audioUrl: "",
      sourceAudioUrl: ep.meta.sourceAudioUrl,
      sourceGuid: ep.meta.sourceGuid ?? null,
      transcriptUrl: null,
      ogImageUrl: null,
      skipTranscription: ep.meta.skipTranscription,
      status: "draft", // インポート時は常にdraft
      createdAt: ep.meta.createdAt,
      publishAt: ep.meta.publishAt,
      publishedAt: null, // インポート時はリセット
      blueskyPostText: ep.meta.blueskyPostText,
      blueskyPostEnabled: ep.meta.blueskyPostEnabled,
      blueskyPostedAt: null, // インポート時はリセット
      referenceLinks: ep.meta.referenceLinks || [],
    };

    // インデックスに追加（重複チェック）
    if (!index.episodes.find((e) => e.id === meta.id)) {
      index.episodes.push({ id: meta.id });
    }

    // メタデータを保存
    await saveEpisodeMeta(c.env, meta);

    // アップロードURLを生成
    const urls: (typeof episodeUploadUrls)[0] = { id: meta.id };

    if (ep.hasAudio) {
      urls.audio = await generateUploadUrl(
        c.env,
        `episodes/${meta.id}/audio.mp3`,
        "audio/mpeg"
      );
    }

    if (ep.hasTranscript) {
      urls.transcript = await generateUploadUrl(
        c.env,
        `episodes/${meta.id}/transcript.vtt`,
        "text/vtt"
      );
    }

    if (ep.hasOgImage) {
      // OG画像はjpgとして扱う（zipから展開時に拡張子を判定）
      urls.ogImage = await generateUploadUrl(
        c.env,
        `episodes/${meta.id}/og-image.jpg`,
        "image/jpeg"
      );
    }

    episodeUploadUrls.push(urls);
  }

  // インデックスを保存
  await saveIndex(c.env, index);

  // アセットのアップロードURL
  const assetUrls: ImportBackupResponse["uploadUrls"]["assets"] = {};

  if (body.hasArtwork) {
    assetUrls.artwork = await generateUploadUrl(
      c.env,
      "assets/artwork.jpg",
      "image/jpeg"
    );
  }

  if (body.hasOgImage) {
    assetUrls.ogImage = await generateUploadUrl(
      c.env,
      "assets/og-image.jpg",
      "image/jpeg"
    );
  }

  const response: ImportBackupResponse = {
    success: true,
    uploadUrls: {
      episodes: episodeUploadUrls,
      assets: assetUrls,
    },
  };

  return c.json(response);
});

/**
 * POST /api/backup/import/complete - インポート完了処理
 *
 * ファイルアップロード完了後に呼び出し、以下を行う：
 * 1. 各エピソードのaudioUrl等を更新
 * 2. フィードを再生成
 */
backup.post("/import/complete", async (c) => {
  const body = await c.req.json<{
    episodes: Array<{
      id: string;
      hasAudio: boolean;
      hasTranscript: boolean;
      hasOgImage: boolean;
      status: "draft" | "scheduled" | "published";
    }>;
    hasArtwork: boolean;
    hasOgImage: boolean;
  }>();

  const index = await getIndex(c.env);

  // 各エピソードのURLを更新
  for (const ep of body.episodes) {
    try {
      const meta = await getEpisodeMeta(c.env, ep.id);

      if (ep.hasAudio) {
        meta.audioUrl = `${c.env.R2_PUBLIC_URL}/episodes/${meta.id}/audio.mp3`;
      }

      if (ep.hasTranscript) {
        meta.transcriptUrl = `${c.env.R2_PUBLIC_URL}/episodes/${meta.id}/transcript.vtt`;
      }

      if (ep.hasOgImage) {
        meta.ogImageUrl = `${c.env.R2_PUBLIC_URL}/episodes/${meta.id}/og-image.jpg`;
      }

      // ステータスを更新（音声がある場合のみ）
      if (ep.hasAudio) {
        meta.status = ep.status;
        if (ep.status === "published") {
          meta.publishedAt = meta.publishedAt || new Date().toISOString();
        }
      }

      await saveEpisodeMeta(c.env, meta);
    } catch {
      continue;
    }
  }

  // アセットURLを更新
  if (body.hasArtwork) {
    index.podcast.artworkUrl = `${c.env.R2_PUBLIC_URL}/assets/artwork.jpg`;
  }

  if (body.hasOgImage) {
    index.podcast.ogImageUrl = `${c.env.R2_PUBLIC_URL}/assets/og-image.jpg`;
  }

  await saveIndex(c.env, index);

  // フィードを再生成
  await regenerateFeed(c.env);

  return c.json({ success: true });
});

export { backup };
