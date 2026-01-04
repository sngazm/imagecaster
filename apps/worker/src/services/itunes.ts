/**
 * iTunes Search API クライアント
 *
 * Apple Podcasts のエピソード情報を取得し、
 * GUID でマッチングしてエピソード個別の URL を取得する
 */

/**
 * iTunes API のエピソード情報
 */
interface iTunesEpisode {
  trackId: number;
  trackName: string;
  trackViewUrl: string;
  episodeGuid: string;
  releaseDate: string;
  collectionId: number;
  wrapperType: string;
  kind?: string;
}

/**
 * iTunes API のレスポンス
 */
interface iTunesLookupResponse {
  resultCount: number;
  results: iTunesEpisode[];
}

/**
 * Apple Podcasts のエピソード情報を取得
 *
 * @param podcastId - Apple Podcasts の collectionId
 * @param limit - 取得するエピソード数（最大300）
 * @returns エピソード情報のマップ（GUID → trackViewUrl）
 */
export async function fetchApplePodcastsEpisodes(
  podcastId: string,
  limit: number = 300
): Promise<Map<string, string>> {
  const url = `https://itunes.apple.com/lookup?id=${podcastId}&media=podcast&entity=podcastEpisode&limit=${limit}`;
  const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  console.log(`[iTunes API] Requesting: ${url}`);
  console.log(`[iTunes API] User-Agent: ${userAgent}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "application/json",
    },
  });

  console.log(`[iTunes API] Response status: ${response.status}`);

  if (!response.ok) {
    const errorBody = await response.text();
    console.log(`[iTunes API] Error body: ${errorBody.substring(0, 500)}`);
    throw new Error(`iTunes API error: ${response.status}`);
  }

  const data = (await response.json()) as iTunesLookupResponse;
  console.log(`[iTunes API] resultCount: ${data.resultCount}`);

  // GUID → trackViewUrl のマップを作成
  const episodeMap = new Map<string, string>();

  for (const result of data.results) {
    // podcast-episode のみを処理（最初の結果は podcast 情報）
    if (result.wrapperType === "podcastEpisode" && result.episodeGuid) {
      // trackViewUrl から不要なパラメータを除去してクリーンな URL を作成
      // 例: https://podcasts.apple.com/us/podcast/episode-title/id1234567890?i=1000123456789&uo=4
      // → https://podcasts.apple.com/us/podcast/episode-title/id1234567890?i=1000123456789
      const cleanUrl = result.trackViewUrl.replace(/&uo=\d+$/, "");
      episodeMap.set(result.episodeGuid, cleanUrl);
      console.log(`[iTunes API] Episode: guid="${result.episodeGuid}" -> ${cleanUrl.substring(0, 80)}...`);
    }
  }

  console.log(`[iTunes API] Total episodes mapped: ${episodeMap.size}`);
  return episodeMap;
}

/**
 * GUID から Apple Podcasts の URL を取得
 *
 * @param podcastId - Apple Podcasts の collectionId
 * @param guid - エピソードの GUID
 * @returns Apple Podcasts の URL、見つからない場合は null
 */
export async function getApplePodcastsUrl(
  podcastId: string,
  guid: string
): Promise<string | null> {
  const episodeMap = await fetchApplePodcastsEpisodes(podcastId);
  return episodeMap.get(guid) || null;
}
