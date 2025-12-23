/**
 * Cloudflare Worker 環境変数
 */
export interface Env {
  R2_BUCKET: R2Bucket;
  PODCAST_TITLE: string;
  WEBSITE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  ADMIN_API_KEY: string;
  TRANSCRIBER_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  TRANSCRIBER_WEBHOOK_URL?: string;
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
    websiteUrl: string;
    explicit: boolean;
  };
  episodes: Array<{
    id: string;
    episodeNumber: number;
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
  episodeNumber: number;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  transcriptUrl: string | null;
  skipTranscription: boolean;
  status: EpisodeStatus;
  createdAt: string;
  publishAt: string;
  publishedAt: string | null;
}

/**
 * 新規エピソード作成リクエスト
 */
export interface CreateEpisodeRequest {
  title: string;
  description?: string;
  publishAt: string;
  skipTranscription?: boolean;
}

/**
 * エピソード更新リクエスト
 */
export interface UpdateEpisodeRequest {
  title?: string;
  description?: string;
  publishAt?: string;
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
    episodeNumber: number;
    title: string;
    status: EpisodeStatus;
    publishedAt: string | null;
  }>;
}

/**
 * エピソード作成レスポンス
 */
export interface CreateEpisodeResponse {
  id: string;
  episodeNumber: number;
  status: EpisodeStatus;
}
