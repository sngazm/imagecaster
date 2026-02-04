import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type {
  Env,
  TranscriptionQueueResponse,
  TranscriptionQueueItem,
  UploadUrlResponse,
} from "../types";
import {
  listAllEpisodes,
  findEpisodeBySlug,
  saveEpisodeMeta,
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
 * GET /api/transcription/queue - 文字起こし待ちエピソードを取得（読み取り専用）
 *
 * クエリパラメータ:
 * - limit: 取得件数（デフォルト: 1、最大: 10）
 */
transcriptionQueue.get("/queue", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "1", 10) || 1, 1), 10);

  // R2.list() で全エピソードを取得してフィルタリング
  const allEpisodes = await listAllEpisodes(c.env);
  const queueItems: TranscriptionQueueItem[] = [];

  for (const meta of allEpisodes) {
    if (queueItems.length >= limit) {
      break;
    }

    // pending または transcribing でロックが無効なエピソードのみ取得
    const isPendingOrTranscribing = meta.transcribeStatus === "pending" || meta.transcribeStatus === "transcribing";
    if (isPendingOrTranscribing && !isLockValid(meta.transcriptionLockedAt)) {
      queueItems.push({
        id: meta.id,
        slug: meta.slug,
        title: meta.title,
        audioUrl: meta.audioUrl,
        sourceAudioUrl: meta.sourceAudioUrl,
        duration: meta.duration,
        lockedAt: meta.transcriptionLockedAt || "",
        speakerTracksUrl: meta.speakerTracksUrl || null,
        speakerTracks: meta.speakerTracks || [],
      });
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
 * GET /api/episodes/:id/audio-url - 音声ファイルダウンロード用URL発行
 *
 * R2にファイルがある場合はPresigned URL、外部参照の場合はsourceAudioUrlを返す
 */
transcriptionEpisodes.get("/:id/audio-url", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    // R2に音声ファイルがある場合はPresigned URLを発行
    if (meta.audioUrl) {
      const r2 = new AwsClient({
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      });

      const key = `episodes/${meta.storageKey}/audio.mp3`;
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
        source: "r2",
      });
    }

    // 外部参照の音声URLがある場合はそのまま返す
    if (meta.sourceAudioUrl) {
      return c.json({
        downloadUrl: meta.sourceAudioUrl,
        expiresIn: null,
        source: "external",
      });
    }

    // どちらもない場合はエラー
    return c.json({ error: "Audio file not available" }, 400);
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
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    // pending または transcribing 状態のみ許可
    if (meta.transcribeStatus !== "pending" && meta.transcribeStatus !== "transcribing") {
      return c.json({ error: "Episode is not in pending or transcribing status" }, 400);
    }

    // Presigned URL 生成
    const r2 = new AwsClient({
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    });

    const key = `episodes/${meta.storageKey}/transcript.json`;
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
 * POST /api/episodes/:id/transcription-lock - 文字起こしロックを取得
 *
 * エピソードの処理を開始する前にロックを取得する
 */
transcriptionEpisodes.post("/:id/transcription-lock", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    // pending または transcribing 状態のみ許可
    if (meta.transcribeStatus !== "pending" && meta.transcribeStatus !== "transcribing") {
      return c.json({ error: "Episode is not in pending or transcribing status" }, 400);
    }

    // 既にロック済みの場合はエラー
    if (isLockValid(meta.transcriptionLockedAt)) {
      return c.json({ error: "Episode is already locked" }, 409);
    }

    // ロックを取得し、transcribeStatus を transcribing に更新
    const now = new Date().toISOString();
    meta.transcriptionLockedAt = now;
    meta.transcribeStatus = "transcribing";
    await saveEpisodeMeta(c.env, meta);

    return c.json({
      success: true,
      lockedAt: now,
      episode: {
        id: meta.id,
        slug: meta.slug,
        title: meta.title,
        audioUrl: meta.audioUrl,
        duration: meta.duration,
      },
    });
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
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    // ロックを解除
    meta.transcriptionLockedAt = null;
    await saveEpisodeMeta(c.env, meta);

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Episode not found" }, 404);
  }
});

export { transcriptionQueue, transcriptionEpisodes };
