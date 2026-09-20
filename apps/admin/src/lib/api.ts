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
  transcriptCorrections?: EpisodeCorrectionRule[] | null;
  /** この回だけの話者アイコン。ゲスト回で使う */
  speakerIcons?: SpeakerIcon[] | null;
  artworkUrl: string | null;
  skipTranscription: boolean;
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
/**
 * その回の用語集の 1 語
 *
 * 校正の前に文字起こしを通して読んで集めたもの。綴りは Web で確かめたものだけ。
 */
export interface GlossaryTerm {
  term: string;
  kind?: string;
  note?: string;
  asWritten?: string;
  notable?: boolean;
  url?: string;
  evidence?: string;
  suspects?: Array<{ index: number; text: string; guess?: string }>;
}

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
 * 確認カード
 *
 * 機械が「怪しいが決められない」とした行。その区間の音を聞いて、人が決める。
 */
export interface ReviewCard {
  id: string;
  start: number;
  end: number;
  /** カードを作ったときの行の本文 */
  line: string;
  reason: string;
  /** 直したあとの行の形の候補（行まるごと） */
  candidates: string[];
  /** 校正前の音声認識の出力 */
  whisper?: string;
  source: "suspicion" | "readback";
  /** 前に人が決めた結果。取り直しで本文から消えると、これを添えてカードが戻ってくる */
  resolution?: { action: "keep" | "fix"; text: string; at: string };
  current: { start: number; end: number; text: string; speaker?: string } | null;
  before: string[];
  after: string[];
  reopened: boolean;
}

/**
 * この回かぎりの修正
 *
 * 回全体ではなく、決まった 1 箇所にだけ当たる。anchor の無いものは古い形で、
 * 次の整形のときに場所つきへ書き直される。
 */
export interface EpisodeCorrectionRule extends CorrectionRule {
  anchor?: { start: number; end: number; before: string; after: string };
  source?: "glossary" | "review" | "readback" | "suspicion" | "human";
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

export interface TranscriptRefineSettings {
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
  // 文字起こしの整形設定
  transcriptRefine?: TranscriptRefineSettings;
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

  // その回の用語集（通読が集めたもの）
  getGlossary: (id: string) =>
    request<{ terms: GlossaryTerm[]; collectedAt: string | null }>(
      `/api/episodes/${id}/glossary`
    ),

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

  // 確認カード
  getReviewCards: (id: string) =>
    request<{
      episodeId: string;
      title: string;
      audioUrl: string | null;
      cards: ReviewCard[];
      decided: number;
    }>(`/api/episodes/${id}/review-cards`),

  resolveReviewCard: (
    id: string,
    cardId: string,
    body: { action: "keep" | "fix"; text?: string; expected?: string }
  ) =>
    request<{ success: boolean; action: "keep" | "fix"; text: string; open: number }>(
      `/api/episodes/${id}/review-cards/${cardId}/resolve`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  // 押し間違いの取り消し
  undoReviewCard: (id: string, cardId: string) =>
    request<{ success: boolean; removed: number }>(
      `/api/episodes/${id}/review-cards/${cardId}/resolution`,
      { method: "DELETE" }
    ),

  getPendingReviewCards: () =>
    request<{ episodes: Array<{ episodeId: string; title: string; open: number }> }>(
      `/api/review-cards/pending`
    ),

  // 文字起こしの整形
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
  // 動画にする前に、音声と字幕で確かめて直す。描くのは OK を出したあとで、手元の
  // 道具が引き取る。docs/clip-viewer-spec.md を参照。

  /** この回の切り抜き一覧 */
  getClips: (episodeId: string) =>
    request<{ clips: ClipListEntry[] }>(`/api/episodes/${episodeId}/clips`),

  /** 切り抜き 1 本分。baseUrl + /v{n}/{layout}.mp4 が動画の URL */
  getClip: (episodeId: string, clipId: string) =>
    request<ClipDetail>(`/api/episodes/${episodeId}/clips/${clipId}`),

  /** 下書き。下書きの仕組みより前に作られた切り抜きには無い（null） */
  getClipDraft: async (episodeId: string, clipId: string): Promise<ClipDraft | null> => {
    const res = await fetch(`${API_BASE}/api/episodes/${episodeId}/clips/${clipId}/draft`, {
      credentials: "include",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("下書きを読めませんでした");
    return res.json();
  },

  /**
   * 下書きを保存する。of と chars は変えられない。ほかの画面で先に保存されていると
   * 失敗する（黙って上書きしない）
   */
  saveClipDraft: (
    episodeId: string,
    clipId: string,
    draft: Pick<ClipDraft, "revision" | "speed" | "spans" | "subs" | "cards">
  ) =>
    request<ClipDraft>(`/api/episodes/${episodeId}/clips/${clipId}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),

  /**
   * 投稿先 1 つの結果を付ける。done は「手で出した」（出した先の URL を添えられる）、
   * retry は、失敗して諦めた投稿先をもう一度試させる
   */
  markClipPost: (
    episodeId: string,
    clipId: string,
    target: ClipPostTarget,
    body: { action: "done"; url?: string } | { action: "retry" }
  ) =>
    request<ClipDetail>(`/api/episodes/${episodeId}/clips/${clipId}/posts/${target}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** OK（投稿の予定つき）/ 取り消し（draft）/ ボツ */
  setClipStatus: (
    episodeId: string,
    clipId: string,
    status: "draft" | "approved" | "rejected",
    plan?: {
      publishAt: string | null;
      postText: string;
      posts: Partial<Record<ClipPostTarget, { enabled?: boolean; layout?: ClipLayoutName }>>;
    }
  ) =>
    request<ClipDetail>(`/api/episodes/${episodeId}/clips/${clipId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, ...plan }),
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
 * 公開用の VTT と違い、時刻は秒。整形で何が変わったかを見るのに使う。
 */
export interface RawSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

/** 人が直した正解。話者分離と整形を評価するための答え合わせに使う */
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

export type ClipStatus = "draft" | "approved" | "rendered" | "published" | "rejected";
export type ClipLayoutName = "portrait" | "landscape" | "square";
export type ClipPostTarget = "bluesky" | "x" | "youtube" | "instagram";

export interface ClipListEntry {
  id: string;
  label: string;
  latest: number;
  status: ClipStatus;
}

export interface ClipPost {
  enabled: boolean;
  layout: ClipLayoutName;
  postedAt: string | null;
  url: string | null;
  error: string | null;
  attempts?: number;
}

export interface ClipVersion {
  n: number;
  createdAt: string;
  revision?: number;
  /** 置いてある動画。下書きより前の版には無く、v{n}/clip.mp4 が 1 本あるだけ */
  layouts?: ClipLayoutName[];
  note?: string;
}

export interface ClipDetail {
  id: string;
  episodeId: string;
  label: string;
  latest: number;
  status: ClipStatus;
  approvedRevision: number | null;
  versions: ClipVersion[];
  publishAt: string | null;
  postText: string;
  posts: Record<ClipPostTarget, ClipPost>;
  /** 動画の置き場。baseUrl + /v{n}/{layout}.mp4 */
  baseUrl: string;
}

/**
 * 字幕 1 枚。時刻はすべてエピソードの音声上の秒。
 *
 * of と chars は元の書き起こしから来たもので、ここでは書き換えない。直せるのは
 * rows（画面に出す文字と改行）と skip だけ
 */
export interface ClipDraftSub {
  id: string;
  speaker: string;
  start: number;
  end: number;
  of: string;
  chars: number[];
  rows: string[];
  skip: boolean;
}

export interface ClipDraftCard {
  at: number;
  word: string;
  image: string;
  source?: string;
}

/** 元の音声から取り出す 1 区間。時刻はエピソードの音声上の秒 */
export interface ClipSpan {
  id: string;
  /** AI が選んだひとまとまり。無音を詰めると 1 つのまとまりが複数の区間に割れる */
  group: string;
  start: number;
  end: number;
  /** この区間のあとに挟む間。null なら下書きの gap */
  gap: number | null;
  /** AI がそこを選んだ理由 */
  note?: string;
  /** 鳴らさない。消さずに外しておけば戻せる */
  off?: boolean;
}

/** その回の mp3 を、途中だけ取って復号するための手掛かり。手元が調べて書く */
export interface ClipAudioInfo {
  format: string;
  headerBytes: number;
  bitrate: number;
  sampleRate: number;
  skipSamples: number;
}

/**
 * 下書き。区間の並び（どこをどの順に繋ぐか）と、その範囲の字幕。
 *
 * 時刻はすべて元の音声の上の秒。繋いだあとの時刻は clipTimeline がそのつど計算する
 */
export interface ClipDraft {
  revision: number;
  /** 再生の速さ。繋いだ音声と映像を、最後に丸ごと速める */
  speed: number;
  gap: number;
  edgeFade: number;
  lead: number;
  trail: number;
  audio: ClipAudioInfo;
  /** 下書きが字幕を持っている範囲。区間の端はこの中でしか動かせない */
  pool: Array<{ start: number; end: number }>;
  /** 鳴らす順に並ぶ。元の音声での順とは限らない */
  spans: ClipSpan[];
  /** pool 全体について、元の音声の順に並ぶ */
  subs: ClipDraftSub[];
  cards: ClipDraftCard[];
}
