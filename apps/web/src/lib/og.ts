/**
 * OGP 画像の URL と、そこに載せる中身
 *
 * 画像そのものは `pages/og.jpg.ts` と `pages/og/[id].jpg.ts` がビルド時に描く
 * （描き方は `og-image.ts`）。ここは sharp などを読み込まないので、ページから使える。
 */
import { stripHtml } from "./api";
import type { Episode, PodcastInfo } from "./types";
import { OG_DESIGN_VERSION, type OgCard } from "./og-card";
import { episodeMeta, splitEpisodeTitle, splitPodcastTitle } from "./titles";

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
  const meta = episodeMeta(episode);

  return {
    eyebrow: number ? `#${number}` : undefined,
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
