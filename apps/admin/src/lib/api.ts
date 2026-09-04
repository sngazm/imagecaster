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
  /** この回かぎりの誤字修正。校正が見つけた文脈依存のもの */
  transcriptCorrections?: CorrectionRule[] | null;
  /** この回だけの話者アイコン。ゲスト回で使う */
  speakerIcons?: SpeakerIcon[] | null;
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
  // 文字起こしエラー
  transcriptionErrorMessage?: string | null;
  // Claude の感想
  claudeImpression?: string | null;
  claudeImpressionAt?: string | null;
  // 話者トラック（zip）
  tracksUploadedAt?: string | null;
  speakerTracks?: SpeakerTrackAssignment[] | null;
  transcriptRawUrl?: string | null;
  /** トラックごとの音量（波形）。正解データ作成画面が読む */
  levelsUrl?: string | null;
}

/**
 * 話者トラックの割り当て
 *
 * label が null のトラックは BGM などの非発話トラックで、話者判定から除外される。
 */
export interface SpeakerTrackAssignment {
  track: number;
  label: string | null;
}

/**
 * セグメント統合の設定
 */
export interface MergeSettings {
  enabled: boolean;
  /** これ以上の間が空いていたら統合しない（秒）。null なら間を条件にしない */
  maxGapSec: number | null;
  maxDurationSec: number;
  maxChars: number;
}

/**
 * 誤字修正の置換ルール
 */
export interface CorrectionRule {
  from: string;
  to: string;
  enabled: boolean;
  note?: string;
}

/**
 * 相槌の扱い
 */
export interface BackchannelSettings {
  enabled: boolean;
  /** 繰り返しを抑える対象の語 */
  units: string[];
  /** 何回までに抑えるか */
  maxRepeat: number;
  /** 相槌だけのセグメントを丸ごと落とすか */
  dropStandalone: boolean;
  /** 丸ごと落とす対象の語 */
  standalonePhrases: string[];
}

/**
 * 校正が見つけた、辞書に入れたい規則の提案
 *
 * 自動では入らない。辞書は番組全体に効くので、機械の判断で足すと
 * 公開中の文章を壊す。
 */
/**
 * 話者のアイコン
 *
 * 公開サイトで名前の代わりに出す。番組の既定にゲスト分を足せる。
 */
export interface SpeakerIcon {
  name: string;
  url: string;
}

export interface CorrectionProposal {
  from: string;
  to: string;
  note?: string;
  episodeId: string;
  occurrences: number;
  proposedAt: string;
}

export interface TranscriptPostProcessSettings {
  speakerDefaults: SpeakerTrackAssignment[];
  merge: MergeSettings;
  corrections: CorrectionRule[];
  /** 校正が見つけた提案。人が承認するまで効かない */
  proposals?: CorrectionProposal[];
  /** 話者のアイコン。番組の既定 */
  speakerIcons?: SpeakerIcon[];
  backchannel?: BackchannelSettings;
  /** 同時発話を検出する範囲（冒頭からの秒数）。null なら検出しない */
  simultaneousUntilSec?: number | null;
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
  // アナリティクス
  analyticsPrefix?: string;
  // 文字起こしの後処理設定
  transcriptPostProcess?: TranscriptPostProcessSettings;
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

  getReplaceUrl: (id: string, contentType: string, fileSize: number) =>
    request<UploadUrlResponse>(`/api/episodes/${id}/replace-url`, {
      method: "POST",
      body: JSON.stringify({ contentType, fileSize }),
    }),

  completeReplace: (id: string, duration: number, fileSize: number) =>
    request<{ id: string; publishStatus: PublishStatus; transcribeStatus: TranscribeStatus }>(`/api/episodes/${id}/replace-complete`, {
      method: "POST",
      body: JSON.stringify({ duration, fileSize }),
    }),

  replaceFromUrl: (id: string, sourceUrl: string) =>
    request<{ id: string; publishStatus: PublishStatus; transcribeStatus: TranscribeStatus }>(`/api/episodes/${id}/replace-from-url`, {
      method: "POST",
      body: JSON.stringify({ sourceUrl }),
    }),

  retryTranscription: (id: string) =>
    request<{ success: boolean; transcribeStatus: TranscribeStatus }>(`/api/episodes/${id}/retry-transcription`, {
      method: "POST",
    }),

  // 話者トラック（zip）
  getTracksUploadUrl: (id: string, contentType: string, fileSize: number) =>
    request<{ uploadUrl: string; expiresIn: number }>(
      `/api/episodes/${id}/tracks/upload-url`,
      { method: "POST", body: JSON.stringify({ contentType, fileSize }) }
    ),

  /** 話者アイコンの Presigned URL を発行する */
  getSpeakerIconUploadUrl: (
    id: string,
    name: string,
    contentType: string,
    fileSize: number
  ) =>
    request<{ uploadUrl: string; url: string }>(
      `/api/episodes/${id}/speaker-icons/upload-url`,
      { method: "POST", body: JSON.stringify({ name, contentType, fileSize }) }
    ),

  /** この回だけの話者アイコンを保存する */
  // 正解データ（教師データ）
  getTruth: (id: string) =>
    request<TruthResponse>(`/api/episodes/${id}/transcript/truth`),

  saveTruth: (
    id: string,
    segments: TruthSegment[],
    ranges: TruthRange[],
    base: TruthBase
  ) =>
    request<{
      success: boolean;
      segments: number;
      ranges: TruthRange[];
      base: TruthBase;
      updatedAt: string;
    }>(`/api/episodes/${id}/transcript/truth`, {
      method: "PUT",
      body: JSON.stringify({ segments, ranges, base }),
    }),

  saveSpeakerIcons: (id: string, speakerIcons: SpeakerIcon[] | null) =>
    request<{ success: boolean; speakerIcons: SpeakerIcon[] | null }>(
      `/api/episodes/${id}/speaker-icons`,
      { method: "PUT", body: JSON.stringify({ speakerIcons }) }
    ),

  /** この回の収録参加者を保存する。zip の有無に関わらず使える */
  saveSpeakerTracks: (id: string, speakerTracks: SpeakerTrackAssignment[] | null) =>
    request<{ success: boolean; speakerTracks: SpeakerTrackAssignment[] | null }>(
      `/api/episodes/${id}/speaker-tracks`,
      { method: "PUT", body: JSON.stringify({ speakerTracks }) }
    ),

  completeTracksUpload: (
    id: string,
    speakerTracks?: SpeakerTrackAssignment[] | null
  ) =>
    request<{
      success: boolean;
      tracksUploadedAt: string;
      speakerTracks: SpeakerTrackAssignment[] | null;
    }>(`/api/episodes/${id}/tracks/upload-complete`, {
      method: "POST",
      body: JSON.stringify({ speakerTracks }),
    }),

  deleteTracks: (id: string) =>
    request<{ success: boolean }>(`/api/episodes/${id}/tracks`, {
      method: "DELETE",
    }),

  // LLM による校正
  reviewTranscript: (id: string) =>
    request<{
      success: boolean;
      corrections: Array<{ index: number; before: string; after: string; reason: string }>;
      rejected: Array<{ correction: { before: string; after: string }; reason: string }>;
    }>(`/api/episodes/${id}/transcript/review`, { method: "POST" }),

  // Claude の感想
  generateImpression: (id: string) =>
    request<{ success: boolean; impression: string }>(
      `/api/episodes/${id}/impression`,
      { method: "POST" }
    ),

  deleteImpression: (id: string) =>
    request<{ success: boolean }>(`/api/episodes/${id}/impression`, {
      method: "DELETE",
    }),

  // 音声から文字起こしをやり直す（話者トラックを後から用意した場合など）
  retranscribe: (id: string) =>
    request<{ success: boolean; transcribeStatus: TranscribeStatus }>(
      `/api/episodes/${id}/retranscribe`,
      { method: "POST" }
    ),

  // 文字起こしの後処理
  reprocessTranscript: (id: string) =>
    request<{
      success: boolean;
      segments: number;
      applied: Array<{ from: string; to: string; count: number }>;
    }>(`/api/episodes/${id}/transcript/reprocess`, { method: "POST" }),

  reprocessAllTranscripts: () =>
    request<{ success: boolean; queued: number }>(
      "/api/transcription/reprocess-all",
      { method: "POST" }
    ),

  // Settings
  getSettings: () =>
    request<PodcastSettings>("/api/settings"),

  updateSettings: (data: Partial<PodcastSettings>) =>
    request<PodcastSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  /** 校正が見つけた提案を承認・却下する */
  reviewProposals: (approve: CorrectionProposal[], reject: CorrectionProposal[]) =>
    request<{ approved: number; rejected: number; remaining: number }>(
      "/api/settings/proposals",
      {
        method: "POST",
        body: JSON.stringify({
          approve: approve.map((p) => ({ from: p.from, to: p.to })),
          reject: reject.map((p) => ({ from: p.from, to: p.to })),
        }),
      }
    ),

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

  // --- 切り抜き動画 -------------------------------------------------------
  //
  // 描画はクラウドではできないので、ここでは指示を預けるだけ。作り直しは
  // 手元の道具が引き取る。docs/clip-viewer-spec.md を参照。

  /** この回の切り抜き一覧 */
  getClips: (episodeId: string) =>
    request<{ clips: ClipListEntry[] }>(`/api/episodes/${episodeId}/clips`),

  /** 切り抜き 1 本分。baseUrl + /v{n}/clip.mp4 が動画の URL */
  getClip: (episodeId: string, clipId: string) =>
    request<ClipDetail>(`/api/episodes/${episodeId}/clips/${clipId}`),

  /** その版の字幕 */
  getClipSubtitles: (episodeId: string, clipId: string, version: number) =>
    request<ClipSubtitle[]>(
      `/api/episodes/${episodeId}/clips/${clipId}/versions/${version}/subs`
    ),

  /** 直しの指示を預ける。字幕はここでは書き換わらない */
  postClipRequest: (
    episodeId: string,
    clipId: string,
    baseVersion: number,
    items: ClipRequestItem[]
  ) =>
    request<ClipRequest>(
      `/api/episodes/${episodeId}/clips/${clipId}/requests`,
      { method: "POST", body: JSON.stringify({ baseVersion, items }) }
    ),

  /** OK / ボツ */
  setClipStatus: (episodeId: string, clipId: string, status: ClipStatus) =>
    request<ClipDetail>(`/api/episodes/${episodeId}/clips/${clipId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
};

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export function uploadToR2(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  // fetch ではアップロード進捗が取得できないため XMLHttpRequest を使用
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error("Failed to upload file to R2"));
      }
    };
    xhr.onerror = () => reject(new Error("Failed to upload file to R2"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(file);
  });
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
  speaker?: string;  // 話者名（話者分離が有効な場合のみ）
}

/**
 * Whisper の生出力のセグメント
 *
 * 公開用の VTT と違い、時刻は秒。後処理で何が変わったかを見るのに使う。
 */
export interface RawSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

/** 人が直した正解。話者分離と後処理を評価するための答え合わせに使う */
export interface TruthSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

/** 人が確かめた範囲。ここだけを採点の対象にする */
export interface TruthRange {
  start: number;
  end: number;
}

/** 正解を作るときに元にしたもの。採点が比べる先をこれで決める */
export type TruthBase = "raw" | "published";

export interface TruthResponse {
  exists: boolean;
  segments: TruthSegment[];
  ranges: TruthRange[];
  base: TruthBase;
  updatedAt: string | null;
}

/** "00:01:23" を秒に直す */
export function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(time) || 0;
}

/**
 * VTTのvoiceタグ（<v 話者名>本文</v>）から話者名と本文を取り出す
 *
 * 終了タグは省略されることがあるため、あってもなくても扱えるようにする。
 */
function extractVoice(text: string): { speaker?: string; text: string } {
  const match = text.match(/^<v\s+([^>]+)>([\s\S]*)$/);
  if (!match) {
    return { text };
  }

  const speaker = match[1].trim();
  const body = match[2].replace(/<\/v>\s*$/, "");

  return speaker ? { speaker, text: body } : { text: body };
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
          ...extractVoice(currentTextLines.join(" ")),
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
      ...extractVoice(currentTextLines.join(" ")),
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

// --- 切り抜き動画 ---------------------------------------------------------

export type ClipStatus = "draft" | "approved" | "rejected";

export interface ClipListEntry {
  id: string;
  label: string;
  latest: number;
  status: ClipStatus;
}

/**
 * 字幕への直しの指示。
 *
 * 文字を直接書き換えるのではなく指示として預ける。字幕は音のタイムスタンプに
 * 紐づいているので、文字だけ差し替えると音とずれる。読んで区切りを決め直すのは
 * 作り直す側の仕事。
 */
export type ClipRequestItem =
  | { type: "edit"; index: number; text: string }
  | { type: "note"; index: number; text: string }
  | { type: "delete"; index: number }
  | { type: "insert"; afterIndex: number; text: string };

export interface ClipRequest {
  id: string;
  createdAt: string;
  baseVersion: number;
  appliedIn: number | null;
  items: ClipRequestItem[];
}

export interface ClipVersion {
  n: number;
  createdAt: string;
  note?: string;
  fromRequest?: string;
}

export interface ClipDetail {
  id: string;
  episodeId: string;
  label: string;
  range: [string, string];
  clip: { start: number; duration: number };
  latest: number;
  status: ClipStatus;
  versions: ClipVersion[];
  requests: ClipRequest[];
  /** 動画の置き場。baseUrl + /v{n}/clip.mp4 */
  baseUrl: string;
}

/** 字幕 1 枚。rows が画面の行にそのまま対応する */
export interface ClipSubtitle {
  index: number;
  speaker: string;
  start: number;
  end: number;
  rows: string[];
}
