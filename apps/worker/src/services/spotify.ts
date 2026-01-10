/**
 * Spotify Web API クライアント
 *
 * Spotify のエピソード情報を取得し、
 * タイトルでマッチングしてエピソード個別の URL を取得する
 */

/**
 * Spotify API のエピソード情報
 */
interface SpotifyEpisode {
  id: string;
  name: string;
  description: string;
  release_date: string;
  duration_ms: number;
  external_urls: {
    spotify: string;
  };
}

/**
 * Spotify API のページネーションレスポンス
 */
interface SpotifyEpisodesResponse {
  items: SpotifyEpisode[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

/**
 * Spotify API のトークンレスポンス
 */
interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * マッチング結果
 */
export interface SpotifyMatchResult {
  episodeId: string;
  spotifyUrl: string | null;
  matched: boolean;
  matchedTitle?: string;
}

/**
 * Spotify API クライアント
 */
export class SpotifyClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * アクセストークンを取得（Client Credentials Flow）
   */
  private async getAccessToken(): Promise<string> {
    // キャッシュされたトークンがまだ有効なら再利用
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Spotify API] Token error: ${response.status} - ${errorBody}`);
      throw new Error(`Spotify token error: ${response.status}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    console.log(`[Spotify API] Token acquired, expires in ${data.expires_in}s`);
    return this.accessToken;
  }

  /**
   * Show（ポッドキャスト）のエピソード一覧を取得
   *
   * @param showId - Spotify の Show ID
   * @param market - マーケット（国コード）、デフォルトは JP
   * @returns エピソード一覧
   */
  async fetchShowEpisodes(
    showId: string,
    market: string = "JP"
  ): Promise<SpotifyEpisode[]> {
    const token = await this.getAccessToken();
    const episodes: SpotifyEpisode[] = [];
    let offset = 0;
    const limit = 50; // Spotify API の最大値

    while (true) {
      const url = `https://api.spotify.com/v1/shows/${showId}/episodes?market=${market}&limit=${limit}&offset=${offset}`;
      console.log(`[Spotify API] Requesting: ${url}`);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          console.error(`[Spotify API] Rate limited, retry after: ${retryAfter}s`);
          throw new Error(`Spotify API rate limited. Retry after ${retryAfter} seconds.`);
        }
        const errorBody = await response.text();
        console.error(`[Spotify API] Error: ${response.status} - ${errorBody}`);
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = (await response.json()) as SpotifyEpisodesResponse;
      episodes.push(...data.items);

      console.log(`[Spotify API] Fetched ${data.items.length} episodes (total: ${episodes.length}/${data.total})`);

      if (!data.next || episodes.length >= data.total) {
        break;
      }

      offset += limit;
    }

    return episodes;
  }

  /**
   * タイトルを正規化してマッチング用に変換
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      // 全角を半角に変換
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
        String.fromCharCode(s.charCodeAt(0) - 0xfee0)
      )
      // 連続する空白を単一のスペースに
      .replace(/\s+/g, " ")
      // 前後の空白を削除
      .trim();
  }

  /**
   * ローカルエピソードと Spotify エピソードをタイトルでマッチング
   *
   * @param showId - Spotify の Show ID
   * @param localEpisodes - ローカルエピソードの配列（id, title）
   * @returns マッチング結果の配列
   */
  async matchEpisodesByTitle(
    showId: string,
    localEpisodes: Array<{ id: string; title: string }>
  ): Promise<SpotifyMatchResult[]> {
    const spotifyEpisodes = await this.fetchShowEpisodes(showId);
    const results: SpotifyMatchResult[] = [];

    // 正規化されたタイトル → Spotify エピソードのマップを作成
    const spotifyMap = new Map<string, SpotifyEpisode>();
    for (const ep of spotifyEpisodes) {
      const normalizedTitle = this.normalizeTitle(ep.name);
      spotifyMap.set(normalizedTitle, ep);
    }

    for (const local of localEpisodes) {
      const normalizedLocalTitle = this.normalizeTitle(local.title);

      // 完全一致を試みる
      let spotifyEp = spotifyMap.get(normalizedLocalTitle);

      // 完全一致しない場合は部分一致を試みる
      if (!spotifyEp) {
        for (const [normalizedSpotifyTitle, ep] of spotifyMap.entries()) {
          // ローカルタイトルがSpotifyタイトルを含む、またはその逆
          if (
            normalizedSpotifyTitle.includes(normalizedLocalTitle) ||
            normalizedLocalTitle.includes(normalizedSpotifyTitle)
          ) {
            spotifyEp = ep;
            break;
          }
        }
      }

      if (spotifyEp) {
        results.push({
          episodeId: local.id,
          spotifyUrl: spotifyEp.external_urls.spotify,
          matched: true,
          matchedTitle: spotifyEp.name,
        });
        console.log(
          `[Spotify] Matched: "${local.title}" -> "${spotifyEp.name}"`
        );
      } else {
        results.push({
          episodeId: local.id,
          spotifyUrl: null,
          matched: false,
        });
        console.log(`[Spotify] No match: "${local.title}"`);
      }
    }

    return results;
  }
}

/**
 * Spotify クライアントを作成
 *
 * @param clientId - Spotify Client ID
 * @param clientSecret - Spotify Client Secret
 * @returns SpotifyClient インスタンス
 */
export function createSpotifyClient(
  clientId: string,
  clientSecret: string
): SpotifyClient {
  return new SpotifyClient(clientId, clientSecret);
}
