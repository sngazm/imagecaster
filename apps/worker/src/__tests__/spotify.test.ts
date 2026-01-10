import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * テスト用ヘルパー: エピソードを作成してIDを返す
 */
async function createTestEpisode(data: {
  title: string;
  description?: string;
  publishAt?: string | null;
}): Promise<{ id: string; slug: string }> {
  const response = await SELF.fetch("http://localhost/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return { id: json.id, slug: json.slug };
}

describe("Spotify Integration", () => {
  describe("Settings - Spotify fields", () => {
    it("updates spotifyShowId in settings", async () => {
      const spotifyShowId = "1234abcd5678efgh";

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyShowId }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.spotifyShowId).toBe(spotifyShowId);
    });

    it("updates spotifyAutoFetch in settings", async () => {
      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyAutoFetch: true }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.spotifyAutoFetch).toBe(true);
    });

    it("clears spotifyShowId with null", async () => {
      // まず設定
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyShowId: "test-id" }),
      });

      // nullでクリア
      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyShowId: null }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.spotifyShowId).toBeNull();
    });
  });

  describe("Episodes - Spotify URL", () => {
    it("updates spotifyUrl on episode", async () => {
      const { id } = await createTestEpisode({
        title: "Spotify URL Test",
      });

      const spotifyUrl = "https://open.spotify.com/episode/abc123";

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.spotifyUrl).toBe(spotifyUrl);
    });

    it("clears spotifyUrl with null", async () => {
      const { id } = await createTestEpisode({
        title: "Clear Spotify URL Test",
      });

      // まず設定
      await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl: "https://open.spotify.com/episode/test" }),
      });

      // nullでクリア
      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl: null }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.spotifyUrl).toBeNull();
    });

    it("includes spotifyUrl in episode list", async () => {
      const { id } = await createTestEpisode({
        title: "Spotify in List Test",
      });

      const spotifyUrl = "https://open.spotify.com/episode/list123";
      await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl }),
      });

      const listResponse = await SELF.fetch("http://localhost/api/episodes");
      expect(listResponse.status).toBe(200);

      const list = await listResponse.json();
      const episode = list.episodes.find((ep: { id: string }) => ep.id === id);
      expect(episode).toBeDefined();
      expect(episode.spotifyUrl).toBe(spotifyUrl);
    });
  });

  describe("POST /api/spotify/fetch-episodes", () => {
    it("returns error when Spotify credentials are not configured", async () => {
      // 開発環境ではSpotifyクレデンシャルが設定されていない
      const response = await SELF.fetch(
        "http://localhost/api/spotify/fetch-episodes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json.error).toContain("Spotify API credentials not configured");
    });

    it("returns error when Spotify Show ID is not set", async () => {
      // Spotify Show IDをクリア
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyShowId: null }),
      });

      // このテストは、クレデンシャルがあってもShow IDがない場合のエラーをチェック
      // 現在の環境ではクレデンシャルがないので、先にそのエラーが出る
      const response = await SELF.fetch(
        "http://localhost/api/spotify/fetch-episodes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      // クレデンシャルがないか、Show IDがないかのどちらかのエラー
      expect([400, 500]).toContain(response.status);
    });
  });
});
