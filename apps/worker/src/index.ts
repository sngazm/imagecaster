import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, EpisodeMeta } from "./types";
import { episodes } from "./routes/episodes";
import { upload } from "./routes/upload";
import { settings } from "./routes/settings";
import { templates } from "./routes/templates";
import { importRoutes } from "./routes/import";
import { deployments } from "./routes/deployments";
import { podcast } from "./routes/podcast";
import { backup } from "./routes/backup";
import { spotify } from "./routes/spotify";
import { debug } from "./routes/debug";
import { transcriptionQueue, transcriptionEpisodes } from "./routes/transcription";
import { getIndex, saveIndex, findEpisodeBySlug, saveEpisodeMeta, syncPublishedIndex } from "./services/r2";
import { regenerateFeed } from "./services/feed";
import { postEpisodeToBluesky } from "./services/bluesky";
import { triggerWebRebuild } from "./services/deploy";
import { applyPostProcessAndSave } from "./services/transcript-postprocess";

const app = new Hono<{ Bindings: Env }>();

// CORS 設定
// 注: 本番環境では Worker が同一ドメイン (caster.image.club/api/*) にルーティングされるため、
//     同一オリジンのリクエストには CORS ヘッダーは不要。
//     ただし、プレビュー環境やローカル開発ではクロスオリジンになるため CORS 設定を維持。
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4321",
  "https://caster.image.club",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
      // 同一オリジン（Origin ヘッダーなし）の場合は CORS 不要
      if (!origin) return "";
      // 開発環境 or *.pages.dev or image.club ドメインを許可
      if (
        ALLOWED_ORIGINS.includes(origin) ||
        origin.endsWith(".pages.dev") ||
        origin.endsWith(".image.club")
      ) {
        return origin;
      }
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Cf-Access-Jwt-Assertion"],
    credentials: true,
  })
);

// ヘルスチェック（認証不要）
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// API ルート（認証必要）
const api = new Hono<{ Bindings: Env }>();

// 必須環境変数のリスト
const REQUIRED_ENV_VARS = [
  "PODCAST_TITLE",
  "WEBSITE_URL",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_URL",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD",
] as const;

// 環境変数チェックミドルウェア（認証ミドルウェアの前に配置）
api.use("*", async (c, next) => {
  // 開発モードではスキップ
  if (c.env.IS_DEV === "true") {
    await next();
    return;
  }

  const missingVars: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!c.env[varName as keyof Env]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    console.error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
    return c.json(
      {
        error: "Server configuration error",
        message: `Missing required environment variables: ${missingVars.join(", ")}`,
      },
      500
    );
  }

  await next();
});

// Cloudflare Access JWT 認証
api.use("*", async (c, next) => {
  // ローカル開発時は認証スキップ
  if (c.env.IS_DEV === "true") {
    await next();
    return;
  }

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");

  if (!jwt) {
    return c.json({ error: "Unauthorized: Missing Access token" }, 401);
  }

  try {
    const jwksUrl = new URL(
      `https://${c.env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
    );
    const JWKS = createRemoteJWKSet(jwksUrl);

    await jwtVerify(jwt, JWKS, {
      audience: c.env.CF_ACCESS_AUD,
    });
  } catch (err) {
    console.error("JWT verification failed:", err);
    return c.json({ error: "Unauthorized: Invalid token" }, 401);
  }

  await next();
});

// エピソード関連のルートをマウント
api.route("/episodes", episodes);

// アップロード関連のルートをマウント（/api/episodes/:id/upload-* の形式）
api.route("/episodes", upload);

// 設定関連のルートをマウント
api.route("/settings", settings);

// テンプレート関連のルートをマウント
api.route("/templates", templates);

// インポート関連のルートをマウント
api.route("/import", importRoutes);

// デプロイ状況確認のルートをマウント
api.route("/deployments", deployments);

// Podcast 全体管理のルートをマウント
api.route("/podcast", podcast);

// バックアップ（エクスポート/インポート）のルートをマウント
api.route("/backup", backup);

// Spotify 関連のルートをマウント
api.route("/spotify", spotify);

// デバッグ用のルートをマウント
api.route("/debug", debug);

// 文字起こしキュー用のルートをマウント
api.route("/transcription", transcriptionQueue);

// 文字起こしエピソード関連のルートをマウント（/api/episodes/:id/* の形式）
api.route("/episodes", transcriptionEpisodes);

// URLからタイトルを取得（microlink.io API経由）
api.post("/fetch-link-title", async (c) => {
  const body = await c.req.json<{ url: string }>();

  if (!body.url) {
    return c.json({ error: "URL is required" }, 400);
  }

  try {
    // microlink.io API を呼び出し
    const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(body.url)}`;
    const response = await fetch(microlinkUrl);
    const data = await response.json() as { status: string; data?: { title?: string } };

    if (data.status === "success" && data.data?.title) {
      return c.json({ title: data.data.title });
    }

    // フォールバック: 直接HTMLをフェッチしてtitleタグを抽出
    try {
      const pageResponse = await fetch(body.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PodcastBot/1.0)",
        },
      });
      const html = await pageResponse.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch?.[1]) {
        return c.json({ title: titleMatch[1].trim() });
      }
    } catch {
      // 無視
    }

    return c.json({ title: "" });
  } catch (err) {
    console.error("Failed to fetch link title:", err);
    return c.json({ error: "Failed to fetch title" }, 500);
  }
});

// API ルートをマウント
app.route("/api", api);

// 404 ハンドラ
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// エラーハンドラ
app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

/**
 * Cron 処理: 文字起こしの後処理やり直しを少しずつ進める
 *
 * 辞書や統合条件を変えたあと、過去のエピソードへ一括で再適用するために使う。
 * 全件を 1 回のリクエストで回すと Worker のリソース制限（Error 1102）に当たるため、
 * index.json に積んだ対象を Cron が少しずつ消化する。
 */
async function handleTranscriptReprocess(env: Env): Promise<void> {
  const index = await getIndex(env);
  const pending = index.transcriptReprocessIds || [];

  if (pending.length === 0) {
    return;
  }

  const BATCH_SIZE = 10;
  const batch = pending.slice(0, BATCH_SIZE);
  const remaining = pending.slice(BATCH_SIZE);

  console.log(
    `[Transcript Reprocess] ${batch.length} episode(s) this run, ${remaining.length} remaining`
  );

  let processed = 0;

  for (const id of batch) {
    const meta = await findEpisodeBySlug(env, id);
    if (!meta) {
      continue;
    }

    const result = await applyPostProcessAndSave(
      env,
      meta,
      index.podcast.transcriptPostProcess
    );

    if (result) {
      await saveEpisodeMeta(env, meta);
      processed++;
    }
  }

  // 消化中に他の更新が入っている可能性があるので、読み直してから残りを書き戻す
  const current = await getIndex(env);
  current.transcriptReprocessIds = remaining.length > 0 ? remaining : undefined;
  await saveIndex(env, current);

  console.log(`[Transcript Reprocess] Reprocessed ${processed} episode(s)`);

  // すべて終わったら公開サイトを作り直す（文字起こしはビルド時に埋め込まれるため）
  if (remaining.length === 0) {
    await triggerWebRebuild(env);
  }
}

/**
 * Cron 処理: 予約投稿をチェックして公開
 * index.json の scheduledEpisodeIds から対象エピソードのみ取得して公開
 */
async function handleScheduledPublish(env: Env): Promise<void> {
  console.log("[Scheduled Publish] Starting...");
  const now = new Date();

  const index = await getIndex(env);
  const scheduledIds = index.scheduledEpisodeIds || [];
  console.log(`[Scheduled Publish] ${scheduledIds.length} scheduled episode(s)`);

  if (scheduledIds.length === 0) {
    return;
  }

  let updated = false;

  for (const id of scheduledIds) {
    const meta = await findEpisodeBySlug(env, id);
    if (!meta) {
      console.warn(`[Scheduled Publish] Episode not found: ${id}, removing from scheduledEpisodeIds`);
      // 存在しないエピソードはリストから除去
      const currentIndex = await getIndex(env);
      currentIndex.scheduledEpisodeIds = (currentIndex.scheduledEpisodeIds || []).filter((sid) => sid !== id);
      await saveIndex(env, currentIndex);
      continue;
    }

    if (meta.publishStatus !== "scheduled" || !meta.publishAt || new Date(meta.publishAt) > now) {
      continue;
    }

    // 公開処理
    meta.publishStatus = "published";
    meta.publishedAt = now.toISOString();

    // Bluesky に投稿（OGP画像のフォールバックとしてartworkUrlを渡す）
    const posted = await postEpisodeToBluesky(env, meta, env.WEBSITE_URL, index.podcast.artworkUrl);
    if (posted) {
      meta.blueskyPostedAt = now.toISOString();
    }

    await saveEpisodeMeta(env, meta);
    await syncPublishedIndex(env, meta);
    updated = true;

    console.log(`[Scheduled Publish] Published episode: ${meta.id}`);
  }

  if (updated) {
    await regenerateFeed(env);
    console.log("[Scheduled Publish] Feed regenerated");

    // Web サイトのリビルドをトリガー
    await triggerWebRebuild(env);
  }
}

/**
 * feedDirty フラグが立っていれば feed.xml を再生成する
 *
 * フィード再生成は published エピソード全件の meta.json を読むため重く、
 * リクエスト中に実行すると Worker のリソース制限 (Error 1102) に達しうる。
 * 文字起こし完了通知などはフラグを立てるだけにして、実処理をここに集約する。
 */
async function handleDirtyFeed(env: Env): Promise<void> {
  const index = await getIndex(env);

  if (!index.feedDirty) {
    return;
  }

  await regenerateFeed(env);
  await triggerWebRebuild(env);

  // 再生成中に別の更新でフラグが立て直された可能性があるため読み直す
  const current = await getIndex(env);
  current.feedDirty = false;
  await saveIndex(env, current);

  console.log("[Cron] Feed regenerated from feedDirty flag");
}

// Worker エクスポート
export default {
  fetch: app.fetch,

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log("Running scheduled task...");
    try {
      console.log("[Cron] Starting handleScheduledPublish...");
      await handleScheduledPublish(env);
      console.log("[Cron] handleScheduledPublish done");
    } catch (err) {
      console.error("[Cron] Error:", err);
    }
    // 予約公開が失敗してもフィード再生成は独立して試みる
    try {
      await handleDirtyFeed(env);
    } catch (err) {
      console.error("[Cron] Feed regeneration error:", err);
    }
    // 文字起こしの後処理やり直しも独立して試みる
    try {
      await handleTranscriptReprocess(env);
    } catch (err) {
      console.error("[Cron] Transcript reprocess error:", err);
    }
    console.log("[Cron] Scheduled task complete");
  },
};
