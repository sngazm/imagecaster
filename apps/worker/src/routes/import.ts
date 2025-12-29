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

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];

    const titleMatch = itemContent.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const descMatch = itemContent.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const description = descMatch ? descMatch[1].trim() : "";

    const pubDateMatch = itemContent.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : "";

    const enclosureMatch = itemContent.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
    const audioUrl = enclosureMatch ? enclosureMatch[1] : "";

    const durationMatch = itemContent.match(/<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/i);
    let duration = 0;
    if (durationMatch) {
      const durationStr = durationMatch[1].trim();
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
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  if (!slug) {
    slug = `episode-${Date.now().toString(36)}`;
  }

  return slug;
}

/**
 * POST /api/podcasts/:podcastId/import/rss - RSSフィードをインポート
 */
importRoutes.post("/rss", async (c) => {
  const podcastId = c.req.param("podcastId");
  const body = await c.req.json<ImportRssRequest>();

  if (!body.rssUrl) {
    return c.json({ error: "rssUrl is required" }, 400);
  }

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

  const rssEpisodes = parseRssXml(rssXml);

  const index = await getIndex(c.env, podcastId);
  const results: ImportRssResponse["episodes"] = [];
  let imported = 0;
  let skipped = 0;

  const existingSlugs = new Set(index.episodes.map((ep) => ep.id));

  const sortedEpisodes = [...rssEpisodes].sort((a, b) =>
    new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime()
  );

  const episodesToSave: EpisodeMeta[] = [];

  for (const rssEp of sortedEpisodes) {
    let slug = generateSlug(rssEp.title);

    const originalSlug = slug;
    let suffix = 1;
    while (existingSlugs.has(slug)) {
      slug = `${originalSlug}-${suffix}`;
      suffix++;
      if (suffix > 100) {
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

    index.episodes.push({ id: slug });

    results.push({
      title: rssEp.title,
      slug,
      status: "imported",
    });

    imported++;
  }

  const BATCH_SIZE = 10;
  for (let i = 0; i < episodesToSave.length; i += BATCH_SIZE) {
    const batch = episodesToSave.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((meta) => saveEpisodeMeta(c.env, podcastId, meta)));
  }

  await saveIndex(c.env, podcastId, index);

  const response: ImportRssResponse = {
    imported,
    skipped,
    episodes: results,
  };

  return c.json(response);
});

/**
 * POST /api/podcasts/:podcastId/import/rss/preview - RSSフィードをプレビュー
 */
importRoutes.post("/rss/preview", async (c) => {
  const body = await c.req.json<{ rssUrl: string }>();

  if (!body.rssUrl) {
    return c.json({ error: "rssUrl is required" }, 400);
  }

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
