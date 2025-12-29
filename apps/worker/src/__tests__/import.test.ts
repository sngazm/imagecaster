import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { getApiBase, ensureTestPodcast } from "./helpers";

describe("Import API", () => {
  beforeAll(async () => {
    await ensureTestPodcast();
  });

  describe("POST /api/podcasts/:podcastId/import/rss", () => {
    it("rejects missing rssUrl", async () => {
      const response = await SELF.fetch(`${getApiBase()}/import/rss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("rssUrl is required");
    });

    it("returns error for invalid RSS URL", async () => {
      const response = await SELF.fetch(`${getApiBase()}/import/rss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rssUrl: "https://invalid-rss-url.example.com/feed.xml",
        }),
      });

      // fetchが失敗するので400エラー
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });
  });

  describe("POST /api/podcasts/:podcastId/import/rss/preview", () => {
    it("rejects missing rssUrl", async () => {
      const response = await SELF.fetch(
        `${getApiBase()}/import/rss/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("rssUrl is required");
    });

    it("returns error for invalid RSS URL", async () => {
      const response = await SELF.fetch(
        `${getApiBase()}/import/rss/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rssUrl: "https://invalid-rss-url.example.com/feed.xml",
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });
  });
});

describe("Deployments API", () => {
  beforeAll(async () => {
    await ensureTestPodcast();
  });

  describe("GET /api/podcasts/:podcastId/deployments", () => {
    it("returns deployments response", async () => {
      const response = await SELF.fetch(`${getApiBase()}/deployments`);

      expect(response.status).toBe(200);

      const json = await response.json();
      // 設定されていない場合は空のレスポンス
      expect(json).toHaveProperty("deployments");
      expect(json).toHaveProperty("configured");

      if (!json.configured) {
        expect(json.deployments).toEqual([]);
      }
    });
  });
});
