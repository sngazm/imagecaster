import { Hono } from "hono";
import type { Env } from "../types";

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
