const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

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

export interface Episode {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishAt: string | null;
  publishedAt: string | null;
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
  transcriptUrl: string | null;
  ogImageUrl: string | null;
  skipTranscription: boolean;
  status: string;
  createdAt: string;
  publishAt: string | null;
  publishedAt: string | null;
}

export interface PodcastSettings {
  title: string;
  description: string;
  author: string;
  email: string;
  language: string;
  category: string;
  artworkUrl: string;
  ogImageUrl: string;
  websiteUrl: string;
  explicit: boolean;
}

export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RssPreviewResponse {
  podcast: {
    title: string;
    description: string;
    author: string;
    artworkUrl: string;
    language: string;
    category: string;
  };
  episodeCount: number;
  episodes: Array<{
    title: string;
    pubDate: string;
    duration: number;
    hasAudio: boolean;
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
}

export interface EpisodesListResponse {
  episodes: Episode[];
}

export interface CreateEpisodeResponse {
  id: string;
  slug: string;
  status: string;
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

export interface OgImageUploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
  ogImageUrl: string;
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
    request<{ id: string; status: string }>(`/api/episodes/${id}/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ duration, fileSize }),
    }),

  uploadFromUrl: (id: string, sourceUrl: string) =>
    request<{ id: string; status: string }>(`/api/episodes/${id}/upload-from-url`, {
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

  getOgImageUploadUrl: (contentType: string, fileSize: number) =>
    request<OgImageUploadUrlResponse>("/api/settings/og-image/upload-url", {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeOgImageUpload: (ogImageUrl: string) =>
    request<{ success: boolean; ogImageUrl: string }>("/api/settings/og-image/upload-complete", {
      method: "POST",
      body: JSON.stringify({ ogImageUrl }),
    }),

  // Episode OGP image
  getEpisodeOgImageUploadUrl: (id: string, contentType: string, fileSize: number) =>
    request<OgImageUploadUrlResponse>(`/api/episodes/${id}/og-image/upload-url`, {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeEpisodeOgImageUpload: (id: string, ogImageUrl: string) =>
    request<{ success: boolean; ogImageUrl: string }>(`/api/episodes/${id}/og-image/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ ogImageUrl }),
    }),

  // Templates
  getTemplates: () =>
    request<DescriptionTemplate[]>("/api/templates"),

  createTemplate: (data: { name: string; content: string }) =>
    request<DescriptionTemplate>("/api/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTemplate: (id: string, data: { name?: string; content?: string }) =>
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

  importRss: (rssUrl: string) =>
    request<RssImportResponse>("/api/import/rss", {
      method: "POST",
      body: JSON.stringify({ rssUrl }),
    }),

  // Deployments
  getDeployments: () =>
    request<DeploymentsResponse>("/api/deployments"),
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
