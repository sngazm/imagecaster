/**
 * Cloudflare Worker 環境変数
 */
export interface Env {
  R2_BUCKET: R2Bucket;
  PODCAST_TITLE: string;
  WEBSITE_URL: string;
  ADMIN_API_KEY: string;
  TRANSCRIBER_API_KEY: string;
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
  description: string;
  sourceUrl: string;
  publishAt: string;
}

/**
 * エピソード更新リクエスト
 */
export interface UpdateEpisodeRequest {
  title?: string;
  description?: string;
  publishAt?: string;
}

/**
 * 文字起こし完了通知リクエスト
 */
export interface TranscriptionCompleteRequest {
  status: "completed" | "failed";
  duration?: number;
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
  status: EpisodeStatus;
}
