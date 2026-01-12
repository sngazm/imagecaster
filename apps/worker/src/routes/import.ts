import { Hono } from "hono";
import type { Env, ImportRssRequest, ImportRssResponse, EpisodeMeta } from "../types";
import { getIndex, saveIndex, saveEpisodeMeta, saveAudioFile, getEpisodeMeta } from "../services/r2";
import { regenerateFeed } from "../services/feed";
import { triggerWebRebuild } from "../services/deploy";

export const importRoutes = new Hono<{ Bindings: Env }>();

/**
 * RSS XMLをパースしてエピソード情報を抽出
 */
function parseRssXml(xml: string): Array<{
  title: string;
  description: string;
  pubDate: string;
  duration: number;
  audioUrl: string;
  fileSize: number;
  guid: string;
  artworkUrl: string;
}> {
  const episodes: Array<{
    title: string;
    description: string;
    pubDate: string;
    duration: number;
    audioUrl: string;
    fileSize: number;
    guid: string;
    artworkUrl: string;
  }> = [];

  // <item>タグを抽出
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];

    // タイトル
    const titleMatch = itemContent.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // 説明
    const descMatch = itemContent.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const description = descMatch ? descMatch[1].trim() : "";

    // 公開日
    const pubDateMatch = itemContent.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : "";

    // 音声URL (enclosure)
    const enclosureMatch = itemContent.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
    const audioUrl = enclosureMatch ? enclosureMatch[1] : "";

    // ファイルサイズ (enclosure length)
    const lengthMatch = itemContent.match(/<enclosure[^>]*length=["'](\d+)["'][^>]*>/i);
    const fileSize = lengthMatch ? parseInt(lengthMatch[1], 10) : 0;

    // duration (itunes:duration)
    const durationMatch = itemContent.match(/<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/i);
    let duration = 0;
    if (durationMatch) {
      const durationStr = durationMatch[1].trim();
      // HH:MM:SS or MM:SS or seconds
      if (durationStr.includes(":")) {
        const parts = durationStr.split(":").map(Number);
        if (parts.length === 3) {
          duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          duration = parts[0] * 60 + parts[1];
        }
      } else {
        duration = parseInt(durationStr, 10) || 0;
      }
    }

    // GUID
    const guidMatch = itemContent.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const guid = guidMatch ? guidMatch[1].trim() : "";

    // アートワークURL (itunes:image href属性)
    const artworkMatch = itemContent.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
    const artworkUrl = artworkMatch ? artworkMatch[1].trim() : "";

    if (title && audioUrl) {
      episodes.push({
        title,
        description,
        pubDate,
        duration,
        audioUrl,
        fileSize,
        guid,
        artworkUrl,
      });
    }
  }

  return episodes;
}

/**
 * Podcast メタデータをRSSから抽出
 */
function parsePodcastMeta(xml: string): {
  title: string;
  description: string;
  author: string;
  artworkUrl: string;
  language: string;
  category: string;
} {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channelContent = channelMatch ? channelMatch[1] : "";

  const titleMatch = channelContent.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  const descMatch = channelContent.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
  const authorMatch = channelContent.match(/<itunes:author[^>]*>([\s\S]*?)<\/itunes:author>/i);
  const imageMatch = channelContent.match(/<itunes:image[^>]*href=["']([^"']+)["']/i) ||
                     channelContent.match(/<image[^>]*>[\s\S]*?<url[^>]*>([\s\S]*?)<\/url>/i);
  const langMatch = channelContent.match(/<language[^>]*>([\s\S]*?)<\/language>/i);
  const categoryMatch = channelContent.match(/<itunes:category[^>]*text=["']([^"']+)["']/i);

  // CDATAタグを除去するヘルパー関数
  const stripCdata = (str: string) => str.replace(/<!\[CDATA\[|\]\]>/g, "").trim();

  return {
    title: titleMatch ? stripCdata(titleMatch[1]) : "",
    description: descMatch ? stripCdata(descMatch[1]) : "",
    author: authorMatch ? stripCdata(authorMatch[1]) : "",
    artworkUrl: imageMatch ? stripCdata(imageMatch[1]) : "",
    language: langMatch ? stripCdata(langMatch[1]) : "ja",
    category: categoryMatch ? stripCdata(categoryMatch[1]) : "Technology",
  };
}

/**
 * タイトルからslugを生成
 * 新規作成時と同様に、最初のスペースまでの文字列を使用
 * 「#123」パターンがあればエピソード番号を使用
 */
function generateSlug(title: string): string {
  // 「#123」パターンがあればエピソード番号を使用
  const numberMatch = title.match(/^#(\d+)/);
  if (numberMatch) {
    return numberMatch[1];
  }

  // 最初のスペースまでの文字列を取得（日本語タイトルを考慮）
  const firstPart = title.split(/\s+/)[0];

  // 英数字とハイフンのみに変換
  let slug = firstPart
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);

  // 空の場合はタイムスタンプでフォールバック
  if (!slug) {
    slug = `episode-${Date.now().toString(36)}`;
  }

  return slug;
}

/**
 * 外部URLからオーディオをダウンロードしてR2に保存
 */
async function downloadAndSaveAudio(
  env: Env,
  episodeId: string,
  audioUrl: string
): Promise<{ size: number; audioUrl: string } | null> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return null;
    }

    const audioData = await response.arrayBuffer();
    const { size } = await saveAudioFile(env, episodeId, audioData);

    // 公開URLを生成
    const publicAudioUrl = `${env.R2_PUBLIC_URL}/episodes/${episodeId}/audio.mp3`;

    return { size, audioUrl: publicAudioUrl };
  } catch {
    return null;
  }
}

/**
 * 外部URLからアートワークをダウンロードしてR2に保存
 */
async function downloadAndSaveArtwork(
  env: Env,
  episodeId: string,
  artworkUrl: string
): Promise<string | null> {
  try {
    const response = await fetch(artworkUrl);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const extension = contentType.includes("png") ? "png" : "jpg";
    const artworkData = await response.arrayBuffer();

    const key = `episodes/${episodeId}/artwork.${extension}`;
    await env.R2_BUCKET.put(key, artworkData, {
      httpMetadata: {
        contentType: contentType.includes("png") ? "image/png" : "image/jpeg",
      },
    });

    // 公開URLを返す
    return `${env.R2_PUBLIC_URL}/${key}`;
  } catch {
    return null;
  }
}

/**
 * 既存エピソードのGUIDとAudioURLを取得（差分インポート用）
 */
async function getExistingIdentifiers(
  env: Env,
  episodeIds: string[]
): Promise<{ guids: Set<string>; audioUrls: Set<string> }> {
  const guids = new Set<string>();
  const audioUrls = new Set<string>();

  // バッチで取得
  const BATCH_SIZE = 10;
  for (let i = 0; i < episodeIds.length; i += BATCH_SIZE) {
    const batch = episodeIds.slice(i, i + BATCH_SIZE);
    const metas = await Promise.all(
      batch.map(async (id) => {
        try {
          return await getEpisodeMeta(env, id);
        } catch {
          return null;
        }
      })
    );

    for (const meta of metas) {
      if (!meta) continue;
      if (meta.sourceGuid) guids.add(meta.sourceGuid);
      if (meta.sourceAudioUrl) audioUrls.add(meta.sourceAudioUrl);
    }
  }

  return { guids, audioUrls };
}

/**
 * RSSエピソードが既にインポート済みかチェック
 */
function isAlreadyImported(
  rssEp: { guid: string; audioUrl: string },
  existingGuids: Set<string>,
  existingAudioUrls: Set<string>
): boolean {
  // GUIDで照合（優先）
  if (rssEp.guid && existingGuids.has(rssEp.guid)) {
    return true;
  }
  // AudioURLでフォールバック照合
  if (rssEp.audioUrl && existingAudioUrls.has(rssEp.audioUrl)) {
    return true;
  }
  return false;
}

/**
 * RSSフィードをインポート
 */
importRoutes.post("/rss", async (c) => {
  const body = await c.req.json<ImportRssRequest>();

  if (!body.rssUrl) {
    return c.json({ error: "rssUrl is required" }, 400);
  }

  const importAudio = body.importAudio ?? false;
  const importArtwork = body.importArtwork ?? false;
  const importPodcastSettings = body.importPodcastSettings ?? false;
  const customSlugs = body.customSlugs ?? {};

  // RSSフィードを取得
  let rssXml: string;
  try {
    const response = await fetch(body.rssUrl);
    if (!response.ok) {
      return c.json({ error: `Failed to fetch RSS: ${response.status}` }, 400);
    }
    rssXml = await response.text();
  } catch (err) {
    return c.json({ error: `Failed to fetch RSS: ${err}` }, 400);
  }

  // RSSをパース
  const rssEpisodes = parseRssXml(rssXml);
  const podcastMeta = parsePodcastMeta(rssXml);

  const index = await getIndex(c.env);
  const results: ImportRssResponse["episodes"] = [];
  let imported = 0;
  let skipped = 0;

  // 既存のslug一覧を作成（高速チェック用）
  const existingSlugs = new Set(index.episodes.map((ep) => ep.id));

  // 既存エピソードのGUIDとAudioURLを取得（差分インポート用）
  const { guids: existingGuids, audioUrls: existingAudioUrls } =
    await getExistingIdentifiers(c.env, index.episodes.map((ep) => ep.id));

  // エピソードを古い順に処理（pubDateでソート）
  const sortedEpisodes = [...rssEpisodes].sort((a, b) =>
    new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime()
  );

  // バッチ処理用の配列
  const episodesToSave: Array<{
    meta: EpisodeMeta;
    audioUrl: string;
    artworkUrl: string;
  }> = [];

  for (let idx = 0; idx < sortedEpisodes.length; idx++) {
    const rssEp = sortedEpisodes[idx];
    // 既にインポート済みの場合はスキップ
    if (isAlreadyImported(rssEp, existingGuids, existingAudioUrls)) {
      results.push({
        title: rssEp.title,
        slug: "",
        status: "skipped",
        reason: "Already imported",
      });
      skipped++;
      continue;
    }

    // カスタムslugが指定されている場合はそれを使用、なければ自動生成
    let slug = customSlugs[String(idx)] ?? generateSlug(rssEp.title);

    // 重複を避けるためにサフィックスを追加
    const originalSlug = slug;
    let suffix = 1;
    while (existingSlugs.has(slug)) {
      slug = `${originalSlug}-${suffix}`;
      suffix++;
      if (suffix > 100) {
        // 無限ループ防止
        results.push({
          title: rssEp.title,
          slug: originalSlug,
          status: "skipped",
          reason: "Could not generate unique slug",
        });
        skipped++;
        continue;
      }
    }

    // 新規エピソードを作成
    const now = new Date().toISOString();
    const pubDate = rssEp.pubDate ? new Date(rssEp.pubDate).toISOString() : now;

    const meta: EpisodeMeta = {
      id: slug,
      slug,
      title: rssEp.title,
      description: rssEp.description,
      duration: rssEp.duration,
      fileSize: rssEp.fileSize,
      audioUrl: "",
      sourceAudioUrl: importAudio ? null : rssEp.audioUrl,
      sourceGuid: rssEp.guid || null, // GUIDを保存（差分インポート用）
      transcriptUrl: null,
      artworkUrl: importArtwork ? null : (rssEp.artworkUrl || null), // ダウンロードする場合は後で設定
      skipTranscription: true,
      status: "published",
      createdAt: now,
      publishAt: pubDate,
      publishedAt: pubDate,
      blueskyPostText: null,
      blueskyPostEnabled: false,
      blueskyPostedAt: null,
      referenceLinks: [],
      applePodcastsUrl: null,
    };

    episodesToSave.push({ meta, audioUrl: rssEp.audioUrl, artworkUrl: rssEp.artworkUrl });
    existingSlugs.add(slug);

    // 新しいGUID/AudioURLをセットに追加（同一RSS内の重複防止）
    if (rssEp.guid) existingGuids.add(rssEp.guid);
    if (rssEp.audioUrl) existingAudioUrls.add(rssEp.audioUrl);

    // インデックスに追加
    index.episodes.push({ id: slug });

    results.push({
      title: rssEp.title,
      slug,
      status: "imported",
    });

    imported++;
  }

  // バッチでR2に保存（並列実行）
  const BATCH_SIZE = 10;
  for (let i = 0; i < episodesToSave.length; i += BATCH_SIZE) {
    const batch = episodesToSave.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ meta, audioUrl, artworkUrl }) => {
        // オーディオをコピーする場合
        if (importAudio) {
          const result = await downloadAndSaveAudio(c.env, meta.id, audioUrl);
          if (result) {
            meta.audioUrl = result.audioUrl;
            meta.fileSize = result.size;
          }
        }
        // アートワークをコピーする場合
        if (importArtwork && artworkUrl) {
          const savedArtworkUrl = await downloadAndSaveArtwork(c.env, meta.id, artworkUrl);
          if (savedArtworkUrl) {
            meta.artworkUrl = savedArtworkUrl;
          }
        }
        await saveEpisodeMeta(c.env, meta);
      })
    );
  }

  // Podcast設定を上書き
  if (importPodcastSettings) {
    index.podcast.title = podcastMeta.title || index.podcast.title;
    index.podcast.description = podcastMeta.description || index.podcast.description;
    index.podcast.author = podcastMeta.author || index.podcast.author;
    index.podcast.language = podcastMeta.language || index.podcast.language;
    index.podcast.category = podcastMeta.category || index.podcast.category;
    // アートワークURLは外部URLなのでそのまま設定（後でダウンロードが必要な場合は別途対応）
    if (podcastMeta.artworkUrl) {
      index.podcast.artworkUrl = podcastMeta.artworkUrl;
    }
  }

  // インデックスを保存
  await saveIndex(c.env, index);

  // エピソードがインポートされた場合はフィードを再生成してWebをリビルド
  if (imported > 0) {
    await regenerateFeed(c.env);
    await triggerWebRebuild(c.env);
  }

  const response: ImportRssResponse = {
    imported,
    skipped,
    episodes: results,
  };

  return c.json(response);
});

/**
 * RSSフィードをプレビュー（インポートせずに内容を確認）
 * ドライラン機能: slug生成、ファイルサイズ、既存重複チェック、差分インポート検出を含む
 */
importRoutes.post("/rss/preview", async (c) => {
  const body = await c.req.json<{ rssUrl: string }>();

  if (!body.rssUrl) {
    return c.json({ error: "rssUrl is required" }, 400);
  }

  // RSSフィードを取得
  let rssXml: string;
  try {
    const response = await fetch(body.rssUrl);
    if (!response.ok) {
      return c.json({ error: `Failed to fetch RSS: ${response.status}` }, 400);
    }
    rssXml = await response.text();
  } catch (err) {
    return c.json({ error: `Failed to fetch RSS: ${err}` }, 400);
  }

  // RSSをパース
  const episodes = parseRssXml(rssXml);
  const podcastMeta = parsePodcastMeta(rssXml);

  // 既存のエピソード一覧を取得
  const index = await getIndex(c.env);
  const existingSlugs = new Set(index.episodes.map((ep) => ep.id));

  // 既存エピソードのGUIDとAudioURLを取得（差分インポート用）
  const { guids: existingGuids, audioUrls: existingAudioUrls } =
    await getExistingIdentifiers(c.env, index.episodes.map((ep) => ep.id));

  // 合計ファイルサイズを計算（インポート済みを除く）
  let totalFileSize = 0;
  let newEpisodeCount = 0;

  // 各エピソードのslugを生成し、重複・インポート済みをチェック
  const slugSet = new Set<string>();
  const episodesWithSlug = episodes.map((ep, index) => {
    // インポート済みかチェック
    const alreadyImported = isAlreadyImported(ep, existingGuids, existingAudioUrls);

    let slug = "";
    let originalSlug = "";
    let hasConflict = false;

    if (!alreadyImported) {
      slug = generateSlug(ep.title);
      originalSlug = slug;

      // 重複を避けるためにサフィックスを追加
      let suffix = 1;
      while (existingSlugs.has(slug) || slugSet.has(slug)) {
        slug = `${originalSlug}-${suffix}`;
        suffix++;
        if (suffix > 100) break;
      }

      // 既存のslugと衝突しているかどうか
      hasConflict = existingSlugs.has(originalSlug);

      slugSet.add(slug);
      totalFileSize += ep.fileSize;
      newEpisodeCount++;
    }

    return {
      index,
      title: ep.title,
      pubDate: ep.pubDate,
      duration: ep.duration,
      fileSize: ep.fileSize,
      hasAudio: !!ep.audioUrl,
      hasArtwork: !!ep.artworkUrl,
      artworkUrl: ep.artworkUrl || null,
      slug,
      originalSlug,
      hasConflict,
      alreadyImported,
    };
  });

  // 既存のPodcast設定を取得
  const existingPodcast = {
    title: index.podcast.title,
    description: index.podcast.description,
    author: index.podcast.author,
    artworkUrl: index.podcast.artworkUrl,
    language: index.podcast.language,
    category: index.podcast.category,
  };

  return c.json({
    podcast: podcastMeta,
    existingPodcast,
    episodeCount: episodes.length,
    newEpisodeCount,
    totalFileSize,
    episodes: episodesWithSlug,
  });
});
