/**
 * OGP画像URL解決ユーティリティ
 * アートワークURLを直接OGP画像として使用
 */

/**
 * Podcast全体のOGP画像URLを取得
 * @param podcastArtworkUrl - PodcastのアートワークURL
 */
export function getPodcastOgImageUrl(podcastArtworkUrl: string): string {
  return podcastArtworkUrl;
}

/**
 * エピソードのOGP画像URLを取得
 * @param episodeArtworkUrl - エピソード固有のアートワークURL（nullの場合はフォールバック使用）
 * @param fallbackArtworkUrl - フォールバック用のアートワークURL（PodcastのartworkUrl）
 */
export function getEpisodeOgImageUrl(
  episodeArtworkUrl: string | null,
  fallbackArtworkUrl: string
): string {
  return episodeArtworkUrl || fallbackArtworkUrl;
}
