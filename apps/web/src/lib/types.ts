export interface ReferenceLink {
  url: string;
  title: string;
}

export interface TranscriptSegment {
  start: string;  // "00:00:05"
  text: string;
  speaker?: string;  // 話者名（音量ベースの話者分離が有効な場合のみ）
}

export type PublishStatus = "new" | "uploading" | "draft" | "scheduled" | "published";
export type TranscribeStatus = "none" | "pending" | "transcribing" | "completed" | "failed" | "skipped";

/**
 * 話者のアイコン
 *
 * 文字起こしで名前の代わりに出す。番組の既定に、その回のぶんを足す。
 */
export interface SpeakerIcon {
  name: string;
  url: string;
}

export interface Episode {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照の音声URL（RSSインポート時）
  transcriptUrl: string | null;
  artworkUrl: string | null;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  createdAt: string;
  publishAt: string;
  publishedAt: string | null;
  referenceLinks?: ReferenceLink[];
  applePodcastsUrl?: string | null;
  /** Claude が書いたエピソードの感想 */
  claudeImpression?: string | null;
  claudeImpressionAt?: string | null;
  /** この回だけの話者アイコン。ゲスト回で使う */
  speakerIcons?: SpeakerIcon[] | null;
}

export interface PodcastInfo {
  title: string;
  description: string;
  author: string;
  email: string;
  language: string;
  category: string;
  artworkUrl: string;
  websiteUrl: string;
  explicit: boolean;
  // 購読リンク
  applePodcastsUrl?: string;
  spotifyUrl?: string;
  /** 話者のアイコン。番組の既定。エピソード側で上書きできる */
  speakerIcons?: SpeakerIcon[];
}

export interface PodcastIndex {
  podcast: PodcastInfo;
  episodes: Array<{
    id: string;
    storageKey: string; // R2ディレクトリ名（推測不能）
  }>;
}
