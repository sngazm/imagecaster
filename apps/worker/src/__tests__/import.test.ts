import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Import API", () => {
  describe("POST /api/import/rss", () => {
    it("rejects missing rssUrl", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("rssUrl is required");
    });

    it("returns error for invalid RSS URL", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
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

    it("accepts importAudio option", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rssUrl: "https://invalid-rss-url.example.com/feed.xml",
          importAudio: true,
        }),
      });

      // fetchが失敗するので400エラー（リクエスト自体は受け入れられる）
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });

    it("accepts customSlugs option", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rssUrl: "https://invalid-rss-url.example.com/feed.xml",
          customSlugs: {
            "0": "custom-slug-1",
            "1": "custom-slug-2",
          },
        }),
      });

      // fetchが失敗するので400エラー（リクエスト自体は受け入れられる）
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });

    it("accepts skipTranscription option (true)", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rssUrl: "https://invalid-rss-url.example.com/feed.xml",
          skipTranscription: true,
        }),
      });

      // fetchが失敗するので400エラー（リクエスト自体は受け入れられる）
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });

    it("accepts skipTranscription option (false)", async () => {
      const response = await SELF.fetch("http://localhost/api/import/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rssUrl: "https://invalid-rss-url.example.com/feed.xml",
          skipTranscription: false,
        }),
      });

      // fetchが失敗するので400エラー（リクエスト自体は受け入れられる）
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Failed to fetch RSS");
    });
  });

  describe("POST /api/import/rss/preview", () => {
    it("rejects missing rssUrl", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/import/rss/preview",
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
        "http://localhost/api/import/rss/preview",
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
  describe("GET /api/deployments", () => {
    it("returns deployments response", async () => {
      const response = await SELF.fetch("http://localhost/api/deployments");

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
