import { getApiBaseUrl } from "./env";

const API_BASE = getApiBaseUrl();

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Request failed");
  }

  return res.json();
}

export type PublishStatus = "new" | "uploading" | "draft" | "scheduled" | "published";
export type TranscribeStatus = "none" | "pending" | "transcribing" | "completed" | "failed" | "skipped";

export interface Episode {
  id: string;
  slug: string;
  title: string;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  publishAt: string | null;
  publishedAt: string | null;
  sourceGuid: string | null;
  applePodcastsUrl: string | null;
  applePodcastsFetchedAt: string | null;
  spotifyUrl: string | null;
}

export interface ReferenceLink {
  url: string;
  title: string;
}

export interface EpisodeDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  sourceAudioUrl: string | null;
  sourceGuid: string | null;
  transcriptUrl: string | null;
  artworkUrl: string | null;
  skipTranscription: boolean;
  hideTranscription?: boolean;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  createdAt: string;
  publishAt: string | null;
  publishedAt: string | null;
  // Bluesky
  blueskyPostText: string | null;
  blueskyPostEnabled: boolean;
  blueskyPostedAt: string | null;
  // 参考リンク
  referenceLinks: ReferenceLink[];
  // Apple Podcasts
  applePodcastsUrl: string | null;
  // Spotify
  spotifyUrl: string | null;
}

export interface PodcastSettings {
  title: string;
  description: string;
  author: string;
  email: string;
  language: string;
  category: string;
  artworkUrl: string;
  websiteUrl: string;
  explicit: boolean;
  applePodcastsId: string | null;
  applePodcastsAutoFetch: boolean;
  spotifyShowId: string | null;
  spotifyAutoFetch: boolean;
  spotifyConfigured: boolean;
  // 購読リンク
  applePodcastsUrl?: string;
  spotifyUrl?: string;
}

export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RssPodcastMeta {
  title: string;
  description: string;
  author: string;
  artworkUrl: string;
  language: string;
  category: string;
}

export interface RssPreviewResponse {
  podcast: RssPodcastMeta;
  existingPodcast: RssPodcastMeta;
  episodeCount: number;
  newEpisodeCount: number;
  totalFileSize: number;
  episodes: Array<{
    index: number;
    title: string;
    pubDate: string;
    duration: number;
    fileSize: number;
    hasAudio: boolean;
    slug: string;
    originalSlug: string;
    hasConflict: boolean;
    alreadyImported: boolean;
  }>;
}

export interface RssImportResponse {
  imported: number;
  skipped: number;
  episodes: Array<{
    title: string;
    slug: string;
    status: "imported" | "skipped";
    reason?: string;
  }>;
}

export type DeploymentStage =
  | "queued"
  | "initializing"
  | "cloning"
  | "building"
  | "deploying"
  | "success"
  | "failure";

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

export interface DeploymentsResponse {
  deployments: Deployment[];
  configured: boolean;
  websiteUrl?: string;
  accountId?: string;
  projectName?: string;
}

// Backup types
export interface ExportManifest {
  version: number;
  exportedAt: string;
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    explicit: boolean;
  };
  templates: DescriptionTemplate[];
  episodes: Array<{
    meta: EpisodeDetail;
    files: {
      audio?: { key: string; url: string };
      transcript?: { key: string; url: string };
      artwork?: { key: string; url: string };
    };
  }>;
  assets: {
    artwork?: { key: string; url: string };
  };
}

export interface ImportBackupRequest {
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    explicit: boolean;
  };
  templates: DescriptionTemplate[];
  episodes: Array<{
    meta: EpisodeDetail;
    hasAudio: boolean;
    hasTranscript: boolean;
    hasArtwork: boolean;
  }>;
  hasArtwork: boolean;
}

export interface ImportBackupResponse {
  success: boolean;
  uploadUrls: {
    episodes: Array<{
      id: string;
      audio?: string;
      transcript?: string;
      artwork?: string;
    }>;
    assets: {
      artwork?: string;
    };
  };
}

export interface EpisodesListResponse {
  episodes: Episode[];
}

export interface CreateEpisodeResponse {
  id: string;
  slug: string;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
}

export interface ArtworkUploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
  artworkUrl: string;
}

export const api = {
  // Episodes
  getEpisodes: () =>
    request<EpisodesListResponse>("/api/episodes"),

  getEpisode: (id: string) =>
    request<EpisodeDetail>(`/api/episodes/${id}`),

  createEpisode: (data: {
    title: string;
    slug?: string;
    description?: string;
    publishAt?: string | null;
    skipTranscription?: boolean;
    blueskyPostText?: string | null;
    blueskyPostEnabled?: boolean;
    referenceLinks?: ReferenceLink[];
  }) =>
    request<CreateEpisodeResponse>("/api/episodes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateEpisode: (id: string, data: {
    title?: string;
    slug?: string;
    description?: string;
    publishAt?: string | null;
    skipTranscription?: boolean;
    hideTranscription?: boolean;
    blueskyPostText?: string | null;
    blueskyPostEnabled?: boolean;
    referenceLinks?: ReferenceLink[];
    applePodcastsUrl?: string | null;
    applePodcastsFetchedAt?: string | null;
    spotifyUrl?: string | null;
  }) =>
    request<EpisodeDetail>(`/api/episodes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteEpisode: (id: string) =>
    request<{ success: boolean }>(`/api/episodes/${id}`, {
      method: "DELETE",
    }),

  getUploadUrl: (id: string, contentType: string, fileSize: number) =>
    request<UploadUrlResponse>(`/api/episodes/${id}/upload-url`, {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeUpload: (id: string, duration: number, fileSize: number) =>
    request<{ id: string; publishStatus: PublishStatus; transcribeStatus: TranscribeStatus }>(`/api/episodes/${id}/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ duration, fileSize }),
    }),

  uploadFromUrl: (id: string, sourceUrl: string) =>
    request<{ id: string; publishStatus: PublishStatus; transcribeStatus: TranscribeStatus }>(`/api/episodes/${id}/upload-from-url`, {
      method: "POST",
      body: JSON.stringify({ sourceUrl }),
    }),

  // Settings
  getSettings: () =>
    request<PodcastSettings>("/api/settings"),

  updateSettings: (data: Partial<PodcastSettings>) =>
    request<PodcastSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getArtworkUploadUrl: (contentType: string, fileSize: number) =>
    request<ArtworkUploadUrlResponse>("/api/settings/artwork/upload-url", {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeArtworkUpload: (artworkUrl: string) =>
    request<{ success: boolean; artworkUrl: string }>("/api/settings/artwork/upload-complete", {
      method: "POST",
      body: JSON.stringify({ artworkUrl }),
    }),

  // Episode Artwork
  getEpisodeArtworkUploadUrl: (id: string, contentType: string, fileSize: number) =>
    request<ArtworkUploadUrlResponse>(`/api/episodes/${id}/artwork/upload-url`, {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeEpisodeArtworkUpload: (id: string, artworkUrl: string) =>
    request<{ success: boolean; artworkUrl: string }>(`/api/episodes/${id}/artwork/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ artworkUrl }),
    }),

  // Templates
  getTemplates: () =>
    request<DescriptionTemplate[]>("/api/templates"),

  createTemplate: (data: { name: string; content: string }) =>
    request<DescriptionTemplate>("/api/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTemplate: (id: string, data: { name?: string; content?: string; isDefault?: boolean }) =>
    request<DescriptionTemplate>(`/api/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteTemplate: (id: string) =>
    request<{ success: boolean }>(`/api/templates/${id}`, {
      method: "DELETE",
    }),

  // Import
  previewRssImport: (rssUrl: string) =>
    request<RssPreviewResponse>("/api/import/rss/preview", {
      method: "POST",
      body: JSON.stringify({ rssUrl }),
    }),

  importRss: (rssUrl: string, importAudio: boolean = false, importPodcastSettings: boolean = false, customSlugs?: Record<string, string>, skipTranscription: boolean = true) =>
    request<RssImportResponse>("/api/import/rss", {
      method: "POST",
      body: JSON.stringify({ rssUrl, importAudio, importPodcastSettings, customSlugs, skipTranscription }),
    }),

  // Deployments
  getDeployments: () =>
    request<DeploymentsResponse>("/api/deployments"),

  triggerDeploy: () =>
    request<{ success: boolean }>("/api/deployments/trigger", { method: "POST" }),

  // Podcast management
  resetAllData: () =>
    request<{ success: boolean; message: string; deletedCount: number }>(
      "/api/podcast/reset",
      { method: "DELETE" }
    ),

  // Link title fetch
  fetchLinkTitle: (url: string) =>
    request<{ title: string }>("/api/fetch-link-title", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  // Backup
  getExportManifest: () =>
    request<ExportManifest>("/api/backup/export"),

  importBackup: (data: ImportBackupRequest) =>
    request<ImportBackupResponse>("/api/backup/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  completeBackupImport: (data: {
    episodes: Array<{
      id: string;
      hasAudio: boolean;
      hasTranscript: boolean;
      hasArtwork: boolean;
      status: "draft" | "scheduled" | "published";
    }>;
    hasArtwork: boolean;
  }) =>
    request<{ success: boolean }>("/api/backup/import/complete", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Spotify
  fetchSpotifyEpisodes: () =>
    request<{
      success: boolean;
      total: number;
      matched: number;
      results: Array<{
        episodeId: string;
        title: string;
        spotifyUrl: string | null;
        matched: boolean;
        matchedTitle?: string;
      }>;
    }>("/api/spotify/fetch-episodes", {
      method: "POST",
    }),
};

export async function uploadToR2(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to upload file to R2");
  }
}

export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      resolve(Math.floor(audio.duration));
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error("Failed to load audio"));
    };
  });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * UTC ISO文字列 → datetime-local形式（ローカルタイム）
 * 例: "2025-12-29T06:00:00.000Z" → "2025-12-29T15:00" (JST)
 */
export function utcToLocalDateTimeString(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * datetime-local形式（ローカルタイム） → UTC ISO文字列
 * 例: "2025-12-29T15:00" (JST) → "2025-12-29T06:00:00.000Z"
 */
export function localDateTimeToISOString(localDateTime: string): string {
  return new Date(localDateTime).toISOString();
}

// Transcript types and functions
export interface TranscriptSegment {
  start: string;  // "00:00:05"
  text: string;
}

export function parseVttToSegments(vtt: string): TranscriptSegment[] {
  const lines = vtt.split("\n");
  const segments: TranscriptSegment[] = [];
  let currentStart = "";
  let currentTextLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("WEBVTT") || /^\d+$/.test(trimmed)) {
      continue;
    }

    const timestampMatch = trimmed.match(/^(\d{2}:\d{2}:\d{2})\.\d{3}\s*-->/);
    if (timestampMatch) {
      currentStart = timestampMatch[1];
      continue;
    }

    if (trimmed === "") {
      if (currentStart && currentTextLines.length > 0) {
        segments.push({
          start: currentStart,
          text: currentTextLines.join(" "),
        });
        currentStart = "";
        currentTextLines = [];
      }
      continue;
    }

    currentTextLines.push(trimmed);
  }

  if (currentStart && currentTextLines.length > 0) {
    segments.push({
      start: currentStart,
      text: currentTextLines.join(" "),
    });
  }

  return segments;
}

export async function fetchTranscriptSegments(
  transcriptUrl: string
): Promise<TranscriptSegment[]> {
  try {
    const res = await fetch(transcriptUrl);
    if (!res.ok) return [];
    const vtt = await res.text();
    return parseVttToSegments(vtt);
  } catch {
    return [];
  }
}
