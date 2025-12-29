import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, EpisodeMeta } from "./types";
import { podcasts } from "./routes/podcasts";
import { episodes } from "./routes/episodes";
import { upload } from "./routes/upload";
import { settings } from "./routes/settings";
import { secrets } from "./routes/secrets";
import { templates } from "./routes/templates";
import { importRoutes } from "./routes/import";
import { deployments } from "./routes/deployments";
import { getPodcastsIndex, getIndex, getEpisodeMeta, saveEpisodeMeta } from "./services/r2";
import { getFeed, regenerateFeed } from "./services/feed";
import { postEpisodeToBluesky } from "./services/bluesky";
import { triggerWebRebuild } from "./services/deploy";

const app = new Hono<{ Bindings: Env }>();

// CORS 設定
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4321",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".pages.dev")) {
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
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// 公開エンドポイント（認証不要）
const publicRoutes = new Hono<{ Bindings: Env }>();

// RSS フィード
publicRoutes.get("/podcasts/:podcastId/feed.xml", async (c) => {
  const podcastId = c.req.param("podcastId");
  try {
    const feed = await getFeed(c.env, podcastId);
    return c.text(feed, 200, {
      "Content-Type": "application/xml; charset=utf-8",
    });
  } catch {
    return c.json({ error: "Podcast not found" }, 404);
  }
});

app.route("/public", publicRoutes);

// API ルート（認証必要）
const api = new Hono<{ Bindings: Env }>();

// Cloudflare Access JWT 認証
api.use("*", async (c, next) => {
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

// ポッドキャスト一覧・作成
api.route("/podcasts", podcasts);

// 個別ポッドキャスト配下のルート
const podcastRoutes = new Hono<{ Bindings: Env }>();
podcastRoutes.route("/episodes", episodes);
podcastRoutes.route("/episodes", upload); // upload-url, upload-complete 等
podcastRoutes.route("/settings", settings);
podcastRoutes.route("/secrets", secrets);
podcastRoutes.route("/templates", templates);
podcastRoutes.route("/import", importRoutes);
podcastRoutes.route("/deployments", deployments);

api.route("/podcasts/:podcastId", podcastRoutes);

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
 * 説明に文字起こしリンクを追加
 */
function addTranscriptLink(
  description: string,
  transcriptUrl: string | null
): string {
  if (!transcriptUrl) {
    return description;
  }
  return `${description}\n\n📝 文字起こし: ${transcriptUrl}`;
}

/**
 * Cron 処理: 予約投稿をチェックして公開（全ポッドキャスト対象）
 */
async function handleScheduledPublish(env: Env): Promise<void> {
  const now = new Date();
  const podcastsIndex = await getPodcastsIndex(env);

  for (const podcast of podcastsIndex.podcasts) {
    const podcastId = podcast.id;
    const index = await getIndex(env, podcastId);

    let updated = false;

    for (const epRef of index.episodes) {
      let meta: EpisodeMeta;
      try {
        meta = await getEpisodeMeta(env, podcastId, epRef.id);
      } catch {
        continue;
      }

      if (meta.status === "scheduled" && meta.publishAt && new Date(meta.publishAt) <= now) {
        // 公開処理
        meta.status = "published";
        meta.publishedAt = now.toISOString();
        meta.description = addTranscriptLink(meta.description, meta.transcriptUrl);

        // Bluesky に投稿
        const posted = await postEpisodeToBluesky(env, podcastId, meta, index.podcast.websiteUrl);
        if (posted) {
          meta.blueskyPostedAt = now.toISOString();
        }

        await saveEpisodeMeta(env, podcastId, meta);
        updated = true;

        console.log(`Published episode: ${podcastId}/${meta.id}`);
      }
    }

    if (updated) {
      await regenerateFeed(env, podcastId);
      console.log(`Feed regenerated for podcast: ${podcastId}`);

      // Web サイトのリビルドをトリガー
      await triggerWebRebuild(env, podcastId);
    }
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
