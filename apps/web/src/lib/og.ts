/**
 * OGP画像パスを解決するユーティリティ
 * Astroで生成される /og/*.jpg を使用
 */

/**
 * Podcast全体のOGP画像URLを取得
 * @param siteUrl - サイトのベースURL
 */
export function getPodcastOgImageUrl(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}/og/podcast.jpg`;
}

/**
 * エピソードのOGP画像URLを取得
 * @param episodeId - エピソードID
 * @param siteUrl - サイトのベースURL
 */
export function getEpisodeOgImageUrl(episodeId: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}/og/episodes/${episodeId}.jpg`;
}
