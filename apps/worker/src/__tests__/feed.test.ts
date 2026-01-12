import { describe, it, expect } from "vitest";
import { generateFeed } from "../services/feed";
import type { PodcastIndex, EpisodeMeta } from "../types";

describe("generateFeed", () => {
  const basePodcastIndex: PodcastIndex = {
    podcast: {
      title: "Test Podcast",
      description: "A test podcast",
      author: "Test Author",
      email: "test@example.com",
      language: "ja",
      category: "Technology",
      artworkUrl: "https://example.com/artwork.jpg",
      websiteUrl: "https://example.com",
      explicit: false,
      applePodcastsId: null,
      applePodcastsAutoFetch: false,
      spotifyShowId: null,
      spotifyAutoFetch: false,
    },
    episodes: [],
  };

  const baseEpisode: EpisodeMeta = {
    id: "ep-1",
    slug: "episode-1",
    title: "Episode 1",
    description: "Test episode",
    duration: 3600,
    fileSize: 50000000,
    audioUrl: "https://example.com/audio.mp3",
    sourceAudioUrl: null,
    sourceGuid: null,
    transcriptUrl: null,
    artworkUrl: null,
    skipTranscription: false,
    status: "published",
    createdAt: "2024-01-01T00:00:00.000Z",
    publishAt: "2024-01-01T00:00:00.000Z",
    publishedAt: "2024-01-01T00:00:00.000Z",
    blueskyPostText: null,
    blueskyPostEnabled: false,
    blueskyPostedAt: null,
    referenceLinks: [],
    applePodcastsUrl: null,
    spotifyUrl: null,
  };

  it("uses slug as guid when sourceGuid is not set", () => {
    const feed = generateFeed(basePodcastIndex, [baseEpisode]);

    expect(feed).toContain('<guid isPermaLink="false">episode-1</guid>');
  });

  it("uses sourceGuid as guid when it is set", () => {
    const episodeWithSourceGuid: EpisodeMeta = {
      ...baseEpisode,
      sourceGuid: "original-guid-from-rss",
    };

    const feed = generateFeed(basePodcastIndex, [episodeWithSourceGuid]);

    expect(feed).toContain(
      '<guid isPermaLink="false">original-guid-from-rss</guid>'
    );
    expect(feed).not.toContain('<guid isPermaLink="false">episode-1</guid>');
  });

  it("preserves original GUID for imported episodes", () => {
    // RSSインポート時の典型的なGUID形式をテスト
    const episodesWithGuids: EpisodeMeta[] = [
      {
        ...baseEpisode,
        id: "123",
        slug: "123",
        sourceGuid: "https://anchor.fm/podcast/episodes/ep-123",
      },
      {
        ...baseEpisode,
        id: "124",
        slug: "124",
        publishedAt: "2024-01-02T00:00:00.000Z",
        sourceGuid: "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      },
    ];

    const feed = generateFeed(basePodcastIndex, episodesWithGuids);

    expect(feed).toContain(
      '<guid isPermaLink="false">https://anchor.fm/podcast/episodes/ep-123</guid>'
    );
    expect(feed).toContain(
      '<guid isPermaLink="false">urn:uuid:550e8400-e29b-41d4-a716-446655440000</guid>'
    );
  });

  it("falls back to id when both sourceGuid and slug are missing", () => {
    const episodeWithOnlyId: EpisodeMeta = {
      ...baseEpisode,
      slug: "",
      sourceGuid: null,
    };

    const feed = generateFeed(basePodcastIndex, [episodeWithOnlyId]);

    expect(feed).toContain('<guid isPermaLink="false">ep-1</guid>');
  });
});
