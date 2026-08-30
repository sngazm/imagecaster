import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import type {
  Env,
  EpisodeMeta,
  TranscriptionQueueResponse,
  TranscriptionQueueItem,
  UploadUrlResponse,
  TranscriptData,
} from "../types";
import {
  listAllEpisodes,
  findEpisodeBySlug,
  saveEpisodeMeta,
  getIndex,
  saveIndex,
  createPresignedUrl,
  syncPublishedIndex,
} from "../services/r2";
import {
  applyPostProcessAndSave,
  resolveSpeakerTracks,
  transcriptKeys,
} from "../services/transcript-postprocess";
import { triggerWebRebuild } from "../services/deploy";
import { reviewWithLlm } from "../services/transcript-llm";
import { DEFAULT_POST_PROCESS_SETTINGS } from "../services/transcript-postprocess";
import { generateImpression } from "../services/episode-impression";
import { convertToVtt } from "../services/vtt";
import { tracksKey } from "./upload";

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
 * キュー候補のエピソードを取得する
 *
 * 全エピソードの meta.json を読むと Worker のリソース制限 (Error 1102) に達する
 * ため、index.json の transcriptionQueueIds に載っているものだけを読む。
 * インデックスが未構築の場合に限り全件走査し、その結果でインデックスを初期化する。
 */
async function getQueueCandidates(env: Env): Promise<EpisodeMeta[]> {
  const index = await getIndex(env);

  if (index.transcriptionQueueIds !== undefined) {
    const found = await Promise.all(
      index.transcriptionQueueIds.map((id) => findEpisodeBySlug(env, id))
    );
    return found.filter((meta): meta is EpisodeMeta => meta !== null);
  }

  // 未構築: 一度だけ全件走査してインデックスを作る
  const allEpisodes = await listAllEpisodes(env);
  const queued = allEpisodes.filter(
    (meta) =>
      meta.transcribeStatus === "pending" || meta.transcribeStatus === "transcribing"
  );

  const current = await getIndex(env);
  current.transcriptionQueueIds = queued.map((meta) => meta.id);
  await saveIndex(env, current);

  console.log(
    `[transcription-queue] Built transcriptionQueueIds from a full scan: ` +
      `${queued.length} episode(s) waiting`
  );

  return queued;
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

  const candidates = await getQueueCandidates(c.env);
  const queueItems: TranscriptionQueueItem[] = [];
  const index = await getIndex(c.env);
  const settings = index.podcast.transcriptPostProcess;

  for (const meta of candidates) {
    if (queueItems.length >= limit) {
      break;
    }

    // pending または transcribing でロックが無効なエピソードのみ取得
    const isPendingOrTranscribing = meta.transcribeStatus === "pending" || meta.transcribeStatus === "transcribing";
    if (isPendingOrTranscribing && !isLockValid(meta.transcriptionLockedAt)) {
      const item: TranscriptionQueueItem = {
        id: meta.id,
        slug: meta.slug,
        title: meta.title,
        audioUrl: meta.audioUrl,
        sourceAudioUrl: meta.sourceAudioUrl,
        duration: meta.duration,
        lockedAt: meta.transcriptionLockedAt || "",
        // 冒頭の要約を initial_prompt に足すのに使う。その回で出てくる語を
        // 渡しておくと固有名詞の精度が上がる
        description: meta.description || "",
        // すでに文字起こしがあるなら取り直し。通知の宛先を絞るのに使う
        isRetranscribe: Boolean(meta.transcriptUrl),
      };

      // 話者の割り当ては常に渡す。
      //
      // トラックの zip は管理画面から上げるほかに、文字起こし側が Nextcloud から
      // 探してくる経路もある。tracksUploadedAt があるときだけ渡していたため、
      // 自動で見つけた回の話者が「Track 1」のまま公開されていた。
      item.speakerTracks = resolveSpeakerTracks(meta.speakerTracks, settings);
      item.simultaneousUntilSec = settings?.simultaneousUntilSec ?? null;

      // 管理画面から上げた zip があれば、その URL も渡す
      if (meta.tracksUploadedAt) {
        const signed = await createPresignedUrl(c.env, tracksKey(meta.storageKey), {
          method: "GET",
        });
        item.tracksZipUrl = signed.url;
      }

      queueItems.push(item);
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
 * GET /api/episodes/:id/tracks-url - 話者トラック zip のダウンロード URL 発行
 *
 * 文字起こしワーカーがキュー経由以外で取りに来る場合（欠落箇所の調査など）に使う。
 */
transcriptionEpisodes.get("/:id/tracks-url", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    if (!meta.tracksUploadedAt) {
      return c.json({ error: "話者トラックがアップロードされていません" }, 400);
    }

    const signed = await createPresignedUrl(c.env, tracksKey(meta.storageKey), {
      method: "GET",
    });

    return c.json({ downloadUrl: signed.url, expiresIn: signed.expiresIn });
  } catch (err) {
    console.error(`[tracks-url] Error for episode ${id}:`, err);
    return c.json({ error: "Episode not found" }, 404);
  }
});

/**
 * POST /api/episodes/:id/transcript/upload-url - 文字起こし生データのアップロード用Presigned URL発行
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

    // Whisper の生出力として保存する。統合や誤字修正はこれを入力に Worker 側で行い、
    // 公開用の transcript.json / transcript.vtt を別に書き出す。
    const signed = await createPresignedUrl(
      c.env,
      transcriptKeys(meta.storageKey).raw,
      { method: "PUT", contentType: "application/json" }
    );

    const response: UploadUrlResponse = {
      uploadUrl: signed.url,
      expiresIn: signed.expiresIn,
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

/**
 * POST /api/episodes/:id/transcript/reprocess - 後処理をやり直す
 *
 * Whisper の生出力から統合と誤字修正をかけ直す。文字起こし自体は再実行しないので、
 * 辞書や統合条件を変えたときに即座に反映できる。
 */
transcriptionEpisodes.post("/:id/transcript/reprocess", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    const index = await getIndex(c.env);
    const result = await applyPostProcessAndSave(
      c.env,
      meta,
      index.podcast.transcriptPostProcess
    );

    if (!result) {
      return c.json({ error: "No transcript available to reprocess" }, 400);
    }

    await saveEpisodeMeta(c.env, meta);

    // 公開済みなら公開サイトの文字起こしも作り直す
    if (meta.publishStatus === "published") {
      await triggerWebRebuild(c.env);
    }

    return c.json({
      success: true,
      segments: result.segments,
      applied: result.applied,
    });
  } catch (err) {
    console.error(`[transcript/reprocess] Error for episode ${id}:`, err);
    return c.json({ error: "Failed to reprocess transcript" }, 500);
  }
});

/**
 * POST /api/episodes/:id/transcript/corrections - 校正で見つかった修正を登録する
 *
 * 文字起こしを回すマシンが、ローカルの claude に校正させた結果を送ってくる。
 * 本文をそのまま書き換えるのではなく**置換規則**として受け取り、番組全体に効くもの
 * （`general`）は**提案として溜め**、この回かぎりのものはエピソードに保存する。
 * 辞書には自動で入れない。人が管理画面で承認したものだけが効く。
 *
 * こうしておくと、後処理をやり直しても修正が残る。辞書は次回以降の文字起こしにも
 * 自動で効くので、同じ誤りを毎回直さずに済む。
 */
transcriptionEpisodes.post("/:id/transcript/corrections", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    const body = await c.req.json<{
      corrections?: Array<{
        from?: unknown;
        to?: unknown;
        note?: unknown;
        general?: unknown;
        occurrences?: unknown;
      }>;
    }>();

    const incoming = Array.isArray(body.corrections) ? body.corrections : [];

    const rules = incoming
      .filter(
        (r): r is {
          from: string;
          to: string;
          note?: string;
          general?: boolean;
          occurrences?: number;
        } =>
          typeof r.from === "string" &&
          typeof r.to === "string" &&
          r.from.trim() !== "" &&
          r.to.trim() !== "" &&
          r.from !== r.to
      )
      .map((r) => ({
        from: r.from.trim(),
        to: r.to.trim(),
        note: typeof r.note === "string" ? r.note : undefined,
        general: r.general === true,
        occurrences: typeof r.occurrences === "number" ? r.occurrences : 0,
      }));

    const index = await getIndex(c.env);
    const settings =
      index.podcast.transcriptPostProcess ?? DEFAULT_POST_PROCESS_SETTINGS;

    // 番組全体に効きそうなものは**提案として溜める**。自動では辞書に入れない。
    //
    // 辞書は公開済みの全エピソードに効くので、機械の判断で足すと文章を壊す。
    // 実際に `メール → mail` と `短期 → 短気` が入り、「メールフォーム」と
    // 「短期的には」まで置き換わった。人が見て承認したものだけを入れる。
    const known = new Set(settings.corrections.map((r) => `${r.from}\u0000${r.to}`));
    const proposals = [...(settings.proposals ?? [])];
    const proposed = new Set(proposals.map((p) => `${p.from}\u0000${p.to}`));
    let added = 0;

    for (const rule of rules.filter((r) => r.general)) {
      const key = `${rule.from}\u0000${rule.to}`;
      if (known.has(key) || proposed.has(key)) continue;

      proposed.add(key);
      proposals.push({
        from: rule.from,
        to: rule.to,
        note: rule.note,
        episodeId: meta.id,
        occurrences: rule.occurrences ?? 0,
        proposedAt: new Date().toISOString(),
      });
      added += 1;
    }

    if (added > 0) {
      index.podcast.transcriptPostProcess = { ...settings, proposals };
      await saveIndex(c.env, index);
    }

    // この回かぎりの修正
    const episodeRules = rules
      .filter((r) => !r.general)
      .map((r) => ({
        from: r.from,
        to: r.to,
        enabled: true,
        note: r.note,
      }));

    // 既にある規則は残す。校正を回すたびに入れ替わると、手で足したものや
    // 前回の校正が見つけたものが消える
    const existing = meta.transcriptCorrections ?? [];
    const seen = new Set(existing.map((r) => `${r.from}\u0000${r.to}`));
    const merged = [...existing];

    for (const rule of episodeRules) {
      const key = `${rule.from}\u0000${rule.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(rule);
    }

    meta.transcriptCorrections = merged.length > 0 ? merged : null;

    const result = await applyPostProcessAndSave(
      c.env,
      meta,
      index.podcast.transcriptPostProcess
    );

    await saveEpisodeMeta(c.env, meta);

    if (meta.publishStatus === "published") {
      await triggerWebRebuild(c.env);
    }

    return c.json({
      success: true,
      proposed: added,
      episodeRules: merged.length,
      segments: result?.segments ?? 0,
    });
  } catch (err) {
    console.error(`[transcript/corrections] Error for episode ${id}:`, err);
    return c.json({ error: "Failed to register corrections" }, 500);
  }
});

/**
 * POST /api/transcription/reprocess-all - 全エピソードの後処理をやり直す
 *
 * 辞書を育てたときに過去のエピソードへ一括で反映するために使う。エピソード数が
 * 多いとリソース制限に当たるため、対象を index.json に積んで Cron に少しずつ
 * 処理させる（予約公開やフィード再生成と同じやり方）。
 */
transcriptionQueue.post("/reprocess-all", async (c) => {
  const index = await getIndex(c.env);

  // 対象は公開済みエピソード（index.json に載っているもの）。公開サイトに出ている
  // 文字起こしを作り直すのが目的で、未公開のものは公開前に個別に再処理すればよい。
  // 全件を走査すると Worker のリソース制限に当たるため、ここでは index だけを見る。
  const targets = index.episodes.map((ep) => ep.id);

  index.transcriptReprocessIds = targets;
  await saveIndex(c.env, index);

  return c.json({ success: true, queued: targets.length });
});

/**
 * POST /api/episodes/:id/transcript/review - LLM に校正させる
 *
 * 辞書では拾えない、文脈を読まないと判断できない誤りを直す。提案の一覧を返すので、
 * 何がどう変わったかを後から確認できる。
 */
transcriptionEpisodes.post("/:id/transcript/review", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 400);
    }

    const keys = transcriptKeys(meta.storageKey);
    const obj = await c.env.R2_BUCKET.get(keys.json);
    if (!obj) {
      return c.json({ error: "No transcript available to review" }, 400);
    }

    const data = JSON.parse(await obj.text()) as TranscriptData;

    // 番組で使う固有名詞を辞書から渡し、判断の助けにする
    const index = await getIndex(c.env);
    const settings = index.podcast.transcriptPostProcess;
    const vocabulary = (settings?.corrections ?? [])
      .filter((rule) => rule.enabled)
      .map((rule) => `- ${rule.to}`)
      .join("\n");

    const result = await reviewWithLlm(c.env, data.segments, {
      episodeTitle: meta.title,
      vocabulary,
    });

    const reviewed: TranscriptData = { ...data, segments: result.segments };

    await c.env.R2_BUCKET.put(keys.json, JSON.stringify(reviewed), {
      httpMetadata: { contentType: "application/json" },
    });
    await c.env.R2_BUCKET.put(keys.vtt, convertToVtt(reviewed), {
      httpMetadata: { contentType: "text/vtt" },
    });

    if (meta.publishStatus === "published") {
      await triggerWebRebuild(c.env);
    }

    return c.json({
      success: true,
      corrections: result.corrections,
      rejected: result.rejected,
    });
  } catch (err) {
    console.error(`[transcript/review] Error for episode ${id}:`, err);
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to review transcript" },
      500
    );
  }
});

/**
 * PUT /api/episodes/:id/impression - 生成済みの感想を受け取る
 *
 * 感想の生成は文字起こしを回すマシンで行う。そちらには Claude Code が入っていて
 * 認証も済んでいるので、Worker 側に API キーを置かなくて済む。
 */
transcriptionEpisodes.put("/:id/impression", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ impression?: string }>();

  const impression = (body.impression ?? "").trim();
  if (impression === "") {
    return c.json({ error: "impression が空です" }, 400);
  }

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    meta.claudeImpression = impression;
    meta.claudeImpressionAt = new Date().toISOString();
    await saveEpisodeMeta(c.env, meta);

    if (meta.publishStatus === "published") {
      await syncPublishedIndex(c.env, meta);
      await triggerWebRebuild(c.env);
    }

    return c.json({ success: true, length: impression.length });
  } catch (err) {
    console.error(`[impression] Save error for episode ${id}:`, err);
    return c.json({ error: "感想の保存に失敗しました" }, 500);
  }
});

/**
 * POST /api/episodes/:id/impression - Claude の感想を生成する
 *
 * Worker 側で生成する経路。ANTHROPIC_API_KEY が要る。文字起こしマシンから
 * PUT で送る経路（上）があれば、こちらは使わなくてよい。
 */
transcriptionEpisodes.post("/:id/impression", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 400);
    }

    const obj = await c.env.R2_BUCKET.get(transcriptKeys(meta.storageKey).json);
    if (!obj) {
      return c.json({ error: "文字起こしがありません" }, 400);
    }

    const transcript = JSON.parse(await obj.text()) as TranscriptData;
    const impression = await generateImpression(c.env, transcript, meta.title);

    meta.claudeImpression = impression;
    meta.claudeImpressionAt = new Date().toISOString();
    await saveEpisodeMeta(c.env, meta);

    if (meta.publishStatus === "published") {
      await syncPublishedIndex(c.env, meta);
      await triggerWebRebuild(c.env);
    }

    return c.json({ success: true, impression });
  } catch (err) {
    console.error(`[impression] Error for episode ${id}:`, err);
    return c.json(
      { error: err instanceof Error ? err.message : "感想の生成に失敗しました" },
      500
    );
  }
});

/**
 * DELETE /api/episodes/:id/impression - 感想を消す
 */
transcriptionEpisodes.delete("/:id/impression", async (c) => {
  const id = c.req.param("id");

  try {
    const meta = await findEpisodeBySlug(c.env, id);
    if (!meta) {
      return c.json({ error: "Episode not found" }, 404);
    }

    meta.claudeImpression = null;
    meta.claudeImpressionAt = null;
    await saveEpisodeMeta(c.env, meta);

    if (meta.publishStatus === "published") {
      await syncPublishedIndex(c.env, meta);
      await triggerWebRebuild(c.env);
    }

    return c.json({ success: true });
  } catch (err) {
    console.error(`[impression] Delete error for episode ${id}:`, err);
    return c.json({ error: "削除に失敗しました" }, 500);
  }
});

export { transcriptionQueue, transcriptionEpisodes };
