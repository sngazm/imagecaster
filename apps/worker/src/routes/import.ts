import { Hono } from "hono";
import type { Env, ImportRssRequest, ImportRssResponse, EpisodeMeta } from "../types";
import { getIndex, saveIndex, saveEpisodeMeta } from "../services/r2";

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
  guid: string;
}> {
  const episodes: Array<{
    title: string;
    description: string;
    pubDate: string;
    duration: number;
    audioUrl: string;
    guid: string;
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

    if (title && audioUrl) {
      episodes.push({
        title,
        description,
        pubDate,
        duration,
        audioUrl,
        guid,
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

  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    description: descMatch ? descMatch[1].trim() : "",
    author: authorMatch ? authorMatch[1].trim() : "",
    artworkUrl: imageMatch ? imageMatch[1].trim() : "",
    language: langMatch ? langMatch[1].trim() : "ja",
    category: categoryMatch ? categoryMatch[1].trim() : "Technology",
  };
}

/**
 * タイトルからslugを生成
 */
function generateSlug(title: string): string {
  // 簡易的なslug生成（英数字とハイフンのみ）
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  // 空の場合はタイムスタンプでフォールバック
  if (!slug) {
    slug = `episode-${Date.now().toString(36)}`;
  }

  return slug;
}

/**
 * RSSフィードをインポート
 */
importRoutes.post("/rss", async (c) => {
  const body = await c.req.json<ImportRssRequest>();

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
  const rssEpisodes = parseRssXml(rssXml);

  const index = await getIndex(c.env);
  const results: ImportRssResponse["episodes"] = [];
  let imported = 0;
  let skipped = 0;

  // 既存のslug一覧を作成（高速チェック用）
  const existingSlugs = new Set(index.episodes.map((ep) => ep.id));

  // エピソードを古い順に処理（pubDateでソート）
  const sortedEpisodes = [...rssEpisodes].sort((a, b) =>
    new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime()
  );

  // バッチ処理用の配列
  const episodesToSave: EpisodeMeta[] = [];

  for (const rssEp of sortedEpisodes) {
    // slugを生成
    let slug = generateSlug(rssEp.title);

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
      fileSize: 0,
      audioUrl: "",
      sourceAudioUrl: rssEp.audioUrl,
      transcriptUrl: null,
      ogImageUrl: null,
      skipTranscription: true,
      status: "published",
      createdAt: now,
      publishAt: pubDate,
      publishedAt: pubDate,
      blueskyPostText: null,
      blueskyPostEnabled: false,
      blueskyPostedAt: null,
      referenceLinks: [],
    };

    episodesToSave.push(meta);
    existingSlugs.add(slug);

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
    await Promise.all(batch.map((meta) => saveEpisodeMeta(c.env, meta)));
  }

  // インデックスを保存
  await saveIndex(c.env, index);

  const response: ImportRssResponse = {
    imported,
    skipped,
    episodes: results,
  };

  return c.json(response);
});

/**
 * RSSフィードをプレビュー（インポートせずに内容を確認）
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

  return c.json({
    podcast: podcastMeta,
    episodeCount: episodes.length,
    episodes: episodes.map((ep) => ({
      title: ep.title,
      pubDate: ep.pubDate,
      duration: ep.duration,
      hasAudio: !!ep.audioUrl,
    })),
  });
});
