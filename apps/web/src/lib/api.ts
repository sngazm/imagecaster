import type { Episode, PodcastIndex, TranscriptSegment, TranscriptJson } from "./types";

/**
 * 秒数を "HH:MM:SS" 形式に変換
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * JSONの文字起こしデータをパースしてセグメント配列に変換
 */
export function parseTranscriptJson(data: TranscriptJson): TranscriptSegment[] {
  return data.segments.map((segment) => ({
    start: formatTime(segment.start),
    text: segment.text,
  }));
}

/**
 * セグメント配列からプレーンテキストを抽出（検索用）
 */
export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

/**
 * 文字起こしセグメントを取得
 */
export async function getTranscriptSegments(
  transcriptUrl: string
): Promise<TranscriptSegment[]> {
  try {
    const res = await fetch(transcriptUrl);
    if (!res.ok) return [];
    const json: TranscriptJson = await res.json();
    return parseTranscriptJson(json);
  } catch {
    return [];
  }
}

/**
 * JSONの文字起こしデータを取得（VTT変換用の生データ）
 */
export async function getTranscriptJson(
  transcriptUrl: string
): Promise<TranscriptJson | null> {
  try {
    const res = await fetch(transcriptUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * TranscriptJsonをVTT形式に変換（オーディオタグの字幕用）
 */
export function convertJsonToVtt(data: TranscriptJson): string {
  const lines: string[] = ["WEBVTT", ""];

  for (let i = 0; i < data.segments.length; i++) {
    const segment = data.segments[i];
    const startTime = formatVttTime(segment.start);
    const endTime = formatVttTime(segment.end);

    lines.push(`${i + 1}`);
    lines.push(`${startTime} --> ${endTime}`);

    if (segment.speaker) {
      lines.push(`<v ${segment.speaker}>${segment.text}</v>`);
    } else {
      lines.push(segment.text);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 秒数をVTT形式のタイムスタンプに変換
 * 例: 125.5 -> "00:02:05.500"
 */
function formatVttTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

// ビルド時キャッシュ（同じデータを何度も取得しないようにする）
let cachedPodcastIndex: PodcastIndex | null = null;
let cachedPublishedEpisodes: Episode[] | null = null;

/**
 * R2が空の場合のデフォルトインデックス
 */
function getDefaultPodcastIndex(): PodcastIndex {
  return {
    podcast: {
      title: "Podcast",
      description: "",
      author: "",
      email: "",
      language: "ja",
      category: "Technology",
      artworkUrl: "",
      websiteUrl: "",
      explicit: false,
    },
    episodes: [],
  };
}

/**
 * R2 から Podcast インデックスを取得
 * R2が空（404）の場合はデフォルト値を返す
 * ビルド時は結果をキャッシュして429エラーを防ぐ
 */
export async function getPodcastIndex(): Promise<PodcastIndex> {
  if (cachedPodcastIndex) {
    return cachedPodcastIndex;
  }

  const url = `${R2_PUBLIC_URL}/index.json`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      if (res.status === 404) {
        console.warn("[getPodcastIndex] Podcast index not found (404), using default empty index");
        cachedPodcastIndex = getDefaultPodcastIndex();
        return cachedPodcastIndex;
      }
      throw new Error(`Failed to fetch podcast index: ${res.status}`);
    }

    const data: PodcastIndex = await res.json();
    cachedPodcastIndex = data;
    return data;
  } catch (error) {
    console.error("[getPodcastIndex] Fetch error:", error);
    cachedPodcastIndex = getDefaultPodcastIndex();
    return cachedPodcastIndex;
  }
}

/**
 * R2 からエピソードメタデータを取得
 */
export async function getEpisode(id: string): Promise<Episode> {
  const url = `${R2_PUBLIC_URL}/episodes/${id}/meta.json`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch episode ${id}: ${res.status}`);
  }

  return res.json();
}

/**
 * 公開済みエピソードを全て取得（新しい順）
 * ビルド時は結果をキャッシュして429エラーを防ぐ
 */
export async function getPublishedEpisodes(): Promise<Episode[]> {
  if (cachedPublishedEpisodes) {
    return cachedPublishedEpisodes;
  }

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

  cachedPublishedEpisodes = episodes
    .filter((ep): ep is Episode => ep !== null && ep.publishStatus === "published")
    .sort((a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime());

  return cachedPublishedEpisodes;
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
 * R2が空の場合の最小限のRSSフィード
 */
function getDefaultFeed(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Podcast</title>
    <description></description>
    <language>ja</language>
  </channel>
</rss>`;
}

/**
 * R2 から RSS フィードを取得
 * R2が空（404）の場合はデフォルトの空フィードを返す
 */
export async function getFeed(): Promise<string> {
  const url = `${R2_PUBLIC_URL}/feed.xml`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) {
      console.warn("Feed not found, using default empty feed");
      return getDefaultFeed();
    }
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
