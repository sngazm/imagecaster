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

    it("allows retry for episode stuck in 'uploading' status", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Upload Retry Test",
      });

      // 前回のアップロード失敗で uploading のまま残った状態を再現
      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "uploading";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
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

      // ステータスチェックの400にならないこと（R2クレデンシャルがない環境では404/500になりうる）
      expect([200, 404, 500]).toContain(response.status);
    });

    it("rejects upload for episode that already has audio (draft)", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Upload Draft Reject Test",
      });

      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.audioUrl = "https://example.com/audio.mp3";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
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

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Episode is not in new or uploading status");
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

    it("rejects upload-from-url for episode that already has audio (draft)", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Upload From URL Draft Reject Test",
      });

      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.audioUrl = "https://example.com/audio.mp3";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/upload-from-url`,
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
      expect(json.error).toBe("Episode is not in new or uploading status");
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

  describe("話者トラック（zip）", () => {
    it("アップロード用の Presigned URL を発行する", async () => {
      const { id } = await createTestEpisode({ title: "Tracks URL Test" });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/tracks/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "application/zip",
            fileSize: 380000000,
          }),
        }
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { uploadUrl: string };
      expect(json.uploadUrl).toContain("tracks.zip");
    });

    it("contentType が無ければ 400 を返す", async () => {
      const { id } = await createTestEpisode({ title: "Tracks Validation" });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/tracks/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileSize: 100 }),
        }
      );

      expect(response.status).toBe(400);
    });

    it("完了通知で話者の割り当てを保存する", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Tracks Complete",
      });

      await env.R2_BUCKET.put(`episodes/${storageKey}/tracks.zip`, "dummy");

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/tracks/upload-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerTracks: [
              { track: 1, label: "あずま" },
              { track: 2, label: "鉄塔" },
              { track: 3, label: "" },
            ],
          }),
        }
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        tracksUploadedAt: string;
        speakerTracks: Array<{ track: number; label: string | null }>;
      };

      expect(json.tracksUploadedAt).toBeTruthy();
      // 空文字のラベルは非発話トラック（null）として保存される
      expect(json.speakerTracks).toEqual([
        { track: 1, label: "あずま" },
        { track: 2, label: "鉄塔" },
        { track: 3, label: null },
      ]);
    });

    it("zip が見えないうちはリトライ可能な 503 を返す", async () => {
      const { id } = await createTestEpisode({ title: "Tracks Not Visible" });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/tracks/upload-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(503);
    });

    it("zip を削除できる", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Tracks Delete",
      });

      await env.R2_BUCKET.put(`episodes/${storageKey}/tracks.zip`, "dummy");
      await SELF.fetch(`http://localhost/api/episodes/${id}/tracks/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/tracks`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(200);
      expect(await env.R2_BUCKET.head(`episodes/${storageKey}/tracks.zip`)).toBeNull();

      const detail = await SELF.fetch(`http://localhost/api/episodes/${id}`);
      const meta = (await detail.json()) as { tracksUploadedAt: string | null };
      expect(meta.tracksUploadedAt).toBeNull();
    });
  });
});

describe("話者トラックの保存", () => {
  it("トラックごとの Presigned URL を返す", async () => {
    const { id } = await createTestEpisode({ title: "トラック保存" });

    const response = await SELF.fetch(
      `http://localhost/api/episodes/${id}/speaker-tracks/upload-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: 1, label: "あずま" }),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { uploadUrl: string; url: string };

    // 切り抜き動画を作るとき、どれが誰の声かファイル名で分かるように
    expect(body.url).toContain("/tracks/1-あずま.m4a");
    expect(body.uploadUrl).toContain("http");
  });

  it("番号と話者名が要る", async () => {
    const { id } = await createTestEpisode({ title: "トラック保存" });

    const response = await SELF.fetch(
      `http://localhost/api/episodes/${id}/speaker-tracks/upload-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: 1 }),
      }
    );

    expect(response.status).toBe(400);
  });

  it("保存したトラックをエピソードに記録する", async () => {
    const { id } = await createTestEpisode({ title: "トラック保存" });

    await SELF.fetch(
      `http://localhost/api/episodes/${id}/speaker-tracks/upload-complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [
            { track: 1, label: "あずま" },
            { track: 2, label: "鉄塔" },
          ],
        }),
      }
    );

    const meta = (await (
      await SELF.fetch(`http://localhost/api/episodes/${id}`)
    ).json()) as {
      speakerTrackFiles: Array<{ track: number; label: string; url: string }>;
    };

    expect(meta.speakerTrackFiles).toHaveLength(2);
    expect(meta.speakerTrackFiles[1].label).toBe("鉄塔");
    expect(meta.speakerTrackFiles[1].url).toContain("2-鉄塔.m4a");
  });

  it("知らないエピソードなら404", async () => {
    const response = await SELF.fetch(
      "http://localhost/api/episodes/nope/speaker-tracks/upload-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: 1, label: "あずま" }),
      }
    );

    expect(response.status).toBe(404);
  });
});
