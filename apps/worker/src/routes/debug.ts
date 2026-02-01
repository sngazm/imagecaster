import { Hono } from "hono";
import type { Env } from "../types";
import {
  listAllEpisodes,
  saveEpisodeMeta,
  getIndex,
  saveIndex,
  generateStorageKey,
  moveEpisode,
} from "../services/r2";
import { regenerateFeed } from "../services/feed";

export const debug = new Hono<{ Bindings: Env }>();

// シークレットとしてマスクする環境変数
const SECRET_VARS = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "BLUESKY_PASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "SPOTIFY_CLIENT_SECRET",
] as const;

// すべての環境変数キー（チェック対象）
const ALL_ENV_VARS = [
  // 必須
  "PODCAST_TITLE",
  "WEBSITE_URL",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_URL",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD",
  // オプション
  "IS_DEV",
  "WEB_DEPLOY_HOOK_URL",
  "BLUESKY_IDENTIFIER",
  "BLUESKY_PASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "PAGES_PROJECT_NAME",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
] as const;

/**
 * 値をマスクする（シークレット用）
 */
function maskValue(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 4) return "***";
  return value.slice(0, 2) + "***" + value.slice(-2);
}

/**
 * GET /api/debug/env - 環境変数一覧を取得
 */
debug.get("/env", (c) => {
  const env = c.env;
  const result: Record<
    string,
    {
      value: string;
      isSet: boolean;
      isSecret: boolean;
    }
  > = {};

  for (const varName of ALL_ENV_VARS) {
    const rawValue = env[varName as keyof Env] as string | undefined;
    const isSecret = SECRET_VARS.includes(varName as (typeof SECRET_VARS)[number]);
    const isSet = rawValue !== undefined && rawValue !== "";

    result[varName] = {
      value: isSecret ? maskValue(rawValue) : (rawValue || "(not set)"),
      isSet,
      isSecret,
    };
  }

  // R2バケットバインディングのチェック
  const r2BucketBound = !!env.R2_BUCKET;

  return c.json({
    timestamp: new Date().toISOString(),
    environment: env.IS_DEV === "true" ? "development" : "production",
    r2BucketBound,
    variables: result,
  });
});

/**
 * POST /api/debug/migrate-storage-keys - storageKey マイグレーション
 *
 * 旧形式（R2パス = episodes/{slug}/...）から新形式（episodes/{slug}-{random}/...）に移行
 * storageKey が slug と同一のエピソードを検出し、新しい storageKey でファイルを移動
 */
debug.post("/migrate-storage-keys", async (c) => {
  const allEpisodes = await listAllEpisodes(c.env);
  const migrated: Array<{ id: string; oldStorageKey: string; newStorageKey: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const meta of allEpisodes) {
    const slug = meta.slug || meta.id;

    // storageKey が既に slug-{random} 形式なら移行不要
    // 条件: storageKey が slug と完全一致、または storageKey が存在しない
    if (meta.storageKey && meta.storageKey !== slug) {
      // 既に storageKey が異なる（移行済み）
      skipped.push({ id: meta.id, reason: "Already migrated" });
      continue;
    }

    // 新しい storageKey を生成
    const newStorageKey = generateStorageKey(slug);

    try {
      // ファイルを移動
      await moveEpisode(c.env, slug, newStorageKey);

      // メタデータを更新
      meta.storageKey = newStorageKey;

      // audioUrl と transcriptUrl のパスも更新
      if (meta.audioUrl && meta.audioUrl.includes(`/episodes/${slug}/`)) {
        meta.audioUrl = meta.audioUrl.replace(`/episodes/${slug}/`, `/episodes/${newStorageKey}/`);
      }
      if (meta.transcriptUrl && meta.transcriptUrl.includes(`/episodes/${slug}/`)) {
        meta.transcriptUrl = meta.transcriptUrl.replace(`/episodes/${slug}/`, `/episodes/${newStorageKey}/`);
      }
      if (meta.artworkUrl && meta.artworkUrl.includes(`/episodes/${slug}/`)) {
        meta.artworkUrl = meta.artworkUrl.replace(`/episodes/${slug}/`, `/episodes/${newStorageKey}/`);
      }

      await saveEpisodeMeta(c.env, meta);

      migrated.push({
        id: meta.id,
        oldStorageKey: slug,
        newStorageKey,
      });
    } catch (err) {
      skipped.push({ id: meta.id, reason: `Error: ${err}` });
    }
  }

  // index.json を再構築（published エピソードのみ、新しい storageKey で）
  const index = await getIndex(c.env);
  index.episodes = [];

  // 移行後の全エピソードを再取得して index.json を再構築
  const updatedEpisodes = await listAllEpisodes(c.env);
  for (const ep of updatedEpisodes) {
    if (ep.publishStatus === "published") {
      index.episodes.push({ id: ep.id, storageKey: ep.storageKey });
    }
  }

  await saveIndex(c.env, index);

  // フィードを再生成
  await regenerateFeed(c.env);

  return c.json({
    success: true,
    migrated: migrated.length,
    skipped: skipped.length,
    details: { migrated, skipped },
  });
});
