#!/usr/bin/env node
/**
 * 環境変数のデバッグログを出力するスクリプト
 * シークレットはマスクして表示
 */

const appName = process.argv[2] || "unknown";

// シークレットとして扱う変数名のパターン
const SECRET_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /KEY.*ID/i,
  /ACCESS_KEY/i,
  /API_KEY/i,
];

// 対象の環境変数（アプリ別）
const ENV_VARS_BY_APP = {
  worker: [
    "PODCAST_TITLE",
    "WEBSITE_URL",
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_URL",
    "CF_ACCESS_TEAM_DOMAIN",
    "CF_ACCESS_AUD",
    "IS_DEV",
    "WEB_DEPLOY_HOOK_URL",
    "BLUESKY_IDENTIFIER",
    "BLUESKY_PASSWORD",
    "CLOUDFLARE_API_TOKEN",
    "PAGES_PROJECT_NAME",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
  ],
  admin: [
    "NODE_ENV",
    "VITE_WEB_BASE",
  ],
  web: [
    "NODE_ENV",
    "R2_PUBLIC_URL",
  ],
};

function isSecret(varName) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(varName));
}

function maskValue(value) {
  if (!value) return "(not set)";
  if (value.length <= 4) return "***";
  return value.slice(0, 2) + "***" + value.slice(-2);
}

function logEnvVars() {
  console.log("");
  console.log("=".repeat(60));
  console.log(`[${appName.toUpperCase()}] Environment Variables`);
  console.log("=".repeat(60));
  console.log(`Build Time: ${new Date().toISOString()}`);
  console.log("");

  const envVars = ENV_VARS_BY_APP[appName] || [];

  if (envVars.length === 0) {
    console.log("No environment variables configured for this app.");
  } else {
    let setCount = 0;
    let notSetCount = 0;

    for (const varName of envVars) {
      const value = process.env[varName];
      const secret = isSecret(varName);
      const displayValue = secret ? maskValue(value) : (value || "(not set)");
      const status = value ? "SET" : "NOT SET";

      if (value) {
        setCount++;
      } else {
        notSetCount++;
      }

      const secretLabel = secret ? " [SECRET]" : "";
      console.log(`  ${varName}${secretLabel}`);
      console.log(`    Value: ${displayValue}`);
      console.log(`    Status: ${status}`);
      console.log("");
    }

    console.log("-".repeat(60));
    console.log(`Summary: ${setCount} set, ${notSetCount} not set`);
  }

  console.log("=".repeat(60));
  console.log("");
}

logEnvVars();
