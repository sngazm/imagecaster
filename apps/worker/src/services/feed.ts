import type { Env, EpisodeMeta, PodcastIndex } from "../types";
import { getIndex, getPublishedEpisodes } from "./r2";
import { formatReferenceLinks } from "./description";

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
 * プレースホルダータグを置換
 * {{TRANSCRIPT_URL}} - 文字起こしページへのリンク
 * {{EPISODE_URL}} - エピソードページへのリンク
 * {{AUDIO_URL}} - 音声ファイルへのリンク
 * {{REFERENCE_LINKS}} - 参考リンク一覧
 */
function replacePlaceholders(
  text: string,
  episode: EpisodeMeta,
  websiteUrl: string
): string {
  const transcriptPageUrl = episode.transcriptUrl
    ? `${websiteUrl}/episodes/${episode.slug || episode.id}/transcript`
    : "";
  const episodePageUrl = `${websiteUrl}/episodes/${episode.slug || episode.id}`;
  const audioUrl = episode.audioUrl || episode.sourceAudioUrl || "";

  let result = text
    .replace(/\{\{TRANSCRIPT_URL\}\}/g, transcriptPageUrl)
    .replace(/\{\{EPISODE_URL\}\}/g, episodePageUrl)
    .replace(/\{\{AUDIO_URL\}\}/g, audioUrl);

  // {{REFERENCE_LINKS}} を変換
  if (episode.referenceLinks && episode.referenceLinks.length > 0) {
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, formatReferenceLinks(episode.referenceLinks));
  } else {
    // リンクがない場合は、タグごと削除（<p>{{REFERENCE_LINKS}}</p> など）
    result = result.replace(/<p>\s*\{\{REFERENCE_LINKS\}\}\s*<\/p>\s*/gi, "");
    result = result.replace(/<div>\s*\{\{REFERENCE_LINKS\}\}\s*<\/div>\s*/gi, "");
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, "");
  }

  return result;
}

/**
 * エピソードの RSS item を生成
 */
function generateEpisodeItem(episode: EpisodeMeta, websiteUrl: string): string {
  const transcriptTag = episode.transcriptUrl
    ? `\n      <podcast:transcript url="${escapeXml(episode.transcriptUrl)}" type="text/vtt" language="ja"/>`
    : "";

  // エピソード固有のアートワークがある場合
  const imageTag = episode.artworkUrl
    ? `\n      <itunes:image href="${escapeXml(episode.artworkUrl)}"/>`
    : "";

  // 音声URLはaudioUrlがあればそれを使い、なければsourceAudioUrl（外部参照）を使用
  const audioUrl = episode.audioUrl || episode.sourceAudioUrl || "";

  // プレースホルダーを置換した説明文
  const processedDescription = replacePlaceholders(
    episode.description,
    episode,
    websiteUrl
  );

  return `
    <item>
      <title>${escapeXml(episode.title)}</title>
      <description><![CDATA[${processedDescription}]]></description>
      <enclosure
        url="${escapeXml(audioUrl)}"
        length="${episode.fileSize}"
        type="audio/mpeg"/>
      <guid isPermaLink="false">${episode.sourceGuid || episode.slug || episode.id}</guid>
      <pubDate>${toRFC2822(episode.publishedAt!)}</pubDate>
      <itunes:duration>${formatDuration(episode.duration)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>${imageTag}${transcriptTag}
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

  const items = episodes
    .map((ep) => generateEpisodeItem(ep, podcast.websiteUrl))
    .join("\n");

  const lastBuildDate = toRFC2822(new Date().toISOString());

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
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
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
