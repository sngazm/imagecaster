/**
 * Cloudflare Worker 環境変数
 */
export interface Env {
  R2_BUCKET: R2Bucket;
  PODCAST_TITLE: string;
  WEBSITE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PUBLIC_URL: string; // e.g., https://bucket.account.r2.dev or custom domain
  // Cloudflare Access
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  // Deploy Hook（Cloudflare Pages）
  WEB_DEPLOY_HOOK_URL?: string;
  // Cloudflare Pages API（ビルド状況確認用）
  CLOUDFLARE_API_TOKEN?: string;
  PAGES_PROJECT_NAME?: string;
  // ローカル開発用
  SKIP_AUTH?: string;
}

/**
 * Podcast 全体のインデックス (index.json)
 */
export interface PodcastIndex {
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    artworkUrl: string;
    ogImageUrl: string; // OGP画像URL
    websiteUrl: string;
    explicit: boolean;
  };
  episodes: Array<{
    id: string;
  }>;
}

/**
 * エピソードのステータス
 */
export type EpisodeStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "transcribing"
  | "scheduled"
  | "published"
  | "failed";

/**
 * エピソードメタデータ (meta.json)
 */
export interface EpisodeMeta {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照の音声URL（インポート時）
  transcriptUrl: string | null;
  ogImageUrl: string | null; // OGP画像URL
  skipTranscription: boolean;
  status: EpisodeStatus;
  createdAt: string;
  publishAt: string | null; // nullの場合はドラフト
  publishedAt: string | null;
}

/**
 * 新規エピソード作成リクエスト
 */
export interface CreateEpisodeRequest {
  title: string;
  slug?: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
}

/**
 * エピソード更新リクエスト
 */
export interface UpdateEpisodeRequest {
  title?: string;
  slug?: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
}

/**
 * 文字起こし完了通知リクエスト
 */
export interface TranscriptionCompleteRequest {
  status: "completed" | "failed";
  duration?: number;
}

/**
 * Presigned URL 発行リクエスト
 */
export interface UploadUrlRequest {
  contentType: string;
  fileSize: number;
}

/**
 * Presigned URL 発行レスポンス
 */
export interface UploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
}

/**
 * アップロード完了通知リクエスト
 */
export interface UploadCompleteRequest {
  duration: number;
  fileSize?: number;  // 開発時のみ使用（R2 Binding が使えない場合）
}

/**
 * URL からアップロードリクエスト
 */
export interface UploadFromUrlRequest {
  sourceUrl: string;
}

/**
 * エピソード一覧レスポンス
 */
export interface EpisodesListResponse {
  episodes: Array<{
    id: string;
    title: string;
    status: EpisodeStatus;
    publishAt: string | null;
    publishedAt: string | null;
  }>;
}

/**
 * エピソード作成レスポンス
 */
export interface CreateEpisodeResponse {
  id: string;
  slug: string;
  status: EpisodeStatus;
}

/**
 * 概要欄テンプレート
 */
export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * テンプレート一覧 (templates/descriptions.json)
 */
export interface TemplatesIndex {
  templates: DescriptionTemplate[];
}

/**
 * テンプレート作成/更新リクエスト
 */
export interface TemplateRequest {
  name: string;
  content: string;
}

/**
 * Podcast 設定更新リクエスト
 */
export interface UpdatePodcastSettingsRequest {
  title?: string;
  description?: string;
  author?: string;
  email?: string;
  language?: string;
  category?: string;
  websiteUrl?: string;
  explicit?: boolean;
}

/**
 * RSSインポートリクエスト
 */
export interface ImportRssRequest {
  rssUrl: string;
  importAudio?: boolean; // trueの場合は音声もダウンロード
}

/**
 * RSSインポートレスポンス
 */
export interface ImportRssResponse {
  imported: number;
  skipped: number;
  episodes: Array<{
    title: string;
    slug: string;
    status: "imported" | "skipped";
    reason?: string;
  }>;
}

/**
 * Cloudflare Pages デプロイステータス
 */
export type DeploymentStage =
  | "queued"
  | "initializing"
  | "cloning"
  | "building"
  | "deploying"
  | "success"
  | "failure";

/**
 * デプロイ情報
 */
export interface Deployment {
  id: string;
  shortId: string;
  url: string;
  createdOn: string;
  modifiedOn: string;
  latestStage: {
    name: DeploymentStage;
    status: "idle" | "active" | "success" | "failure";
    startedOn: string | null;
    endedOn: string | null;
  };
  deploymentTrigger: {
    type: string;
    metadata: {
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
    };
  };
}

/**
 * デプロイ一覧レスポンス
 */
export interface DeploymentsResponse {
  deployments: Deployment[];
  configured: boolean;
  websiteUrl?: string;
  accountId?: string;
  projectName?: string;
}
