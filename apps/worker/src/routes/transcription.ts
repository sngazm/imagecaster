import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type {
  Env,
  TranscriptionQueueResponse,
  TranscriptionQueueItem,
  UploadUrlResponse,
} from "../types";
import {
  getIndex,
  getEpisodeMeta,
  saveEpisodeMeta,
  syncEpisodeStatusToIndex,
} from "../services/r2";

/**
 * ソフトロックのタイムアウト時間（1時間）
 */
const LOCK_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * ロックが有効かどうかを判定
 */
function isLockValid(lockedAt: string | null | undefined): boolean {
  if (!lockedAt) {
    return false;
  }
  const lockTime = new Date(lockedAt).getTime();
  const now = Date.now();
  return now - lockTime < LOCK_TIMEOUT_MS;
}

/**
 * 文字起こしキュー用ルート（/api/transcription/* にマウント）
 */
const transcriptionQueue = new Hono<{ Bindings: Env }>();

/**
 * GET /api/transcription/queue - 文字起こし待ちエピソードを取得（ソフトロック付き）
 *
 * クエリパラメータ:
 * - limit: 取得件数（デフォルト: 1、最大: 10）
 */
transcriptionQueue.get("/queue", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "1", 10) || 1, 1), 10);

  const index = await getIndex(c.env);
  const now = new Date().toISOString();
  const queueItems: TranscriptionQueueItem[] = [];

  // index.json のステータスで事前フィルタリング（高速化）
  const transcribingRefs = index.episodes.filter(
    (ref) => ref.status === "transcribing"
  );

  for (const ref of transcribingRefs) {
    if (queueItems.length >= limit) {
      break;
    }

    try {
      const meta = await getEpisodeMeta(c.env, ref.id);

      // ロックが無効なエピソードのみ取得
      if (meta.status === "transcribing" && !isLockValid(meta.transcriptionLockedAt)) {
        // ソフトロックを取得
        meta.transcriptionLockedAt = now;
        await saveEpisodeMeta(c.env, meta);

        queueItems.push({
          id: meta.id,
          slug: meta.slug,
          title: meta.title,
          audioUrl: meta.audioUrl,
          duration: meta.duration,
          lockedAt: now,
        });
      }
    } catch {
      // エピソードが見つからない場合はスキップ
      continue;
    }
  }

  const response: TranscriptionQueueResponse = {
    episodes: queueItems,
  };

  return c.json(response);
});

/**
 * エピソード文字起こし関連ルート（/api/episodes/* にマウント）
 */
const transcriptionEpisodes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/episodes/:id/audio-url - 音声ファイルダウンロード用Presigned URL発行
 */
transcriptionEpisodes.get("/:id/audio-url", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await getEpisodeMeta(c.env, id);

    // 音声ファイルが存在するか確認
    if (!meta.audioUrl) {
      return c.json({ error: "Audio file not available" }, 400);
    }

    // Presigned URL 生成
    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `episodes/${meta.id}/audio.mp3`;
    const url = new URL(
      `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`
    );
    url.searchParams.set("X-Amz-Expires", "3600");

    const signed = await r2.sign(
      new Request(url, {
        method: "GET",
      }),
      { aws: { signQuery: true } }
    );

    return c.json({
      downloadUrl: signed.url,
      expiresIn: 3600,
    });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/transcript/upload-url - 文字起こしJSONアップロード用Presigned URL発行
 */
transcriptionEpisodes.post("/:id/transcript/upload-url", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await getEpisodeMeta(c.env, id);

    // transcribing 状態のみ許可
    if (meta.status !== "transcribing") {
      return c.json({ error: "Episode is not in transcribing status" }, 400);
    }

    // Presigned URL 生成
    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `episodes/${meta.id}/transcript.json`;
    const url = new URL(
      `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`
    );
    url.searchParams.set("X-Amz-Expires", "3600");

    const signed = await r2.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
      { aws: { signQuery: true } }
    );

    const response: UploadUrlResponse = {
      uploadUrl: signed.url,
      expiresIn: 3600,
    };

    return c.json(response);
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * DELETE /api/episodes/:id/transcription-lock - 文字起こしロックを解除
 *
 * 処理失敗時にロックを手動解除するためのエンドポイント
 */
transcriptionEpisodes.delete("/:id/transcription-lock", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await getEpisodeMeta(c.env, id);

    // ロックを解除
    meta.transcriptionLockedAt = null;
    await saveEpisodeMeta(c.env, meta);

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { transcriptionQueue, transcriptionEpisodes };
