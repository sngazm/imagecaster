/**
 * Pages Functions: API プロキシ
 *
 * プレビュー環境では Workers のプレビュー URL にプロキシし、
 * 本番環境では本番 Worker にプロキシする。
 */

interface Env {
  CF_PAGES_BRANCH?: string;
  CF_PAGES_URL?: string;
}

const PRODUCTION_WORKER_URL = "https://caster.image.club";
const WORKER_PREVIEW_DOMAIN = "imagecaster-api.imagecast.workers.dev";

function getWorkerUrl(env: Env): string {
  const branch = env.CF_PAGES_BRANCH;

  // 本番ブランチまたはブランチ情報がない場合は本番 Worker
  if (!branch || branch === "main") {
    return PRODUCTION_WORKER_URL;
  }

  // プレビューブランチ: Workers のプレビュー URL を構築
  // フォーマット: <branch>-<worker-name>.<subdomain>.workers.dev
  // ブランチ名の sanitize（スラッシュをハイフンに、小文字化）
  const sanitizedBranch = branch.toLowerCase().replace(/\//g, "-");
  return `https://${sanitizedBranch}-${WORKER_PREVIEW_DOMAIN}`;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const workerUrl = getWorkerUrl(context.env);
  const url = new URL(context.request.url);

  // 元のリクエストのヘッダーをコピー
  const headers = new Headers(context.request.headers);

  // プロキシ先 URL を構築
  const proxyUrl = `${workerUrl}${url.pathname}${url.search}`;

  // リクエストを転送
  const response = await fetch(proxyUrl, {
    method: context.request.method,
    headers,
    body: context.request.body,
    // @ts-expect-error - duplex is required for streaming body
    duplex: "half",
  });

  // レスポンスヘッダーをコピー
  const responseHeaders = new Headers(response.headers);

  // CORS ヘッダーを追加（プレビュー環境でのクロスオリジン対応）
  const origin = context.request.headers.get("Origin");
  if (origin) {
    responseHeaders.set("Access-Control-Allow-Origin", origin);
    responseHeaders.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
