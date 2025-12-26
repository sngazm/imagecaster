export interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  transcriptUrl: string | null;
  status: string;
  createdAt: string;
  publishAt: string;
  publishedAt: string | null;
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
}

export interface PodcastIndex {
  podcast: PodcastInfo;
  episodes: Array<{
    id: string;
    episodeNumber: number;
  }>;
}
