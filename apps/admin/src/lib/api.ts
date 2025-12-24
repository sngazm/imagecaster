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
  episodeNumber: number;
  title: string;
  status: string;
  publishedAt: string | null;
}

export interface EpisodeDetail {
  id: string;
  episodeNumber: number;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  transcriptUrl: string | null;
  skipTranscription: boolean;
  status: string;
  createdAt: string;
  publishAt: string;
  publishedAt: string | null;
}

export interface EpisodesListResponse {
  episodes: Episode[];
}

export interface CreateEpisodeResponse {
  id: string;
  episodeNumber: number;
  status: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
}

export const api = {
  getEpisodes: () =>
    request<EpisodesListResponse>("/api/episodes"),

  getEpisode: (id: string) =>
    request<EpisodeDetail>(`/api/episodes/${id}`),

  createEpisode: (data: {
    title: string;
    description?: string;
    publishAt: string;
    skipTranscription: boolean;
  }) =>
    request<CreateEpisodeResponse>("/api/episodes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateEpisode: (id: string, data: {
    title?: string;
    description?: string;
    publishAt?: string;
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
