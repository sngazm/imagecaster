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
import { getIndex, getEpisodeMeta, saveEpisodeMeta } from "./services/r2";
import { getFeed, regenerateFeed } from "./services/feed";
import { postEpisodeToBluesky } from "./services/bluesky";
import { triggerWebRebuild } from "./services/deploy";

const app = new Hono<{ Bindings: Env }>();

// CORS 設定
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4321",
  "https://caster.image.club",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
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

// RSS フィード（認証不要）
app.get("/feed.xml", async (c) => {
  const feed = await getFeed(c.env);
  return c.text(feed, 200, {
    "Content-Type": "application/xml; charset=utf-8",
  });
});

// ヘルスチェック（認証不要）
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// API ルート（認証必要）
const api = new Hono<{ Bindings: Env }>();

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
 * Cron 処理: 予約投稿をチェックして公開
 */
async function handleScheduledPublish(env: Env): Promise<void> {
  const now = new Date();
  const index = await getIndex(env);

  let updated = false;

  for (const epRef of index.episodes) {
    let meta: EpisodeMeta;
    try {
      meta = await getEpisodeMeta(env, epRef.id);
    } catch {
      continue;
    }

    if (meta.status === "scheduled" && meta.publishAt && new Date(meta.publishAt) <= now) {
      // 公開処理
      meta.status = "published";
      meta.publishedAt = now.toISOString();

      // Bluesky に投稿
      const posted = await postEpisodeToBluesky(env, meta, env.WEBSITE_URL);
      if (posted) {
        meta.blueskyPostedAt = now.toISOString();
      }

      await saveEpisodeMeta(env, meta);
      updated = true;

      console.log(`Published episode: ${meta.id}`);
    }
  }

  if (updated) {
    await regenerateFeed(env);
    console.log("Feed regenerated");

    // Web サイトのリビルドをトリガー
    await triggerWebRebuild(env);
  }
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
    await handleScheduledPublish(env);
  },
};
