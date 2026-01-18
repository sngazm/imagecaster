export interface ReferenceLink {
  url: string;
  title: string;
}

export interface TranscriptSegment {
  start: string;  // "00:00:05"
  text: string;
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
  status: string;
  createdAt: string;
  publishAt: string;
  publishedAt: string | null;
  referenceLinks?: ReferenceLink[];
  applePodcastsUrl?: string | null;
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
}

export interface PodcastIndex {
  podcast: PodcastInfo;
  episodes: Array<{
    id: string;
  }>;
}
