/**
 * OGP 画像の URL と、そこに載せる中身
 *
 * 画像そのものは `pages/og.jpg.ts` と `pages/og/[id].jpg.ts` がビルド時に描く
 * （描き方は `og-image.ts`）。ここは sharp などを読み込まないので、ページから使える。
 */
import { stripHtml } from "./api";
import type { Episode, PodcastInfo } from "./types";
import { OG_DESIGN_VERSION, type OgCard } from "./og-card";

/**
 * 中身が変わったら URL も変わるようにする
 *
 * SNS は OGP 画像を URL ごとに覚えているので、タイトルを直しても同じ URL だと
 * 古い画像が出つづける。
 */
function versionOf(card: OgCard): string {
  const text = JSON.stringify([OG_DESIGN_VERSION, card]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** 「番組名 - ひとこと」の形なら、番組名とひとことに分ける */
function splitPodcastTitle(title: string): { name: string; tagline: string | null } {
  const match = title.match(/^(.+?)\s+[-–—|｜]\s+(.+)$/);
  return match ? { name: match[1], tagline: match[2] } : { name: title, tagline: null };
}

/** 「#12 タイトル」の形なら、番号とタイトルに分ける */
function splitEpisodeTitle(title: string): { number: string | null; rest: string } {
  const match = title.match(/^[#＃]\s?(\d[\d\-.]*)\s+(.+)$/);
  return match ? { number: `#${match[1]}`, rest: match[2] } : { number: null, rest: title };
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });
}

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function podcastOgCard(podcast: PodcastInfo): OgCard {
  const { name, tagline } = splitPodcastTitle(podcast.title);
  return {
    title: name,
    subtitle: tagline ?? (stripHtml(podcast.description) || undefined),
    meta: [podcast.author, hostOf(podcast.websiteUrl)].filter(Boolean).join("・") || undefined,
    artworkUrls: [podcast.artworkUrl],
  };
}

export function episodeOgCard(episode: Episode, podcast: PodcastInfo): OgCard {
  const { number, rest } = splitEpisodeTitle(episode.title);
  const date = episode.publishedAt || episode.publishAt;
  const meta = [date ? formatDate(date) : "", episode.duration > 0 ? formatMinutes(episode.duration) : ""]
    .filter(Boolean)
    .join("・");

  return {
    eyebrow: number ?? undefined,
    title: rest,
    label: splitPodcastTitle(podcast.title).name,
    meta: meta || undefined,
    // その回のアートワークが取れなければ番組のものを使う
    artworkUrls: [episode.artworkUrl, podcast.artworkUrl],
  };
}

/** 番組全体の OGP 画像の URL */
export function getPodcastOgImageUrl(podcast: PodcastInfo): string {
  return `/og.jpg?v=${versionOf(podcastOgCard(podcast))}`;
}

/** エピソードの OGP 画像の URL */
export function getEpisodeOgImageUrl(episode: Episode, podcast: PodcastInfo): string {
  return `/og/${encodeURIComponent(episode.id)}.jpg?v=${versionOf(episodeOgCard(episode, podcast))}`;
}
