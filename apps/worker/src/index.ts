import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import type { Env, EpisodeMeta } from "./types";
import { episodes } from "./routes/episodes";
import { getIndex, getEpisodeMeta, saveEpisodeMeta } from "./services/r2";
import { getFeed, regenerateFeed } from "./services/feed";

const app = new Hono<{ Bindings: Env }>();

// CORS 設定
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
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

// Bearer Token 認証
api.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  // ADMIN_API_KEY または TRANSCRIBER_API_KEY で認証
  if (
    token !== c.env.ADMIN_API_KEY &&
    token !== c.env.TRANSCRIBER_API_KEY
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

// エピソード関連のルートをマウント
api.route("/episodes", episodes);

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

    if (meta.status === "scheduled" && new Date(meta.publishAt) <= now) {
      // 公開処理
      meta.status = "published";
      meta.publishedAt = now.toISOString();
      meta.description = addTranscriptLink(meta.description, meta.transcriptUrl);

      await saveEpisodeMeta(env, meta);
      updated = true;

      console.log(`Published episode: ${meta.id}`);
    }
  }

  if (updated) {
    await regenerateFeed(env);
    console.log("Feed regenerated");
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
