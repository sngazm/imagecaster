/**
 * iTunes Search API クライアント（フロントエンド用）
 *
 * Cloudflare Workers/Pages からは Apple の API がブロックされるため、
 * 本番ドメインのフロントエンドから直接 API を呼び出す
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

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    // CORS エラーや ネットワークエラーの場合
    throw new Error("Apple APIに接続できません（CORS/ネットワークエラー）");
  }

  if (!response.ok) {
    throw new Error(`iTunes API error: ${response.status}`);
  }

  let data: iTunesLookupResponse;
  try {
    data = (await response.json()) as iTunesLookupResponse;
  } catch {
    throw new Error("APIレスポンスの解析に失敗しました");
  }

  // GUID → trackViewUrl のマップを作成
  const episodeMap = new Map<string, string>();

  for (const result of data.results) {
    // podcast-episode のみを処理（最初の結果は podcast 情報）
    if (result.wrapperType === "podcastEpisode" && result.episodeGuid) {
      // trackViewUrl から不要なパラメータを除去
      const cleanUrl = result.trackViewUrl.replace(/&uo=\d+$/, "");
      episodeMap.set(result.episodeGuid, cleanUrl);
    }
  }

  return episodeMap;
}
