import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker API", () => {
  describe("Health Check", () => {
    it("GET /health returns 200", async () => {
      const response = await SELF.fetch("http://localhost/health");
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({ status: "ok" });
    });
  });

  describe("404 Handler", () => {
    it("returns 404 for unknown routes", async () => {
      const response = await SELF.fetch("http://localhost/unknown-route");
      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json).toEqual({ error: "Not Found" });
    });
  });

  describe("RSS Feed", () => {
    it("GET /feed.xml returns XML content type", async () => {
      const response = await SELF.fetch("http://localhost/feed.xml");
      // feed.xml はR2からデータを取得するので、R2がモックされていない場合はエラーになる可能性がある
      // ここではContent-Typeのチェックのみ
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("xml");
    });
  });
});

describe("Episodes API", () => {
  describe("GET /api/episodes", () => {
    it("returns 200 with episode list", async () => {
      const response = await SELF.fetch("http://localhost/api/episodes");
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toHaveProperty("episodes");
      expect(Array.isArray(json.episodes)).toBe(true);
    });
  });

  describe("GET /api/episodes/:id", () => {
    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id"
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes", () => {
    it("creates a new episode", async () => {
      const newEpisode = {
        title: "Test Episode",
        description: "This is a test episode",
        publishAt: new Date(Date.now() + 86400000).toISOString(), // 明日
      };

      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newEpisode),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      // POST レスポンスは { id, slug, status } のみ
      expect(json).toHaveProperty("id");
      expect(json).toHaveProperty("slug");
      expect(json.status).toBe("draft");
    });

    it("returns 400 when title is missing", async () => {
      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: "No title" }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json).toHaveProperty("error");
    });
  });
});
