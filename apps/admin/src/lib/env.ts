/**
 * 環境検出ユーティリティ
 *
 * Cloudflare Pages のプレビュー環境を検出し、対応するURLを生成します。
 */

export type Environment = "production" | "preview" | "local";

export interface PreviewInfo {
  /** プレビューのブランチ名またはコミットハッシュ */
  identifier: string;
  /** プロジェクト名 */
  projectName: string;
}

/**
 * 現在の環境を検出
 */
export function getEnvironment(): Environment {
  const hostname = window.location.hostname;

  // ローカル開発
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "local";
  }

  // Cloudflare Pages のプレビュー環境
  // パターン: <branch-or-hash>.<project>.pages.dev
  // 本番: <project>.pages.dev
  if (hostname.endsWith(".pages.dev")) {
    const parts = hostname.replace(".pages.dev", "").split(".");
    // 2つ以上のパーツがある場合はプレビュー環境
    if (parts.length >= 2) {
      return "preview";
    }
    return "production";
  }

  // カスタムドメインは本番とみなす
  return "production";
}

/**
 * プレビュー環境の情報を取得
 * プレビュー環境でない場合は null を返す
 */
export function getPreviewInfo(): PreviewInfo | null {
  const hostname = window.location.hostname;

  if (!hostname.endsWith(".pages.dev")) {
    return null;
  }

  const parts = hostname.replace(".pages.dev", "").split(".");

  if (parts.length < 2) {
    return null;
  }

  // 最後のパーツがプロジェクト名、それ以外がidentifier
  const projectName = parts[parts.length - 1];
  const identifier = parts.slice(0, parts.length - 1).join(".");

  return { identifier, projectName };
}

/**
 * 対応するWebサイトのURLを生成
 *
 * @param baseWebUrl - 本番のWebサイトURL (例: "https://imagecaster-web.pages.dev")
 * @param slug - エピソードのslug (オプション)
 * @returns 環境に応じたWebサイトのURL
 */
export function getWebsiteUrl(baseWebUrl: string, slug?: string): string {
  const env = getEnvironment();
  let url = baseWebUrl;

  if (env === "local") {
    // ローカル開発時はローカルのwebサーバーを参照
    url = import.meta.env.VITE_WEB_BASE || "http://localhost:4321";
  } else if (env === "preview") {
    const previewInfo = getPreviewInfo();
    if (previewInfo) {
      // adminのプロジェクト名からwebのプロジェクト名を推測
      // 例: imagecaster-admin → imagecaster-web
      const webProjectName = previewInfo.projectName.replace("-admin", "-web");
      url = `https://${previewInfo.identifier}.${webProjectName}.pages.dev`;
    }
  }

  // slugがある場合はエピソードページのURLを生成
  if (slug) {
    return `${url}/episodes/${slug}`;
  }

  return url;
}

/**
 * 対応するWorker APIのURLを生成
 *
 * プレビュー環境用のWorkerがある場合はそちらを使用
 */
export function getApiBaseUrl(): string {
  const configuredBase = import.meta.env.VITE_API_BASE;
  const previewBase = import.meta.env.VITE_PREVIEW_API_BASE;

  const env = getEnvironment();

  if (env === "local") {
    return configuredBase || "http://localhost:8787";
  }

  if (env === "preview" && previewBase) {
    return previewBase;
  }

  return configuredBase || "http://localhost:8787";
}

/**
 * 環境の表示名を取得
 */
export function getEnvironmentLabel(): string {
  const env = getEnvironment();

  switch (env) {
    case "local":
      return "ローカル開発";
    case "preview": {
      const info = getPreviewInfo();
      if (info) {
        return `プレビュー: ${info.identifier}`;
      }
      return "プレビュー";
    }
    case "production":
    default:
      return "";
  }
}
