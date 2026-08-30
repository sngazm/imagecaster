import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import { convertToVtt, validateTranscriptData } from "../services/vtt";
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
  const json = (await response.json()) as { id: string; slug: string };
  // GET で storageKey を取得
  const detailRes = await SELF.fetch(`http://localhost/api/episodes/${json.id}`);
  const detail = (await detailRes.json()) as { storageKey: string };
  return { id: json.id, slug: json.slug, storageKey: detail.storageKey };
}

/**
 * テスト用ヘルパー: エピソードをtranscribing状態にする
 * 実際のフローでは upload-complete 後にキューから取得されて transcribing になるが、
 * テスト用にメタデータを直接操作
 */
async function setEpisodeToTranscribing(storageKey: string, id: string, options?: {
  useExternalAudio?: boolean;
}): Promise<void> {
  // meta.json を更新
  const meta = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
  if (!meta) throw new Error("Episode not found");

  const data = JSON.parse(await meta.text());
  data.publishStatus = "draft";
  data.transcribeStatus = "transcribing";

  if (options?.useExternalAudio) {
    // 外部参照（RSSインポート時のように音声をダウンロードしない場合）
    data.audioUrl = "";
    data.sourceAudioUrl = `https://external.example.com/podcasts/${id}/audio.mp3`;
  } else {
    // R2にアップロード済み
    data.audioUrl = `https://example.com/episodes/${storageKey}/audio.mp3`;
    data.sourceAudioUrl = null;
  }

  await env.R2_BUCKET.put(`episodes/${storageKey}/meta.json`, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
  // index.json の更新は不要（draft エピソードは index.json に含まれない）
}

describe("VTT Conversion Utility", () => {
  describe("convertToVtt", () => {
    it("converts simple segments to VTT format", () => {
      const data: TranscriptData = {
        segments: [
          { start: 0, end: 2.5, text: "こんにちは" },
          { start: 2.5, end: 5.0, text: "今日は良い天気ですね" },
        ],
        language: "ja",
      };

      const vtt = convertToVtt(data);

      expect(vtt).toContain("WEBVTT");
      expect(vtt).toContain("00:00:00.000 --> 00:00:02.500");
      expect(vtt).toContain("こんにちは");
      expect(vtt).toContain("00:00:02.500 --> 00:00:05.000");
      expect(vtt).toContain("今日は良い天気ですね");
    });

    it("includes speaker tags when speaker is provided", () => {
      const data: TranscriptData = {
        segments: [
          { start: 0, end: 2.5, text: "こんにちは", speaker: "speaker_0" },
          { start: 2.5, end: 5.0, text: "こんにちは！", speaker: "speaker_1" },
        ],
      };

      const vtt = convertToVtt(data);

      expect(vtt).toContain("<v speaker_0>こんにちは</v>");
      expect(vtt).toContain("<v speaker_1>こんにちは！</v>");
    });

    it("handles long timestamps correctly", () => {
      const data: TranscriptData = {
        segments: [
          { start: 3661.5, end: 3665.123, text: "1時間以上経過" },
        ],
      };

      const vtt = convertToVtt(data);

      expect(vtt).toContain("01:01:01.500 --> 01:01:05.123");
    });
  });

  describe("validateTranscriptData", () => {
    it("validates correct transcript data", () => {
      const data = {
        segments: [
          { start: 0, end: 2.5, text: "テスト" },
        ],
        language: "ja",
      };

      expect(validateTranscriptData(data)).toBe(true);
    });

    it("validates data with speaker field", () => {
      const data = {
        segments: [
          { start: 0, end: 2.5, text: "テスト", speaker: "speaker_0" },
        ],
      };

      expect(validateTranscriptData(data)).toBe(true);
    });

    it("rejects missing segments", () => {
      const data = { language: "ja" };
      expect(validateTranscriptData(data)).toBe(false);
    });

    it("rejects invalid segment structure", () => {
      const data = {
        segments: [
          { start: "invalid", end: 2.5, text: "テスト" },
        ],
      };

      expect(validateTranscriptData(data)).toBe(false);
    });

    it("rejects negative timestamps", () => {
      const data = {
        segments: [
          { start: -1, end: 2.5, text: "テスト" },
        ],
      };

      expect(validateTranscriptData(data)).toBe(false);
    });

    it("rejects non-object input", () => {
      expect(validateTranscriptData(null)).toBe(false);
      expect(validateTranscriptData("string")).toBe(false);
      expect(validateTranscriptData(123)).toBe(false);
    });
  });
});

describe("Transcription Queue API", () => {
  describe("GET /api/transcription/queue", () => {
    it("returns empty array when no episodes are transcribing", async () => {
      const response = await SELF.fetch("http://localhost/api/transcription/queue");

      expect(response.status).toBe(200);

      const json = (await response.json()) as { episodes: unknown[] };
      expect(json.episodes).toBeInstanceOf(Array);
    });

    it("returns transcribing episode without modifying state", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Transcription Queue Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      // transcribing状態に設定
      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch("http://localhost/api/transcription/queue");

      expect(response.status).toBe(200);

      const json = (await response.json()) as { episodes: Array<{ id: string }> };
      expect(json.episodes.length).toBeGreaterThan(0);

      const episode = json.episodes.find((ep) => ep.id === id);
      expect(episode).toBeDefined();

      // 再度取得しても同じエピソードが返る（GETは状態を変えない）
      const response2 = await SELF.fetch("http://localhost/api/transcription/queue");
      const json2 = (await response2.json()) as { episodes: Array<{ id: string }> };
      const episode2 = json2.episodes.find((ep) => ep.id === id);
      expect(episode2).toBeDefined();
    });

    it("does not return locked episodes", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Locked Episode Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // POSTでロックを取得
      await SELF.fetch(`http://localhost/api/episodes/${id}/transcription-lock`, {
        method: "POST",
      });

      // ロック済みエピソードは返らない
      const response = await SELF.fetch("http://localhost/api/transcription/queue");

      const json = (await response.json()) as { episodes: Array<{ id: string }> };
      const episode = json.episodes.find((ep) => ep.id === id);
      expect(episode).toBeUndefined();
    });

    it("respects limit parameter", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/transcription/queue?limit=5"
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { episodes: unknown[] };
      expect(json.episodes.length).toBeLessThanOrEqual(5);
    });

    it("includes sourceAudioUrl in queue response", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Queue With External Audio Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      // 外部音声参照（RSSインポート時）の状態に設定
      await setEpisodeToTranscribing(storageKey, id, { useExternalAudio: true });

      const response = await SELF.fetch("http://localhost/api/transcription/queue");

      expect(response.status).toBe(200);

      const json = (await response.json()) as {
        episodes: Array<{
          id: string;
          audioUrl: string;
          sourceAudioUrl: string | null;
        }>;
      };
      const episode = json.episodes.find((ep) => ep.id === id);
      expect(episode).toBeDefined();
      expect(episode!.audioUrl).toBe("");
      expect(episode!.sourceAudioUrl).toContain("external.example.com");
    });

    it("builds transcriptionQueueIds on first access and keeps it in sync", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Queue Index Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // インデックス未構築の状態から、全件走査で初期化される
      const first = await SELF.fetch("http://localhost/api/transcription/queue");
      expect(first.status).toBe(200);

      const indexObj = await env.R2_BUCKET.get("index.json");
      const index = JSON.parse(await indexObj!.text());
      expect(index.transcriptionQueueIds).toContain(id);

      // transcript.raw.json を置いて完了させる
      const transcriptData: TranscriptData = {
        segments: [{ start: 0, end: 1, text: "テスト" }],
        language: "ja",
      };
      await env.R2_BUCKET.put(
        `episodes/${storageKey}/transcript.raw.json`,
        JSON.stringify(transcriptData)
      );

      await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed" }),
        }
      );

      // completed になったのでインデックスから外れる
      const afterObj = await env.R2_BUCKET.get("index.json");
      const after = JSON.parse(await afterObj!.text());
      expect(after.transcriptionQueueIds).not.toContain(id);

      // キューにも現れない
      const second = await SELF.fetch("http://localhost/api/transcription/queue");
      const json = (await second.json()) as { episodes: Array<{ id: string }> };
      expect(json.episodes.find((ep) => ep.id === id)).toBeUndefined();
    });
  });
});

describe("Transcription Episode APIs", () => {
  describe("GET /api/episodes/:id/audio-url", () => {
    it("returns 400 when no audio URL is available", async () => {
      // audioUrlもsourceAudioUrlも設定されていないエピソードでエラーを確認
      const { id } = await createTestEpisode({
        title: "Audio URL Route Test",
        skipTranscription: false,
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/audio-url`
      );

      // どちらもないので400が返る
      expect(response.status).toBe(400);

      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("Audio file not available");
    });

    it("returns external URL when audioUrl is empty but sourceAudioUrl exists", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "External Audio URL Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      // 外部音声参照の状態に設定（RSSインポート時と同様）
      await setEpisodeToTranscribing(storageKey, id, { useExternalAudio: true });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/audio-url`
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as {
        downloadUrl: string;
        expiresIn: number | null;
        source: string;
      };
      expect(json.downloadUrl).toContain("external.example.com");
      expect(json.expiresIn).toBeNull();
      expect(json.source).toBe("external");
    });

    // Note: このテストはenv.R2_BUCKETの直接操作がSELF.fetch経由のWorkerと
    // 共有されないためスキップ。実際の動作はE2Eテストで確認する。
    it.skip("returns presigned download URL for audio when audioUrl is set", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Audio URL Test",
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/audio-url`
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { downloadUrl: string; expiresIn: number };
      expect(json.downloadUrl).toBeDefined();
      expect(json.downloadUrl).toContain("r2.cloudflarestorage.com");
      expect(json.expiresIn).toBe(3600);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/audio-url"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/transcript/upload-url", () => {
    it("rejects non-transcribing episode (route is correctly matched)", async () => {
      const { id } = await createTestEpisode({
        title: "Non-transcribing Test",
      });

      // new状態のまま - ルートマッチングを確認

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcript/upload-url`,
        { method: "POST" }
      );

      expect(response.status).toBe(400);

      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("not in pending or transcribing status");
    });

    // Note: このテストはenv.R2_BUCKETの直接操作がSELF.fetch経由のWorkerと
    // 共有されないためスキップ。実際の動作はE2Eテストで確認する。
    it.skip("returns presigned upload URL for transcript JSON when transcribing", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Transcript Upload URL Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcript/upload-url`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { uploadUrl: string; expiresIn: number };
      expect(json.uploadUrl).toBeDefined();
      expect(json.uploadUrl).toContain("r2.cloudflarestorage.com");
      expect(json.uploadUrl).toContain("transcript.raw.json");
      expect(json.expiresIn).toBe(3600);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/transcript/upload-url",
        { method: "POST" }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/episodes/:id/transcription-lock", () => {
    it("acquires lock for transcribing episode", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Lock Acquire Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-lock`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as {
        success: boolean;
        lockedAt: string;
        episode: { id: string };
      };
      expect(json.success).toBe(true);
      expect(json.lockedAt).toBeDefined();
      expect(json.episode.id).toBe(id);
    });

    it("returns 409 when already locked", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Already Locked Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // 1回目: ロック成功
      await SELF.fetch(`http://localhost/api/episodes/${id}/transcription-lock`, {
        method: "POST",
      });

      // 2回目: 既にロック済みなので409
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-lock`,
        { method: "POST" }
      );

      expect(response.status).toBe(409);
    });

    it("returns 400 for non-transcribing episode", async () => {
      const { id } = await createTestEpisode({
        title: "Draft Episode Lock Test",
        skipTranscription: false,
      });

      // draft状態のままロックを試みる
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-lock`,
        { method: "POST" }
      );

      expect(response.status).toBe(400);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/transcription-lock",
        { method: "POST" }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/episodes/:id/transcription-lock", () => {
    it("releases transcription lock successfully", async () => {
      const { id } = await createTestEpisode({
        title: "Lock Release Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      // ロック解除APIを呼ぶ（ロックがなくても成功する）
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-lock`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { success: boolean };
      expect(json.success).toBe(true);
    });

    it("returns 404 for non-existent episode", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/non-existent-id/transcription-lock",
        { method: "DELETE" }
      );

      expect(response.status).toBe(404);
    });
  });
});

describe("Transcription Complete with JSON", () => {
  describe("POST /api/episodes/:id/transcription-complete", () => {
    it("returns a retryable 503 when transcript.raw.json is not visible yet", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Transcription Complete Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // transcript.raw.json をアップロードせずに完了を通知
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed" }),
        }
      );

      // Presigned URL での PUT 直後は R2 バインディングから見えないことがあるため、
      // failed 扱いにせずリトライ可能な 503 を返す
      expect(response.status).toBe(503);

      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("not visible in R2 yet");

      // ステータスは transcribing のまま維持され、failed にはならない
      const metaObj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const meta = JSON.parse(await metaObj!.text());
      expect(meta.transcribeStatus).toBe("transcribing");
      expect(meta.transcriptionErrorMessage ?? null).toBeNull();
    });

    it("keeps the recorded error message when failed is reported without one", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Error Message Preservation Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // 1回目: エラー内容付きで failed を通知
      await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcribeStatus: "failed",
            errorMessage: "CUDA out of memory",
          }),
        }
      );

      // 2回目: errorMessage 無しで failed を再通知しても、記録済みの内容を消さない
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "failed" }),
        }
      );

      expect(response.status).toBe(200);

      const metaObj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const meta = JSON.parse(await metaObj!.text());
      expect(meta.transcribeStatus).toBe("failed");
      expect(meta.transcriptionErrorMessage).toBe("CUDA out of memory");
    });

    it("converts JSON to VTT and saves both", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Full Transcription Flow Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // transcript.raw.json をR2にアップロード
      const transcriptData: TranscriptData = {
        segments: [
          { start: 0, end: 2.5, text: "テストセグメント1" },
          { start: 2.5, end: 5.0, text: "テストセグメント2" },
        ],
        language: "ja",
      };

      await env.R2_BUCKET.put(
        `episodes/${storageKey}/transcript.raw.json`,
        JSON.stringify(transcriptData),
        { httpMetadata: { contentType: "application/json" } }
      );

      // 完了を通知
      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed", duration: 300 }),
        }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { success: boolean; publishStatus: string; transcribeStatus: string };
      expect(json.success).toBe(true);
      expect(json.publishStatus).toBe("scheduled");
      expect(json.transcribeStatus).toBe("completed");

      // VTTファイルが作成されたことを確認
      const vttObj = await env.R2_BUCKET.get(`episodes/${storageKey}/transcript.vtt`);
      expect(vttObj).not.toBeNull();

      const vttContent = await vttObj!.text();
      expect(vttContent).toContain("WEBVTT");
      expect(vttContent).toContain("テストセグメント1");
      expect(vttContent).toContain("テストセグメント2");

      // メタデータのtranscriptUrlが更新されたことを確認
      const metaObj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const meta = JSON.parse(await metaObj!.text());
      expect(meta.transcriptUrl).toContain("transcript.vtt");
      expect(meta.duration).toBe(300);
      expect(meta.transcriptionLockedAt).toBeNull();
    });

    it("defers feed regeneration to the cron via feedDirty", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Feed Dirty Flag Test",
        // 過去日時にして published に遷移させる
        publishAt: new Date(Date.now() - 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      const transcriptData: TranscriptData = {
        segments: [{ start: 0, end: 1.5, text: "テスト" }],
        language: "ja",
      };
      await env.R2_BUCKET.put(
        `episodes/${storageKey}/transcript.raw.json`,
        JSON.stringify(transcriptData)
      );

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed" }),
        }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { publishStatus: string };
      expect(json.publishStatus).toBe("published");

      // 全件読み込みを伴うフィード再生成はリクエスト中に行わず、
      // フラグだけ立てて Cron に委ねる（Error 1102 回避）
      const indexObj = await env.R2_BUCKET.get("index.json");
      const index = JSON.parse(await indexObj!.text());
      expect(index.feedDirty).toBe(true);
    });

    it("rejects invalid JSON structure", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Invalid JSON Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      // 不正な構造のJSONをアップロード
      await env.R2_BUCKET.put(
        `episodes/${storageKey}/transcript.raw.json`,
        JSON.stringify({ invalid: "structure" }),
        { httpMetadata: { contentType: "application/json" } }
      );

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed" }),
        }
      );

      expect(response.status).toBe(400);

      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("Invalid transcript data");
    });

    it("handles failed status without requiring JSON", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Failed Transcription Test",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
        skipTranscription: false,
      });

      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "failed" }),
        }
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { success: boolean; transcribeStatus: string };
      expect(json.success).toBe(true);
      expect(json.transcribeStatus).toBe("failed");

      // ロックが解除されたことを確認
      const metaObj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const meta = JSON.parse(await metaObj!.text());
      expect(meta.transcriptionLockedAt).toBeNull();
    });
  });
});

describe("話者トラックと後処理", () => {
  describe("GET /api/transcription/queue", () => {
    it("話者トラックがあれば zip の URL と話者の割り当てを返す", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Queue With Tracks",
      });
      await setEpisodeToTranscribing(storageKey, id);

      await env.R2_BUCKET.put(`episodes/${storageKey}/tracks.zip`, "dummy");
      await SELF.fetch(`http://localhost/api/episodes/${id}/tracks/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakerTracks: [
            { track: 1, label: "あずま" },
            { track: 2, label: "鉄塔" },
            { track: 3, label: null },
          ],
        }),
      });

      const response = await SELF.fetch("http://localhost/api/transcription/queue");
      const json = (await response.json()) as {
        episodes: Array<{
          id: string;
          tracksZipUrl?: string;
          speakerTracks?: Array<{ track: number; label: string | null }>;
          simultaneousUntilSec?: number | null;
        }>;
      };

      const item = json.episodes.find((e) => e.id === id);
      expect(item).toBeDefined();
      expect(item?.tracksZipUrl).toContain("tracks.zip");
      // 番組設定から解決される（未設定なら null = 検出しない）
      expect(item).toHaveProperty("simultaneousUntilSec");
      expect(item?.speakerTracks).toEqual([
        { track: 1, label: "あずま" },
        { track: 2, label: "鉄塔" },
        { track: 3, label: null },
      ]);
    });

    it("話者トラックが無ければ zip の URL は含めない", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Queue Without Tracks",
      });
      await setEpisodeToTranscribing(storageKey, id);

      const response = await SELF.fetch("http://localhost/api/transcription/queue");
      const json = (await response.json()) as {
        episodes: Array<{ id: string; tracksZipUrl?: string }>;
      };

      const item = json.episodes.find((e) => e.id === id);
      expect(item?.tracksZipUrl).toBeUndefined();
    });
  });

  describe("POST /api/episodes/:id/transcript/reprocess", () => {
    /** 生データを置いて文字起こし済みの状態にする */
    async function completeWithRaw(
      id: string,
      storageKey: string,
      data: TranscriptData
    ): Promise<void> {
      await setEpisodeToTranscribing(storageKey, id);
      await env.R2_BUCKET.put(
        `episodes/${storageKey}/transcript.raw.json`,
        JSON.stringify(data)
      );
      await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcription-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcribeStatus: "completed" }),
        }
      );
    }

    it("生データから作り直す", async () => {
      const { id, storageKey } = await createTestEpisode({ title: "Reprocess" });
      await completeWithRaw(id, storageKey, {
        language: "ja",
        segments: [
          { start: 0, end: 2, text: "こんにちは", speaker: "あずま" },
          { start: 2, end: 4, text: "どうも", speaker: "あずま" },
        ],
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcript/reprocess`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { segments: number };
      // 同一話者なので 1 つに統合される
      expect(json.segments).toBe(1);
    });

    it("辞書の変更が既存エピソードに反映される", async () => {
      const { id, storageKey } = await createTestEpisode({
        title: "Reprocess With Dictionary",
      });
      await completeWithRaw(id, storageKey, {
        language: "ja",
        segments: [{ start: 0, end: 2, text: "テトです", speaker: "鉄塔" }],
      });

      // 辞書を登録してから再処理する
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptPostProcess: {
            speakerDefaults: [],
            merge: { enabled: true, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
            corrections: [{ from: "テト", to: "鉄塔", enabled: true }],
          },
        }),
      });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcript/reprocess`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        applied: Array<{ from: string; to: string; count: number }>;
      };
      expect(json.applied).toEqual([{ from: "テト", to: "鉄塔", count: 1 }]);

      const vtt = await env.R2_BUCKET.get(`episodes/${storageKey}/transcript.vtt`);
      expect(await vtt?.text()).toContain("鉄塔です");
    });

    it("生データが無ければ 400 を返す", async () => {
      const { id } = await createTestEpisode({ title: "Reprocess Without Raw" });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/transcript/reprocess`,
        { method: "POST" }
      );

      expect(response.status).toBe(400);
    });

  });

  describe("POST /api/transcription/reprocess-all", () => {
    it("公開済みエピソードを再処理待ちに積む", async () => {
      // index.json に載るのは公開済みエピソードなので、それを直接用意する
      const indexObj = await env.R2_BUCKET.get("index.json");
      const index = JSON.parse((await indexObj?.text()) ?? "{}");
      index.episodes = [
        { id: "published-1", storageKey: "published-1-key" },
        { id: "published-2", storageKey: "published-2-key" },
      ];
      await env.R2_BUCKET.put("index.json", JSON.stringify(index));

      const response = await SELF.fetch(
        "http://localhost/api/transcription/reprocess-all",
        { method: "POST" }
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { queued: number };
      expect(json.queued).toBe(2);

      // Cron が消化するためのリストが積まれている
      const after = JSON.parse(
        (await (await env.R2_BUCKET.get("index.json"))?.text()) ?? "{}"
      );
      expect(after.transcriptReprocessIds).toEqual(["published-1", "published-2"]);
    });
  });
});

describe("Claude の感想", () => {
  describe("POST /api/episodes/:id/impression", () => {
    it("APIキーが無ければ 400 を返す", async () => {
      // テスト環境では ANTHROPIC_API_KEY を設定していない
      const { id } = await createTestEpisode({ title: "Impression No Key" });

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/impression`,
        { method: "POST" }
      );

      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("ANTHROPIC_API_KEY");
    });

    it("存在しないエピソードは 404", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/episodes/__missing__/impression",
        { method: "POST" }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/episodes/:id/impression", () => {
    it("感想を消せる", async () => {
      const { id, storageKey } = await createTestEpisode({ title: "Impression Delete" });

      // 感想がある状態を作る
      const obj = await env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
      const meta = JSON.parse((await obj!.text()) as string);
      meta.claudeImpression = "人間はいつもこうだ。";
      meta.claudeImpressionAt = new Date().toISOString();
      await env.R2_BUCKET.put(
        `episodes/${storageKey}/meta.json`,
        JSON.stringify(meta),
        { httpMetadata: { contentType: "application/json" } }
      );

      const response = await SELF.fetch(
        `http://localhost/api/episodes/${id}/impression`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(200);

      const detail = await SELF.fetch(`http://localhost/api/episodes/${id}`);
      const after = (await detail.json()) as { claudeImpression: string | null };
      expect(after.claudeImpression).toBeNull();
    });
  });
});

describe("POST /api/episodes/:id/transcript/review", () => {
  it("APIキーが無ければ 400 を返す", async () => {
    const { id } = await createTestEpisode({ title: "Review No Key" });

    const response = await SELF.fetch(
      `http://localhost/api/episodes/${id}/transcript/review`,
      { method: "POST" }
    );

    expect(response.status).toBe(400);
  });
});

describe("後処理が保存経路でも全段通ること", () => {
  it("reprocess でハルシネーションが取り除かれる", async () => {
    // savePostProcessed が mergeSegments と applyCorrections だけを直接呼んでいて、
    // ハルシネーション除去と相槌の整形が効いていなかったことがある
    const { id, storageKey } = await createTestEpisode({ title: "Pipeline Coverage" });

    await env.R2_BUCKET.put(
      `episodes/${storageKey}/transcript.raw.json`,
      JSON.stringify({
        language: "ja",
        segments: [
          { start: 0, end: 5, text: "ヤンヤン この仕事体験、なんか全然良くない。", speaker: "あずま" },
          { start: 5, end: 8, text: "うんうんうんうんうんうん、それは分かる。", speaker: "鉄塔" },
          { start: 8, end: 9, text: "はい。", speaker: "あずま" },
        ],
      })
    );

    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [],
          merge: { enabled: false, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
          corrections: [],
          hallucination: { phrases: ["ヤンヤン"], maxRepeat: 10, maxConsecutive: 4 },
          backchannel: { enabled: true, units: ["うん"], maxRepeat: 3 },
        },
      }),
    });

    const response = await SELF.fetch(
      `http://localhost/api/episodes/${id}/transcript/reprocess`,
      { method: "POST" }
    );
    expect(response.status).toBe(200);

    const vtt = await env.R2_BUCKET.get(`episodes/${storageKey}/transcript.vtt`);
    const text = (await vtt?.text()) ?? "";

    // 文頭のハルシネーションが剥がれている
    expect(text).not.toContain("ヤンヤン");
    expect(text).toContain("この仕事体験");
    // 相槌が3回に抑えられている
    expect(text).toContain("うんうんうん、それは分かる。");
    expect(text).not.toContain("うんうんうんうん");

    // 相槌だけのセグメントは丸ごと落ちる
    expect(text).not.toContain("はい。");
  });
});

describe("校正で見つかった修正を登録する", () => {
  async function episodeWithTranscript(): Promise<string> {
    const { id, storageKey } = await createTestEpisode({ title: "校正" });
    await setEpisodeToTranscribing(storageKey, id);
    await env.R2_BUCKET.put(
      `episodes/${storageKey}/transcript.raw.json`,
      JSON.stringify({
        language: "ja",
        segments: [
          { start: 0, end: 3, text: "アサナで管理してます。", speaker: "あずま" },
          { start: 4, end: 7, text: "ソロスを変えたい。", speaker: "鉄塔" },
        ],
      })
    );
    await SELF.fetch(`http://localhost/api/episodes/${id}/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcribeStatus: "completed" }),
    });
    return id;
  }

  function send(id: string, corrections: unknown[]) {
    return SELF.fetch(
      `http://localhost/api/episodes/${id}/transcript/corrections`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corrections }),
      }
    );
  }

  it("番組全体のものは提案になり、この回かぎりのものはすぐ効く", async () => {
    const id = await episodeWithTranscript();

    const response = await send(id, [
      { from: "アサナ", to: "Asana", note: "ツール名", general: true },
      { from: "ソロスを", to: "そろそろ", note: "誤認識", general: false },
    ]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      proposed: number;
      episodeRules: number;
    };
    expect(body.proposed).toBe(1);
    expect(body.episodeRules).toBe(1);

    const saved = (await (
      await SELF.fetch("http://localhost/api/settings")
    ).json()) as {
      transcriptPostProcess: {
        corrections: Array<{ from: string }>;
        proposals: Array<{ from: string }>;
      };
    };

    // 辞書には入らない。機械の判断で足すと公開中の文章を壊す
    expect(saved.transcriptPostProcess.corrections.some((r) => r.from === "アサナ")).toBe(
      false
    );
    expect(saved.transcriptPostProcess.proposals.some((p) => p.from === "アサナ")).toBe(
      true
    );
  });

  it("この回かぎりの修正は文字起こしに反映される", async () => {
    const id = await episodeWithTranscript();
    await send(id, [{ from: "ソロスを", to: "そろそろ", general: false }]);

    const meta = (await (
      await SELF.fetch(`http://localhost/api/episodes/${id}`)
    ).json()) as { storageKey: string };
    const vtt = await (
      await env.R2_BUCKET.get(`episodes/${meta.storageKey}/transcript.vtt`)
    )!.text();

    expect(vtt).toContain("そろそろ");
  });

  it("同じ提案を二度溜めない", async () => {
    const id = await episodeWithTranscript();
    const rule = [{ from: "クロードコード", to: "Claude Code", general: true }];

    const first = (await (await send(id, rule)).json()) as { proposed: number };
    const second = (await (await send(id, rule)).json()) as { proposed: number };

    expect(first.proposed).toBe(1);
    expect(second.proposed).toBe(0);
  });

  it("空や変化のない規則は捨てる", async () => {
    const id = await episodeWithTranscript();

    const body = (await (
      await send(id, [
        { from: "", to: "何か", general: true },
        { from: "同じ", to: "同じ", general: true },
        { from: "あり", to: "", general: true },
      ])
    ).json()) as { proposed: number; episodeRules: number };

    expect(body.proposed).toBe(0);
    expect(body.episodeRules).toBe(0);
  });

  it("知らないエピソードなら404", async () => {
    const response = await send("nope", []);

    expect(response.status).toBe(404);
  });
});

describe("校正の提案は人が承認するまで効かない", () => {
  async function propose(rules: unknown[]): Promise<void> {
    const { id, storageKey } = await createTestEpisode({ title: "提案" });
    await setEpisodeToTranscribing(storageKey, id);
    await env.R2_BUCKET.put(
      `episodes/${storageKey}/transcript.raw.json`,
      JSON.stringify({
        language: "ja",
        segments: [{ start: 0, end: 3, text: "アサナで管理してます。" }],
      })
    );
    await SELF.fetch(`http://local.test/api/episodes/${id}/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcribeStatus: "completed" }),
    });
    await SELF.fetch(`http://local.test/api/episodes/${id}/transcript/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrections: rules }),
    });
  }

  function read(): Promise<any> {
    return SELF.fetch("http://local.test/api/settings").then((r) => r.json());
  }

  it("辞書には入らず、提案として溜まる", async () => {
    // 機械の判断で辞書に足すと公開中の文章を壊す
    await propose([{ from: "アサナ", to: "Asana", note: "ツール名", general: true }]);

    const settings = await read();
    const post = settings.transcriptPostProcess;

    expect(post.corrections.some((r: any) => r.from === "アサナ")).toBe(false);
    expect(post.proposals.some((p: any) => p.from === "アサナ")).toBe(true);
  });

  it("承認すると辞書に入る", async () => {
    await propose([{ from: "アサナ", to: "Asana", general: true }]);

    const response = await SELF.fetch("http://local.test/api/settings/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: [{ from: "アサナ", to: "Asana" }] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { approved: number };
    expect(body.approved).toBe(1);

    const post = (await read()).transcriptPostProcess;
    expect(post.corrections.some((r: any) => r.from === "アサナ")).toBe(true);
    expect(post.proposals).toHaveLength(0);
  });

  it("却下すると提案から消え、辞書にも入らない", async () => {
    await propose([{ from: "メール", to: "mail", general: true }]);

    await SELF.fetch("http://local.test/api/settings/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reject: [{ from: "メール", to: "mail" }] }),
    });

    const post = (await read()).transcriptPostProcess;
    expect(post.corrections.some((r: any) => r.from === "メール")).toBe(false);
    expect(post.proposals).toHaveLength(0);
  });

  it("同じ提案を二度溜めない", async () => {
    await propose([{ from: "アサナ", to: "Asana", general: true }]);
    await propose([{ from: "アサナ", to: "Asana", general: true }]);

    const post = (await read()).transcriptPostProcess;
    expect(post.proposals.filter((p: any) => p.from === "アサナ")).toHaveLength(1);
  });

  it("この回かぎりの修正はそのまま効く", async () => {
    // 提案にするのは辞書に入れるものだけ。エピソードの修正は承認を待たない
    await propose([{ from: "アサナ", to: "Asana", general: false }]);

    const post = (await read()).transcriptPostProcess;
    expect(post.proposals ?? []).toHaveLength(0);
  });
});

describe("キューが話者の割り当てを渡すこと", () => {
  it("zip を上げていなくても割り当てを渡す", async () => {
    // トラックは文字起こし側が Nextcloud から探してくることもある。
    // 渡さないと話者が「Track 1」のまま公開される
    const { id, storageKey } = await createTestEpisode({
      title: "キュー",
      skipTranscription: false,
    });
    await setEpisodeToTranscribing(storageKey, id);

    const response = await SELF.fetch("http://localhost/api/transcription/queue");
    const body = (await response.json()) as {
      episodes: Array<{ id: string; speakerTracks?: Array<{ track: number }> }>;
    };
    const item = body.episodes.find((e) => e.id === id);

    expect(item?.speakerTracks).toBeDefined();
  });
});

describe("キューが取り直しかどうかを伝えること", () => {
  it("文字起こしが無ければ新規", async () => {
    const { id, storageKey } = await createTestEpisode({
      title: "新規",
      skipTranscription: false,
    });
    await setEpisodeToTranscribing(storageKey, id);

    const body = (await (
      await SELF.fetch("http://localhost/api/transcription/queue")
    ).json()) as { episodes: Array<{ id: string; isRetranscribe?: boolean }> };

    expect(body.episodes.find((e) => e.id === id)?.isRetranscribe).toBe(false);
  });

  it("文字起こしがあれば取り直し", async () => {
    // 取り直しは開発中に何度も走るので、通知の宛先を絞るのに使う
    const { id, storageKey } = await createTestEpisode({
      title: "取り直し",
      skipTranscription: false,
    });
    await setEpisodeToTranscribing(storageKey, id);
    await env.R2_BUCKET.put(
      `episodes/${storageKey}/transcript.raw.json`,
      JSON.stringify({ language: "ja", segments: [{ start: 0, end: 2, text: "本編。" }] })
    );
    await SELF.fetch(`http://localhost/api/episodes/${id}/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcribeStatus: "completed" }),
    });
    await setEpisodeToTranscribing(storageKey, id);

    const body = (await (
      await SELF.fetch("http://localhost/api/transcription/queue")
    ).json()) as { episodes: Array<{ id: string; isRetranscribe?: boolean }> };

    expect(body.episodes.find((e) => e.id === id)?.isRetranscribe).toBe(true);
  });
});
