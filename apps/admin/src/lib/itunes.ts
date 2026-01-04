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

interface iTunesSearchResponse {
  resultCount: number;
  results: iTunesEpisode[];
}

// 最後のリクエスト時刻（レート制限用）
let lastRequestTime = 0;
const REQUEST_INTERVAL_MS = 5000; // リクエスト間隔: 5秒

/**
 * レート制限付きfetch（5秒間隔 + 429エラー時は即終了）
 */
async function fetchWithRateLimit(url: string): Promise<Response> {
  // レート制限: 前回のリクエストから一定時間待機
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < REQUEST_INTERVAL_MS) {
    const waitTime = REQUEST_INTERVAL_MS - timeSinceLastRequest;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();

  const response = await fetch(url);

  if (response.status === 429) {
    throw new Error(
      "Apple APIのレート制限に達しました。\n" +
        "しばらく時間をおいてから再度お試しください。"
    );
  }

  return response;
}

/**
 * Apple Podcasts のエピソード情報を取得（Lookup API）
 *
 * @param podcastId - Apple Podcasts の collectionId
 * @param limit - 取得するエピソード数（最大200、それ以上は無視される）
 * @returns エピソード情報のマップ（GUID → trackViewUrl）
 */
export async function fetchApplePodcastsEpisodes(
  podcastId: string,
  limit: number = 200
): Promise<Map<string, string>> {
  const url = `https://itunes.apple.com/lookup?id=${podcastId}&media=podcast&entity=podcastEpisode&limit=${limit}`;

  let response: Response;
  try {
    response = await fetchWithRateLimit(url);
  } catch (err) {
    // 429エラーの場合はそのまま投げる
    if (err instanceof Error && err.message.includes("レート制限")) {
      throw err;
    }
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

/**
 * エピソードをタイトルで検索してApple Podcasts URLを取得（Search API）
 *
 * 単一エピソードの検索に最適。Lookup APIの200件制限を回避できる。
 *
 * @param title - エピソードのタイトル
 * @param guid - エピソードのGUID（マッチング確認用）
 * @param podcastId - Apple Podcasts の collectionId（結果のフィルタリング用、オプション）
 * @returns Apple Podcasts URL、見つからない場合は null
 */
export async function searchApplePodcastsEpisodeByTitle(
  title: string,
  guid: string,
  podcastId?: string
): Promise<string | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=podcast&entity=podcastEpisode&limit=20`;

  let response: Response;
  try {
    response = await fetchWithRateLimit(url);
  } catch (err) {
    // 429エラーの場合は上位に投げる
    if (err instanceof Error && err.message.includes("レート制限")) {
      throw err;
    }
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let data: iTunesSearchResponse;
  try {
    data = (await response.json()) as iTunesSearchResponse;
  } catch {
    return null;
  }

  // GUIDが一致するエピソードを探す
  for (const result of data.results) {
    if (result.episodeGuid === guid) {
      // podcastIdが指定されている場合は一致確認
      if (podcastId && result.collectionId !== parseInt(podcastId)) {
        continue;
      }
      // trackViewUrl から不要なパラメータを除去
      return result.trackViewUrl.replace(/&uo=\d+$/, "");
    }
  }

  return null;
}
