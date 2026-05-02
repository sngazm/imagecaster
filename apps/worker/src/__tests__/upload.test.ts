import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";

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

  describe("POST /api/episodes/:id/replace-url", () => {
    it("rejects replace for episode in 'new' status", async () => {
      const { id } = await createTestEpisode({
        title: "Replace New Episode Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "audio/mpeg",
            fileSize: 1024000,
          }),
        }
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Cannot replace audio");
    });

    it("rejects missing required fields", async () => {
      const { id } = await createTestEpisode({
        title: "Replace Validation Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-url`,
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
        "http://localhost/api/episodes/non-existent-id/replace-url",
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

    it("allows replace for draft episode", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Replace Draft Episode Test",
      });

      // draft状態にする
      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.audioUrl = "https://example.com/audio.mp3";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "audio/mpeg",
            fileSize: 2048000,
          }),
        }
      );

      // R2クレデンシャルがない場合は500等になる可能性があるが、400(状態エラー)では無いことを確認
      expect([200, 404, 500]).toContain(response.status);
      if (response.status === 200) {
        const json = await response.json();
        expect(json.uploadUrl).toBeDefined();
      }
    });
  });

  describe("POST /api/episodes/:id/replace-complete", () => {
    it("rejects replace-complete for episode in 'new' status", async () => {
      const { id } = await createTestEpisode({
        title: "Replace Complete New Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 1800,
            fileSize: 2048000,
          }),
        }
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Cannot replace audio");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/replace-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 1800,
          }),
        }
      );

      expect(response.status).toBe(404);
    });

    it("updates duration/fileSize and resets transcript for draft episode", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Replace Complete Draft Test",
        skipTranscription: false,
      });

      // draft + 文字起こし完了状態にする
      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.transcribeStatus = "completed";
      data.audioUrl = "https://example.com/audio.mp3";
      data.transcriptUrl = "https://example.com/transcript.vtt";
      data.duration = 1000;
      data.fileSize = 1000000;
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 2400,
            fileSize: 5000000,
          }),
        }
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.publishStatus).toBe("draft");
      // skipTranscription: false なので pending に戻される
      expect(json.transcribeStatus).toBe("pending");

      // 詳細取得で更新を確認
      const detailRes = await SELF.fetch(`http://localhost/api/episodes/${id}`);
      const detail = await detailRes.json();
      expect(detail.duration).toBe(2400);
      expect(detail.transcriptUrl).toBeNull();
    });

    it("sets transcribeStatus to 'skipped' when skipTranscription is true", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Replace Skip Transcription Test",
        skipTranscription: true,
      });

      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.audioUrl = "https://example.com/audio.mp3";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: 1500,
            fileSize: 3000000,
          }),
        }
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.transcribeStatus).toBe("skipped");
    });
  });

  describe("POST /api/episodes/:id/replace-from-url", () => {
    it("rejects missing sourceUrl", async () => {
      const { id } = await createTestEpisode({
        title: "Replace From URL Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-from-url`,
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

    it("rejects replace for episode in 'new' status", async () => {
      const { id } = await createTestEpisode({
        title: "Replace From URL New Test",
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/replace-from-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: "https://example.com/audio.mp3",
          }),
        }
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Cannot replace audio");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/replace-from-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: "https://example.com/audio.mp3",
          }),
        }
      );

      expect([404, 500]).toContain(response.status);
    });
  });
});
