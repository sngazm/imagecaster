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
 *
 * Workers の subrequest 上限（1000回）を超えないよう、バッチ処理で実行。
 * body.limit でバッチサイズを指定可能（デフォルト5、最大10）。
 * migrated > 0 の場合は再度呼び出すこと。migrated === 0 になったら完了。
 */
debug.post("/migrate-storage-keys", async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({}));
  const batchSize = Math.min(body.limit || 5, 10);

  // Step 1: ディレクトリ名だけを取得（R2.list のみ、meta.json 読み込みなし）
  const allDirs: string[] = [];
  let listCursor: string | undefined;
  do {
    const listed = await c.env.R2_BUCKET.list({
      prefix: "episodes/",
      delimiter: "/",
      cursor: listCursor,
    });
    for (const prefix of listed.delimitedPrefixes) {
      const sk = prefix.replace("episodes/", "").replace(/\/$/, "");
      if (sk) allDirs.push(sk);
    }
    listCursor = listed.truncated ? listed.cursor : undefined;
  } while (listCursor);

  // Step 2: 各ディレクトリの meta.json を読み、移行が必要なものを batchSize 件まで処理
  const migrated: Array<{ id: string; oldStorageKey: string; newStorageKey: string }> = [];
  const errors: Array<{ id: string; reason: string }> = [];
  let alreadyMigrated = 0;

  for (const storageKey of allDirs) {
    if (migrated.length >= batchSize) break;

    const metaObj = await c.env.R2_BUCKET.get(`episodes/${storageKey}/meta.json`);
    if (!metaObj) continue;

    const meta = JSON.parse(await metaObj.text());
    const slug = meta.slug || meta.id;

    // storageKey が既に slug と異なれば移行済み
    if (meta.storageKey && meta.storageKey !== slug) {
      alreadyMigrated++;
      continue;
    }

    // 移行実行
    const newStorageKey = generateStorageKey(slug);

    try {
      await moveEpisode(c.env, storageKey, newStorageKey);

      meta.storageKey = newStorageKey;

      if (meta.audioUrl && meta.audioUrl.includes(`/episodes/${storageKey}/`)) {
        meta.audioUrl = meta.audioUrl.replace(`/episodes/${storageKey}/`, `/episodes/${newStorageKey}/`);
      }
      if (meta.transcriptUrl && meta.transcriptUrl.includes(`/episodes/${storageKey}/`)) {
        meta.transcriptUrl = meta.transcriptUrl.replace(`/episodes/${storageKey}/`, `/episodes/${newStorageKey}/`);
      }
      if (meta.artworkUrl && meta.artworkUrl.includes(`/episodes/${storageKey}/`)) {
        meta.artworkUrl = meta.artworkUrl.replace(`/episodes/${storageKey}/`, `/episodes/${newStorageKey}/`);
      }

      await saveEpisodeMeta(c.env, meta);

      migrated.push({
        id: meta.id,
        oldStorageKey: storageKey,
        newStorageKey,
      });
    } catch (err) {
      errors.push({ id: meta.id, reason: `${err}` });
    }
  }

  // Step 3: 全件移行済みなら index.json とフィードを再構築
  const done = migrated.length === 0 && errors.length === 0;

  if (done) {
    const index = await getIndex(c.env);
    index.episodes = [];

    const updatedEpisodes = await listAllEpisodes(c.env);
    for (const ep of updatedEpisodes) {
      if (ep.publishStatus === "published") {
        index.episodes.push({ id: ep.id, storageKey: ep.storageKey });
      }
    }

    await saveIndex(c.env, index);
    await regenerateFeed(c.env);
  }

  return c.json({
    success: true,
    done,
    migrated: migrated.length,
    alreadyMigrated,
    totalDirs: allDirs.length,
    errors: errors.length,
    details: { migrated, errors },
    message: done
      ? "全エピソードの移行が完了しました。index.json と feed.xml を再構築しました。"
      : `${migrated.length}件を移行しました。再度実行してください。`,
  });
});
