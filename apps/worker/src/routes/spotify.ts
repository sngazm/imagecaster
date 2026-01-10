import { Hono } from "hono";
import type { Env, EpisodeMeta } from "../types";
import { getIndex, getEpisodeMeta, saveEpisodeMeta } from "../services/r2";
import { createSpotifyClient, type SpotifyMatchResult } from "../services/spotify";

export const spotify = new Hono<{ Bindings: Env }>();

/**
 * Spotifyエピソード一括取得のレスポンス
 */
interface FetchEpisodesResponse {
  success: boolean;
  total: number;
  matched: number;
  results: Array<{
    episodeId: string;
    title: string;
    spotifyUrl: string | null;
    matched: boolean;
    matchedTitle?: string;
  }>;
}

/**
 * POST /api/spotify/fetch-episodes
 * Spotify APIからエピソードURLを一括取得してマッチング
 */
spotify.post("/fetch-episodes", async (c) => {
  // Spotify API認証情報の確認
  if (!c.env.SPOTIFY_CLIENT_ID || !c.env.SPOTIFY_CLIENT_SECRET) {
    return c.json(
      { error: "Spotify API credentials not configured" },
      500
    );
  }

  const index = await getIndex(c.env);
  const showId = index.podcast.spotifyShowId;

  if (!showId) {
    return c.json(
      { error: "Spotify Show ID not configured in settings" },
      400
    );
  }

  // ローカルエピソードを取得
  const localEpisodes: Array<{ id: string; title: string; meta: EpisodeMeta }> = [];
  for (const ref of index.episodes) {
    try {
      const meta = await getEpisodeMeta(c.env, ref.id);
      localEpisodes.push({
        id: ref.id,
        title: meta.title,
        meta,
      });
    } catch {
      console.error(`[Spotify] Failed to get episode meta: ${ref.id}`);
    }
  }

  if (localEpisodes.length === 0) {
    return c.json({
      success: true,
      total: 0,
      matched: 0,
      results: [],
    } as FetchEpisodesResponse);
  }

  // Spotifyクライアントを作成してマッチング実行
  const client = createSpotifyClient(
    c.env.SPOTIFY_CLIENT_ID,
    c.env.SPOTIFY_CLIENT_SECRET
  );

  try {
    const matchResults = await client.matchEpisodesByTitle(
      showId,
      localEpisodes.map((ep) => ({ id: ep.id, title: ep.title }))
    );

    // マッチング結果を保存
    const results: FetchEpisodesResponse["results"] = [];
    let matchedCount = 0;

    for (const result of matchResults) {
      const localEp = localEpisodes.find((ep) => ep.id === result.episodeId);
      if (!localEp) continue;

      if (result.matched && result.spotifyUrl) {
        // URL を保存
        localEp.meta.spotifyUrl = result.spotifyUrl;
        await saveEpisodeMeta(c.env, localEp.meta);
        matchedCount++;
      }

      results.push({
        episodeId: result.episodeId,
        title: localEp.title,
        spotifyUrl: result.spotifyUrl,
        matched: result.matched,
        matchedTitle: result.matchedTitle,
      });
    }

    return c.json({
      success: true,
      total: localEpisodes.length,
      matched: matchedCount,
      results,
    } as FetchEpisodesResponse);
  } catch (error) {
    console.error("[Spotify] Error fetching episodes:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: `Spotify API error: ${message}` }, 500);
  }
});
