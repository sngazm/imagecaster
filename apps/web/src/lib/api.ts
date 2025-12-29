import type { Episode, PodcastIndex } from "./types";

const R2_PUBLIC_URL = import.meta.env.R2_PUBLIC_URL || "";
const PODCAST_ID = import.meta.env.PODCAST_ID || "";

/**
 * R2 の Podcast ベース URL を取得
 * マルチポッドキャスト対応: /{podcastId}/ のプレフィックスが付く
 */
function getPodcastBaseUrl(): string {
  if (!PODCAST_ID) {
    throw new Error("PODCAST_ID environment variable is required");
  }
  return `${R2_PUBLIC_URL}/${PODCAST_ID}`;
}

/**
 * R2 から Podcast インデックスを取得
 */
export async function getPodcastIndex(): Promise<PodcastIndex> {
  const url = `${getPodcastBaseUrl()}/index.json`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch podcast index: ${res.status}`);
  }

  return res.json();
}

/**
 * R2 からエピソードメタデータを取得
 */
export async function getEpisode(id: string): Promise<Episode> {
  const url = `${getPodcastBaseUrl()}/episodes/${id}/meta.json`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch episode ${id}: ${res.status}`);
  }

  return res.json();
}

/**
 * 公開済みエピソードを全て取得（新しい順）
 */
export async function getPublishedEpisodes(): Promise<Episode[]> {
  const index = await getPodcastIndex();

  const episodes = await Promise.all(
    index.episodes.map(async (ep) => {
      try {
        return await getEpisode(ep.id);
      } catch {
        return null;
      }
    })
  );

  return episodes
    .filter((ep): ep is Episode => ep !== null && ep.status === "published")
    .sort((a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime());
}

/**
 * 秒数を "MM:SS" または "HH:MM:SS" 形式に変換
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 日付を "YYYY年MM月DD日" 形式に変換（JSTで表示）
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });
}

/**
 * ファイルサイズを人間が読みやすい形式に変換
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * HTMLタグを除去してプレーンテキストに変換
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * R2 から RSS フィードを取得
 */
export async function getFeed(): Promise<string> {
  const url = `${getPodcastBaseUrl()}/feed.xml`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch feed: ${res.status}`);
  }

  return res.text();
}

/**
 * HTMLエスケープ
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 参考リンクをHTMLに変換
 */
function formatReferenceLinks(links: Episode["referenceLinks"]): string {
  if (!links || links.length === 0) {
    return "";
  }
  return links
    .map(
      (link) =>
        `<p>${escapeHtml(link.title)}<br><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></p>`
    )
    .join("\n");
}

/**
 * 説明文のプレースホルダーを置換
 * {{TRANSCRIPT_URL}} - 文字起こしページへのリンク
 * {{EPISODE_URL}} - エピソードページへのリンク
 * {{AUDIO_URL}} - 音声ファイルへのリンク
 * {{REFERENCE_LINKS}} - 参考リンク一覧
 */
export function processDescription(
  description: string,
  episode: Episode,
  websiteUrl: string
): string {
  const episodePageUrl = `${websiteUrl}/episodes/${episode.slug || episode.id}`;
  const transcriptPageUrl = episode.transcriptUrl
    ? `${episodePageUrl}/transcript`
    : "";

  let result = description
    .replace(/\{\{TRANSCRIPT_URL\}\}/g, transcriptPageUrl)
    .replace(/\{\{EPISODE_URL\}\}/g, episodePageUrl)
    .replace(/\{\{AUDIO_URL\}\}/g, episode.audioUrl || "");

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
