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
  // Bluesky
  BLUESKY_IDENTIFIER?: string; // ハンドル or DID
  BLUESKY_PASSWORD?: string; // アプリパスワード
  // Cloudflare Pages API（ビルド状況確認用）
  CLOUDFLARE_API_TOKEN?: string;
  PAGES_PROJECT_NAME?: string;
  // Spotify
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  // ローカル開発用
  IS_DEV?: string;
}

/**
 * Podcast 全体のインデックス (index.json)
 * 公開用: published のエピソードのみ含む
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
    websiteUrl: string;
    explicit: boolean;
    applePodcastsId: string | null; // Apple Podcasts ID (collectionId)
    applePodcastsAutoFetch: boolean; // 管理画面起動時に自動取得するか
    spotifyShowId: string | null; // Spotify Show ID
    spotifyAutoFetch: boolean; // 管理画面起動時に自動取得するか
    // 購読リンク
    applePodcastsUrl?: string;
    spotifyUrl?: string;
  };
  episodes: Array<{
    id: string;
    storageKey: string; // R2ディレクトリ名（推測不能）
  }>;
}

/**
 * 公開ステータス
 */
export type PublishStatus =
  | "new"        // エピソード作成直後、音声なし
  | "uploading"  // 音声アップロード/ダウンロード中
  | "draft"      // 音声あり、公開予約なし
  | "scheduled"  // 公開予約済み
  | "published"; // 公開済み

/**
 * 文字起こしステータス
 */
export type TranscribeStatus =
  | "none"         // 文字起こし未開始
  | "pending"      // キュー待ち
  | "transcribing" // 文字起こし中
  | "completed"    // 完了
  | "failed"       // 失敗
  | "skipped";     // スキップ

/**
 * @deprecated 後方互換性のため残す。新コードでは PublishStatus と TranscribeStatus を使用
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
 * 参考リンク
 */
export interface ReferenceLink {
  url: string;
  title: string;
}

/**
 * エピソードメタデータ (meta.json)
 */
export interface EpisodeMeta {
  id: string;
  slug: string;
  storageKey: string; // R2ディレクトリ名（{slug}-{random}）
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照の音声URL（インポート時）
  sourceGuid: string | null; // RSSのGUID（差分インポート用）
  transcriptUrl: string | null;
  artworkUrl: string | null; // エピソード固有のアートワーク（nullの場合はPodcastのアートワークを使用）
  skipTranscription: boolean;
  hideTranscription?: boolean; // 文字起こしを非表示にするか
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  createdAt: string;
  publishAt: string | null; // nullの場合はドラフト
  publishedAt: string | null;
  // Bluesky 自動投稿
  blueskyPostText: string | null; // 投稿テキスト（事前登録）
  blueskyPostEnabled: boolean; // 公開時にBlueskyに投稿するか
  blueskyPostedAt: string | null; // 投稿済みの場合の日時
  // 参考リンク
  referenceLinks: ReferenceLink[];
  // Apple Podcasts
  applePodcastsUrl: string | null; // エピソード個別URL
  // Spotify
  spotifyUrl: string | null; // エピソード個別URL
  // 文字起こしロック（ソフトロック、1時間で自動解除）
  transcriptionLockedAt?: string | null;
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
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
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
  hideTranscription?: boolean;
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
  // Apple Podcasts（管理画面から編集可能）
  applePodcastsUrl?: string | null;
  // Spotify（管理画面から編集可能）
  spotifyUrl?: string | null;
  // 文字起こしリトライ用（failed → pending）
  transcribeStatus?: TranscribeStatus;
}

/**
 * 文字起こし完了通知リクエスト
 */
export interface TranscriptionCompleteRequest {
  transcribeStatus: "completed" | "failed";
  duration?: number;
}

/**
 * 文字起こしセグメント（Whisper互換 + 話者情報対応）
 */
export interface TranscriptSegment {
  start: number; // 開始時間（秒）
  end: number; // 終了時間（秒）
  text: string;
  speaker?: string; // 話者ID（将来の話者分離用）
}

/**
 * 文字起こしJSON形式（R2に保存）
 */
export interface TranscriptData {
  segments: TranscriptSegment[];
  language?: string;
}

/**
 * 文字起こしキューのエピソード情報
 */
export interface TranscriptionQueueItem {
  id: string;
  slug: string;
  title: string;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照URL（RSSインポート時）
  duration: number;
  lockedAt: string; // ロック取得時刻
}

/**
 * 文字起こしキューレスポンス
 */
export interface TranscriptionQueueResponse {
  episodes: TranscriptionQueueItem[];
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
    publishStatus: PublishStatus;
    transcribeStatus: TranscribeStatus;
    publishAt: string | null;
    publishedAt: string | null;
    createdAt: string;
  }>;
}

/**
 * エピソード作成レスポンス
 */
export interface CreateEpisodeResponse {
  id: string;
  slug: string;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
}

/**
 * 概要欄テンプレート
 */
export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
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
  isDefault?: boolean;
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
  applePodcastsId?: string | null;
  applePodcastsAutoFetch?: boolean;
  spotifyShowId?: string | null;
  spotifyAutoFetch?: boolean;
  // 購読リンク
  applePodcastsUrl?: string;
  spotifyUrl?: string;
}

/**
 * RSSインポートリクエスト
 */
export interface ImportRssRequest {
  rssUrl: string;
  importAudio?: boolean; // trueの場合は音声もダウンロード
  importArtwork?: boolean; // trueの場合はエピソードアートワークもダウンロード
  importPodcastSettings?: boolean; // trueの場合はPodcast設定も上書き
  customSlugs?: Record<string, string>; // インデックス(0始まり) → カスタムslug のマッピング
  skipTranscription?: boolean; // trueの場合は文字起こしをスキップ（デフォルト: true）
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
