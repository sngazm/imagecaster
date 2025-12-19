import type { Env, EpisodeMeta, PodcastIndex } from "../types";
import { getIndex, getPublishedEpisodes } from "./r2";

/**
 * ISO 8601 日付を RFC 2822 形式に変換
 */
function toRFC2822(isoDate: string): string {
  const date = new Date(isoDate);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const day = days[date.getUTCDay()];
  const dateNum = String(date.getUTCDate()).padStart(2, "0");
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${day}, ${dateNum} ${month} ${year} ${hours}:${minutes}:${seconds} +0000`;
}

/**
 * 秒を iTunes duration 形式に変換
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/**
 * XML 特殊文字をエスケープ
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * エピソードの RSS item を生成
 */
function generateEpisodeItem(episode: EpisodeMeta): string {
  const transcriptTag = episode.transcriptUrl
    ? `\n      <podcast:transcript url="${escapeXml(episode.transcriptUrl)}" type="text/vtt" language="ja"/>`
    : "";

  return `
    <item>
      <title>${escapeXml(episode.title)}</title>
      <description><![CDATA[${episode.description}]]></description>
      <enclosure
        url="${escapeXml(episode.audioUrl)}"
        length="${episode.fileSize}"
        type="audio/mpeg"/>
      <guid isPermaLink="false">${episode.id}</guid>
      <pubDate>${toRFC2822(episode.publishedAt!)}</pubDate>
      <itunes:duration>${formatDuration(episode.duration)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>${transcriptTag}
    </item>`;
}

/**
 * RSS フィードを生成
 */
export function generateFeed(
  podcastIndex: PodcastIndex,
  episodes: EpisodeMeta[]
): string {
  const { podcast } = podcastIndex;

  const items = episodes.map(generateEpisodeItem).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(podcast.title)}</title>
    <link>${escapeXml(podcast.websiteUrl)}</link>
    <description>${escapeXml(podcast.description)}</description>
    <language>${podcast.language}</language>
    <itunes:author>${escapeXml(podcast.author)}</itunes:author>
    <itunes:image href="${escapeXml(podcast.artworkUrl)}"/>
    <itunes:category text="${escapeXml(podcast.category)}"/>
    <itunes:explicit>${podcast.explicit ? "true" : "false"}</itunes:explicit>
    <itunes:owner>
      <itunes:name>${escapeXml(podcast.author)}</itunes:name>
      <itunes:email>${escapeXml(podcast.email)}</itunes:email>
    </itunes:owner>
${items}
  </channel>
</rss>`;
}

/**
 * RSS フィードを再生成して R2 に保存
 */
export async function regenerateFeed(env: Env): Promise<void> {
  const [index, episodes] = await Promise.all([
    getIndex(env),
    getPublishedEpisodes(env),
  ]);

  const feedXml = generateFeed(index, episodes);

  await env.R2_BUCKET.put("feed.xml", feedXml, {
    httpMetadata: {
      contentType: "application/xml; charset=utf-8",
    },
  });
}

/**
 * キャッシュされたフィードを取得（なければ再生成）
 */
export async function getFeed(env: Env): Promise<string> {
  const cached = await env.R2_BUCKET.get("feed.xml");

  if (cached) {
    return cached.text();
  }

  // キャッシュがなければ再生成
  await regenerateFeed(env);

  const newFeed = await env.R2_BUCKET.get("feed.xml");
  return newFeed!.text();
}
