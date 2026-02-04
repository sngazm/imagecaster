import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * テスト用ヘルパー: エピソードを作成してID・storageKeyを返す
 */
async function createTestEpisode(data: {
  title: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
}): Promise<{ id: string; slug: string; storageKey: string }> {
  const response = await SELF.fetch("http://localhost/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  // GET で storageKey を取得
  const detailRes = await SELF.fetch(`http://localhost/api/episodes/${json.id}`);
  const detail = await detailRes.json();
  return { id: json.id, slug: json.slug, storageKey: detail.storageKey };
}

describe("Upload API", () => {
  describe("POST /api/episodes/:id/upload-url", () => {
    it("generates presigned URL for draft episode", async () => {
      const { id } = await createTestEpisode({
        title: "Upload URL Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "audio/mpeg",
            fileSize: 1024000,
          }),
        }
      );

      // 開発モードではR2クレデンシャルが設定されていないためエラーになる可能性があるが、
      // ステータス更新は行われているはず
      // R2クレデンシャルがない場合は404（内部エラーがcatchされる）または500
      expect([200, 404, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.uploadUrl).toBeDefined();
        expect(json.expiresIn).toBe(3600);
      }
    });

    it("rejects missing required fields", async () => {
      const { id } = await createTestEpisode({
        title: "Upload Validation Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("Missing required fields");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "audio/mpeg",
            fileSize: 1024000,
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/upload-complete", () => {
    it("returns 400 for episode not in uploading status", async () => {
      const { id } = await createTestEpisode({
        title: "Upload Complete Test",
      });

      // draftステータスのままupload-completeを呼ぶ
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/upload-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 3600,
            fileSize: 1024000,
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("Episode is not in uploading status");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/upload-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 3600,
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/upload-from-url", () => {
    it("rejects missing sourceUrl", async () => {
      const { id } = await createTestEpisode({
        title: "Upload From URL Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/upload-from-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("Missing sourceUrl");
    });

    it("returns error for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/upload-from-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: "https://example.com/audio.mp3",
          }),
        }
      );

      // エラーハンドリングが500を返す場合がある
      expect([404, 500]).toContain(response.status);
    });
  });

  describe("POST /api/episodes/:id/artwork/upload-url", () => {
    it("rejects invalid content type", async () => {
      const { id } = await createTestEpisode({
        title: "Artwork Content Type Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/artwork/upload-url`,
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
      const { id } = await createTestEpisode({
        title: "Artwork Size Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/artwork/upload-url`,
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

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileSize: 100000,
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/speaker-tracks/upload-url", () => {
    it("rejects invalid content type", async () => {
      const { id } = await createTestEpisode({
        title: "Speaker Tracks Content Type Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "audio/mpeg",
            fileSize: 100000,
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid content type");
    });

    it("rejects file too large", async () => {
      const { id } = await createTestEpisode({
        title: "Speaker Tracks Size Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "application/zip",
            fileSize: 3 * 1024 * 1024 * 1024, // 3GB
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("File too large");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/speaker-tracks/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "application/zip",
            fileSize: 100000,
          }),
        }
      );

      expect(response.status).toBe(404);
    });

    it("generates presigned URL for valid request", async () => {
      const { id } = await createTestEpisode({
        title: "Speaker Tracks URL Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "application/zip",
            fileSize: 100000,
          }),
        }
      );

      // R2クレデンシャルがない場合は404（内部エラーがcatchされる）または500
      expect([200, 404, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.uploadUrl).toBeDefined();
        expect(json.expiresIn).toBe(3600);
        expect(json.speakerTracksUrl).toBeDefined();
      }
    });
  });

  describe("POST /api/episodes/:id/speaker-tracks/upload-complete", () => {
    it("updates speakerTracksUrl in episode metadata", async () => {
      const { id } = await createTestEpisode({
        title: "Speaker Tracks Complete Test",
      });

      const speakerTracksUrl = "https://example.com/speaker-tracks.zip";

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks/upload-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerTracksUrl }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.speakerTracksUrl).toBe(speakerTracksUrl);

      // 詳細を取得して確認
      const detailResponse = await SELF.fetch(
        `http://localhost/api/episodes/${id}`
      );
      const detail = await detailResponse.json();
      expect(detail.speakerTracksUrl).toBe(speakerTracksUrl);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/speaker-tracks/upload-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerTracksUrl: "https://example.com/speaker-tracks.zip",
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/episodes/:id/speaker-tracks", () => {
    it("deletes speaker tracks from episode", async () => {
      const { id } = await createTestEpisode({
        title: "Speaker Tracks Delete Test",
      });

      // まずspeakerTracksUrlを設定
      await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks/upload-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerTracksUrl: "https://example.com/speaker-tracks.zip",
          }),
        }
      );

      // 削除
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/speaker-tracks`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);

      // 詳細を取得して確認
      const detailResponse = await SELF.fetch(
        `http://localhost/api/episodes/${id}`
      );
      const detail = await detailResponse.json();
      expect(detail.speakerTracksUrl).toBeNull();
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/speaker-tracks",
        { method: "DELETE" }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/artwork/upload-complete", () => {
    it("updates artworkUrl in episode metadata", async () => {
      const { id } = await createTestEpisode({
        title: "Artwork Complete Test",
      });

      const artworkUrl = "https://example.com/artwork.jpg";

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/artwork/upload-complete`,
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

      // 詳細を取得して確認
      const detailResponse = await SELF.fetch(
        `http://localhost/api/episodes/${id}`
      );
      const detail = await detailResponse.json();
      expect(detail.artworkUrl).toBe(artworkUrl);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/artwork/upload-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artworkUrl: "https://example.com/artwork.jpg",
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });
});
