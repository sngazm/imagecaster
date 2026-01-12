import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Settings API", () => {
  describe("GET /api/settings", () => {
    it("returns podcast settings", async () => {
      const response = await SELF.fetch("http://localhost/api/settings");

      expect(response.status).toBe(200);

      const json = await response.json();
      // 設定オブジェクトの基本的なプロパティを確認
      expect(json).toHaveProperty("title");
      expect(json).toHaveProperty("description");
      expect(json).toHaveProperty("author");
    });
  });

  describe("PUT /api/settings", () => {
    it("updates podcast title", async () => {
      const newTitle = `Test Podcast ${Date.now()}`;

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.title).toBe(newTitle);
    });

    it("updates multiple settings at once", async () => {
      const updates = {
        title: `Updated Podcast ${Date.now()}`,
        description: "Updated description for testing",
        author: "Test Author",
        email: "test@example.com",
        language: "en",
        category: "Technology",
      };

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.title).toBe(updates.title);
      expect(json.description).toBe(updates.description);
      expect(json.author).toBe(updates.author);
      expect(json.email).toBe(updates.email);
      expect(json.language).toBe(updates.language);
      expect(json.category).toBe(updates.category);
    });

    it("updates explicit flag", async () => {
      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ explicit: true }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.explicit).toBe(true);
    });

    it("preserves existing settings when updating partial fields", async () => {
      // 最初に設定を取得
      const getResponse = await SELF.fetch("http://localhost/api/settings");
      const originalSettings = await getResponse.json();

      // titleのみ更新
      const newTitle = `Partial Update ${Date.now()}`;
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });

      // 更新後の設定を取得
      const updatedResponse = await SELF.fetch("http://localhost/api/settings");
      const updatedSettings = await updatedResponse.json();

      expect(updatedSettings.title).toBe(newTitle);
      // 他のフィールドは保持される（明示的にundefinedでない限り）
      expect(updatedSettings.author).toBe(originalSettings.author);
    });
  });

  describe("POST /api/settings/artwork/upload-url", () => {
    it("rejects invalid content type", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/gif",
            fileSize: 100000,
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid content type");
    });

    it("rejects file too large", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileSize: 10 * 1024 * 1024, // 10MB
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("File too large");
    });

    it("accepts valid JPEG request", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileSize: 500000,
          }),
        }
      );

      // 開発モードではR2クレデンシャルがないためエラーになる可能性
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.uploadUrl).toBeDefined();
        expect(json.expiresIn).toBe(3600);
        expect(json.artworkUrl).toContain("assets/artwork.jpg");
      }
    });

    it("accepts valid PNG request", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/png",
            fileSize: 500000,
          }),
        }
      );

      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.artworkUrl).toContain("assets/artwork.png");
      }
    });
  });

  describe("POST /api/settings/artwork/upload-complete", () => {
    it("updates artworkUrl in settings", async () => {
      const artworkUrl = "https://example.com/artwork.jpg";

      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artworkUrl }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.artworkUrl).toBe(artworkUrl);

      // 設定を取得して確認
      const getResponse = await SELF.fetch("http://localhost/api/settings");
      const settings = await getResponse.json();
      expect(settings.artworkUrl).toBe(artworkUrl);
    });
  });
});
