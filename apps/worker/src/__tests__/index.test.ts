import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { TEST_PODCAST_ID, getApiBase, ensureTestPodcast, createTestEpisode } from "./helpers";

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

  describe("RSS Feed (Public Endpoint)", () => {
    beforeAll(async () => {
      await ensureTestPodcast();
    });

    it("GET /public/podcasts/:podcastId/feed.xml returns XML content type", async () => {
      const response = await SELF.fetch(
        `http://localhost/public/podcasts/${TEST_PODCAST_ID}/feed.xml`
      );
      // feed.xml はR2からデータを取得するので、R2がモックされていない場合はエラーになる可能性がある
      // ここではContent-Typeのチェックのみ
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("xml");
    });
  });
});

describe("Podcasts API", () => {
  describe("GET /api/podcasts", () => {
    it("returns 200 with podcast list", async () => {
      const response = await SELF.fetch("http://localhost/api/podcasts");
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toHaveProperty("podcasts");
      expect(Array.isArray(json.podcasts)).toBe(true);
    });
  });

  describe("POST /api/podcasts", () => {
    it("creates a new podcast", async () => {
      const id = `new-podcast-${Date.now()}`;
      const response = await SELF.fetch("http://localhost/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: "New Test Podcast",
        }),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.id).toBe(id);
      expect(json.title).toBe("New Test Podcast");
    });

    it("returns 400 when id is missing", async () => {
      const response = await SELF.fetch("http://localhost/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No ID" }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 400 when title is missing", async () => {
      const response = await SELF.fetch("http://localhost/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: `test-${Date.now()}` }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json).toHaveProperty("error");
    });

    it("rejects invalid id format", async () => {
      const response = await SELF.fetch("http://localhost/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "Invalid ID With Spaces!",
          title: "Test",
        }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid id");
    });
  });

  describe("DELETE /api/podcasts/:id", () => {
    it("deletes an existing podcast", async () => {
      const id = `delete-test-${Date.now()}`;
      // 先に作成
      await SELF.fetch("http://localhost/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: "To Delete" }),
      });

      // 削除
      const response = await SELF.fetch(
        `http://localhost/api/podcasts/${id}`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("returns 404 for non-existent podcast", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/podcasts/non-existent-podcast-id",
        { method: "DELETE" }
      );

      expect(response.status).toBe(404);
    });
  });
});

describe("Episodes API", () => {
  beforeAll(async () => {
    await ensureTestPodcast();
  });

  describe("GET /api/podcasts/:podcastId/episodes", () => {
    it("returns 200 with episode list", async () => {
      const response = await SELF.fetch(`${getApiBase()}/episodes`);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toHaveProperty("episodes");
      expect(Array.isArray(json.episodes)).toBe(true);
    });
  });

  describe("GET /api/podcasts/:podcastId/episodes/:id", () => {
    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        `${getApiBase()}/episodes/non-existent-id`
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/podcasts/:podcastId/episodes", () => {
    it("creates a new episode", async () => {
      const newEpisode = {
        title: "Test Episode",
        description: "This is a test episode",
        publishAt: new Date(Date.now() + 86400000).toISOString(), // 明日
      };

      const response = await SELF.fetch(`${getApiBase()}/episodes`, {
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
      const response = await SELF.fetch(`${getApiBase()}/episodes`, {
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
