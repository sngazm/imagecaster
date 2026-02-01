import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { TranscriptData } from "../types";

/**
 * テスト用ヘルパー: エピソードを作成してID・storageKeyを返す
 */
async function createTestEpisode(data: {
  title: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
  slug?: string;
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

describe("Episodes API - CRUD Operations", () => {
  describe("PUT /api/episodes/:id", () => {
    it("updates episode title and description", async () => {
      const { id } = await createTestEpisode({
        title: "Original Title",
        description: "Original description",
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          description: "Updated description",
        }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.title).toBe("Updated Title");
      expect(json.description).toBe("Updated description");
    });

    it("updates publishAt to schedule episode", async () => {
      const { id } = await createTestEpisode({
        title: "Scheduled Episode",
        publishAt: null,
      });

      const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishAt: futureDate }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.publishAt).toBe(futureDate);
    });

    it("updates Bluesky post settings", async () => {
      const { id } = await createTestEpisode({
        title: "Bluesky Test",
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueskyPostEnabled: true,
          blueskyPostText: "Check out my new episode!",
        }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.blueskyPostEnabled).toBe(true);
      expect(json.blueskyPostText).toBe("Check out my new episode!");
    });

    it("allows slug change in draft status", async () => {
      const { id } = await createTestEpisode({
        title: "Slug Change Test",
      });

      const newSlug = `new-slug-${Date.now()}`;
      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: newSlug }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.slug).toBe(newSlug);
      expect(json.id).toBe(newSlug);
    });

    it("rejects invalid slug format", async () => {
      const { id } = await createTestEpisode({
        title: "Invalid Slug Test",
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "Invalid Slug With Spaces!" }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid slug");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-episode-id",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Test" }),
        }
      );

      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.error).toBe("Episode not found");
    });

    it("allows transcribeStatus change from failed to pending for retry", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Failed Episode",
        skipTranscription: false,
      });

      // meta.json を直接操作して transcribeStatus を failed 状態にする
      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.transcribeStatus = "failed";
      data.audioUrl = "https://example.com/audio.mp3";
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      // transcribeStatus を pending に変更（リトライ）
      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcribeStatus: "pending" }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.transcribeStatus).toBe("pending");
    });

    it("rejects transcribeStatus change from none to pending (not failed)", async () => {
      const { id } = await createTestEpisode({
        title: "Draft Episode",
        skipTranscription: false,
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcribeStatus: "pending" }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("not allowed");
    });

    it("rejects retry when no audio file available", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Failed Episode No Audio",
        skipTranscription: false,
      });

      // meta.json を直接操作して transcribeStatus を failed 状態にする（音声なし）
      const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const data = JSON.parse(await meta!.text());
      data.publishStatus = "draft";
      data.transcribeStatus = "failed";
      data.audioUrl = "";
      data.sourceAudioUrl = null;
      await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
        httpMetadata: { contentType: "application/json" },
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcribeStatus: "pending" }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("no audio file");
    });
  });

  describe("DELETE /api/episodes/:id", () => {
    it("deletes an existing episode", async () => {
      const { id } = await createTestEpisode({
        title: "Episode to Delete",
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);

      // 削除後は取得できないことを確認
      const getResponse = await SELF.fetch(
        `http://localhost/api/episodes/${id}`
      );
      expect(getResponse.status).toBe(404);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-episode-id",
        {
          method: "DELETE",
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/episodes/:id", () => {
    it("returns episode details", async () => {
      const { id } = await createTestEpisode({
        title: "Get Test Episode",
        description: "Test description",
      });

      const response = await SELF.fetch(`http://localhost/api/episodes/${id}`);

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.id).toBe(id);
      expect(json.title).toBe("Get Test Episode");
      expect(json.description).toBe("Test description");
      expect(json.publishStatus).toBe("new");
      expect(json.transcribeStatus).toBe("none");
    });
  });
});

/**
 * テスト用ヘルパー: transcript.json をR2にアップロード
 */
async function uploadTranscriptJson(storageKey: string): Promise<void> {
  const transcriptData: TranscriptData = {
    segments: [
      { start: 0, end: 2.5, text: "テストセグメント" },
    ],
    language: "ja",
  };
  await env.R2_BUCKET.put(
    `episodes/${storageKey}/transcript.json`,
    JSON.stringify(transcriptData),
    { httpMetadata: { contentType: "application/json" } }
  );
}

describe("Episodes API - Transcription", () => {
  describe("POST /api/episodes/:id/transcription-complete", () => {
    it("marks transcription as completed and sets publishStatus to scheduled", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const { id, storageKey } = await createTestEpisode({
        title: "Transcription Test",
        publishAt: futureDate,
        skipTranscription: false,
      });

      // transcript.json をR2にアップロード
      await uploadTranscriptJson(storageKey);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcribeStatus: "completed",
            duration: 3600,
          }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      // publishAtが未来なのでscheduledになる
      expect(json.publishStatus).toBe("scheduled");
      expect(json.transcribeStatus).toBe("completed");
    });

    it("marks transcription as failed", async () => {
      const { id } = await createTestEpisode({
        title: "Failed Transcription Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcribeStatus: "failed",
          }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.transcribeStatus).toBe("failed");
    });

    it("sets publishStatus to draft when publishAt is null", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Draft After Transcription",
        publishAt: null,
      });

      // transcript.json をR2にアップロード
      await uploadTranscriptJson(storageKey);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcribeStatus: "completed",
          }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.publishStatus).toBe("draft");
      expect(json.transcribeStatus).toBe("completed");
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/transcription-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        }
      );

      expect(response.status).toBe(404);
    });
  });
});

describe("Episodes API - Sort Order", () => {
  describe("GET /api/episodes", () => {
    it("sorts episodes by publishAt, falling back to createdAt for drafts", async () => {
      // 3つのエピソードを作成
      const { id: idA, storageKey: skA } = await createTestEpisode({ title: "Episode A" });
      const { id: idB, storageKey: skB } = await createTestEpisode({ title: "Episode B" });
      const { id: idC, storageKey: skC } = await createTestEpisode({ title: "Episode C" });

      // meta.json を直接操作して日付を設定
      // A: publishAt あり（中間の日付）
      const metaA = await env.R2_BUCKET.get(`episodes/${skA}/meta.json`);
      const dataA = JSON.parse(await metaA!.text());
      dataA.publishAt = "2024-01-15T00:00:00.000Z";
      dataA.createdAt = "2024-01-01T00:00:00.000Z";
      await env.R2_BUCKET.put(`episodes/${skA}/meta.json`, JSON.stringify(dataA), {
        httpMetadata: { contentType: "application/json" },
      });

      // B: publishAt なし（下書き）、createdAt が最新
      const metaB = await env.R2_BUCKET.get(`episodes/${skB}/meta.json`);
      const dataB = JSON.parse(await metaB!.text());
      dataB.publishAt = null;
      dataB.createdAt = "2024-01-20T00:00:00.000Z";
      await env.R2_BUCKET.put(`episodes/${skB}/meta.json`, JSON.stringify(dataB), {
        httpMetadata: { contentType: "application/json" },
      });

      // C: publishAt あり（一番古い日付）
      const metaC = await env.R2_BUCKET.get(`episodes/${skC}/meta.json`);
      const dataC = JSON.parse(await metaC!.text());
      dataC.publishAt = "2024-01-10T00:00:00.000Z";
      dataC.createdAt = "2024-01-01T00:00:00.000Z";
      await env.R2_BUCKET.put(`episodes/${skC}/meta.json`, JSON.stringify(dataC), {
        httpMetadata: { contentType: "application/json" },
      });

      // 一覧を取得
      const response = await SELF.fetch("http://localhost/api/episodes");
      expect(response.status).toBe(200);

      const json = await response.json();
      const ids = json.episodes.map((ep: { id: string }) => ep.id);

      // B(createdAt: 1/20) → A(publishAt: 1/15) → C(publishAt: 1/10) の順
      const indexA = ids.indexOf(idA);
      const indexB = ids.indexOf(idB);
      const indexC = ids.indexOf(idC);

      expect(indexB).toBeLessThan(indexA);
      expect(indexA).toBeLessThan(indexC);
    });

    it("includes createdAt in episode list response", async () => {
      const { id } = await createTestEpisode({ title: "CreatedAt Test" });

      const response = await SELF.fetch("http://localhost/api/episodes");
      expect(response.status).toBe(200);

      const json = await response.json();
      const episode = json.episodes.find((ep: { id: string }) => ep.id === id);
      expect(episode).toBeDefined();
      expect(episode.createdAt).toBeDefined();
      expect(typeof episode.createdAt).toBe("string");
    });
  });
});

describe("Episodes API - Validation", () => {
  describe("POST /api/episodes", () => {
    it("creates episode with custom slug", async () => {
      const customSlug = `custom-slug-${Date.now()}`;
      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Custom Slug Episode",
          slug: customSlug,
        }),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.slug).toBe(customSlug);
    });

    it("rejects invalid slug format", async () => {
      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Invalid Slug Episode",
          slug: "Invalid Slug!",
        }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid slug");
    });

    it("rejects duplicate slug", async () => {
      const slug = `unique-slug-${Date.now()}`;

      // 1つ目を作成
      await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "First Episode", slug }),
      });

      // 同じslugで2つ目を作成
      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Second Episode", slug }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("already exists");
    });

    it("creates episode with skipTranscription flag", async () => {
      const response = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Skip Transcription Episode",
          skipTranscription: true,
        }),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.id).toBeDefined();

      // 詳細を取得して確認
      const detailResponse = await SELF.fetch(
        `http://localhost/api/episodes/${json.id}`
      );
      const detail = await detailResponse.json();
      expect(detail.skipTranscription).toBe(true);
    });
  });
});
