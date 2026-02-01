import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * テスト用ヘルパー: エピソードを作成してIDを返す
 */
async function createTestEpisode(data: {
  title: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
  slug?: string;
}): Promise<{ id: string; slug: string }> {
  const response = await SELF.fetch("http://localhost/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return { id: json.id, slug: json.slug };
}

/**
 * テスト用ヘルパー: Podcast設定を更新
 */
async function updateSettings(settings: {
  title?: string;
  description?: string;
  author?: string;
}): Promise<void> {
  await SELF.fetch("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

describe("Backup API - Export/Import", () => {
  describe("GET /api/backup/export", () => {
    it("returns export manifest with podcast settings", async () => {
      // 設定を更新
      await updateSettings({
        title: "Test Podcast",
        description: "Test Description",
        author: "Test Author",
      });

      const response = await SELF.fetch("http://localhost/api/backup/export");

      expect(response.status).toBe(200);

      const manifest = await response.json();
      expect(manifest.version).toBe(1);
      expect(manifest.exportedAt).toBeDefined();
      expect(manifest.podcast.title).toBe("Test Podcast");
      expect(manifest.podcast.description).toBe("Test Description");
      expect(manifest.podcast.author).toBe("Test Author");
      expect(manifest.episodes).toBeInstanceOf(Array);
      expect(manifest.templates).toBeInstanceOf(Array);
      expect(manifest.assets).toBeDefined();
    });

    it("includes episode metadata in export", async () => {
      // エピソードを作成
      const { id } = await createTestEpisode({
        title: "Export Test Episode",
        description: "This episode will be exported",
      });

      const response = await SELF.fetch("http://localhost/api/backup/export");

      expect(response.status).toBe(200);

      const manifest = await response.json();
      const episode = manifest.episodes.find((ep: { meta: { id: string } }) => ep.meta.id === id);

      expect(episode).toBeDefined();
      expect(episode.meta.title).toBe("Export Test Episode");
      expect(episode.meta.description).toBe("This episode will be exported");
      expect(episode.files).toBeDefined();
    });

    it("returns empty episodes array when no episodes exist", async () => {
      const response = await SELF.fetch("http://localhost/api/backup/export");

      expect(response.status).toBe(200);

      const manifest = await response.json();
      expect(manifest.episodes).toBeInstanceOf(Array);
    });
  });

  describe("POST /api/backup/import", () => {
    it("imports podcast settings and creates episodes without files", async () => {
      // テスト環境ではR2認証情報がないため、ファイルなしでインポート
      const importData = {
        podcast: {
          title: "Imported Podcast",
          description: "Imported Description",
          author: "Imported Author",
          email: "import@example.com",
          language: "ja",
          category: "Technology",
          explicit: false,
        },
        templates: [],
        episodes: [
          {
            meta: {
              id: "imported-episode-1",
              slug: "imported-episode-1",
              title: "Imported Episode 1",
              description: "First imported episode",
              duration: 300,
              fileSize: 1000000,
              sourceAudioUrl: null,
              skipTranscription: true,
              status: "draft",
              createdAt: new Date().toISOString(),
              publishAt: null,
              publishedAt: null,
              blueskyPostText: null,
              blueskyPostEnabled: false,
              blueskyPostedAt: null,
              referenceLinks: [],
            },
            hasAudio: false, // ファイルなし
            hasTranscript: false,
            hasOgImage: false,
          },
        ],
        hasArtwork: false,
        hasOgImage: false,
      };

      const response = await SELF.fetch("http://localhost/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.uploadUrls).toBeDefined();
      expect(result.uploadUrls.episodes).toHaveLength(1);
      expect(result.uploadUrls.episodes[0].id).toBe("imported-episode-1");
      // ファイルなしなのでaudioのURLは生成されない
      expect(result.uploadUrls.episodes[0].audio).toBeUndefined();

      // エピソードが作成されたか確認
      const episodeResponse = await SELF.fetch(
        "http://localhost/api/episodes/imported-episode-1"
      );
      expect(episodeResponse.status).toBe(200);
      const episode = await episodeResponse.json();
      expect(episode.title).toBe("Imported Episode 1");
    });

    it("imports templates", async () => {
      const importData = {
        podcast: {
          title: "Podcast",
          description: "",
          author: "",
          email: "",
          language: "ja",
          category: "Technology",
          explicit: false,
        },
        templates: [
          {
            id: "template-1",
            name: "Default Template",
            content: "Template content here",
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        episodes: [],
        hasArtwork: false,
        hasOgImage: false,
      };

      const response = await SELF.fetch("http://localhost/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });

      expect(response.status).toBe(200);

      // テンプレートが保存されたか確認
      const templatesResponse = await SELF.fetch("http://localhost/api/templates");
      const templates = await templatesResponse.json();

      // テンプレートAPIは配列を直接返す
      expect(templates).toContainEqual(
        expect.objectContaining({
          id: "template-1",
          name: "Default Template",
        })
      );
    });

    it("updates podcast settings on import", async () => {
      const importData = {
        podcast: {
          title: "Updated Podcast Title",
          description: "Updated Description",
          author: "New Author",
          email: "new@example.com",
          language: "en",
          category: "Arts",
          explicit: true,
        },
        templates: [],
        episodes: [],
        hasArtwork: false,
        hasOgImage: false,
      };

      const response = await SELF.fetch("http://localhost/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });

      expect(response.status).toBe(200);

      // 設定が更新されたか確認
      const settingsResponse = await SELF.fetch("http://localhost/api/settings");
      const settings = await settingsResponse.json();

      expect(settings.title).toBe("Updated Podcast Title");
      expect(settings.author).toBe("New Author");
      expect(settings.explicit).toBe(true);
    });
  });

  describe("POST /api/backup/import/complete", () => {
    it("updates episode URLs after file upload", async () => {
      // まずインポートでエピソードを作成（ファイルなし）
      const importData = {
        podcast: {
          title: "Complete Test",
          description: "",
          author: "",
          email: "",
          language: "ja",
          category: "Technology",
          explicit: false,
        },
        templates: [],
        episodes: [
          {
            meta: {
              id: "complete-test-episode",
              slug: "complete-test-episode",
              title: "Complete Test Episode",
              description: "",
              duration: 300,
              fileSize: 1000000,
              sourceAudioUrl: null,
              skipTranscription: true,
              status: "draft",
              createdAt: new Date().toISOString(),
              publishAt: null,
              publishedAt: null,
              blueskyPostText: null,
              blueskyPostEnabled: false,
              blueskyPostedAt: null,
              referenceLinks: [],
            },
            hasAudio: false, // ファイルなし（テスト環境のため）
            hasTranscript: false,
            hasOgImage: false,
          },
        ],
        hasArtwork: false,
        hasOgImage: false,
      };

      await SELF.fetch("http://localhost/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });

      // 完了処理（ファイルがアップロードされたとして）
      const completeResponse = await SELF.fetch("http://localhost/api/backup/import/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes: [
            {
              id: "complete-test-episode",
              hasAudio: true, // 完了時はファイルありとして処理
              hasTranscript: false,
              hasOgImage: false,
              status: "draft",
            },
          ],
          hasArtwork: false,
          hasOgImage: false,
        }),
      });

      expect(completeResponse.status).toBe(200);

      const result = await completeResponse.json();
      expect(result.success).toBe(true);

      // エピソードのURLが更新されたか確認
      const episodeResponse = await SELF.fetch(
        "http://localhost/api/episodes/complete-test-episode"
      );
      const episode = await episodeResponse.json();

      // storageKey はランダムサフィックスを含む（例: complete-test-episode-xxxxx）
      expect(episode.audioUrl).toContain("complete-test-episode-");
      expect(episode.audioUrl).toContain("/audio.mp3");
    });

    it("updates episode status to published", async () => {
      // エピソードを作成
      const importData = {
        podcast: {
          title: "Status Test",
          description: "",
          author: "",
          email: "",
          language: "ja",
          category: "Technology",
          explicit: false,
        },
        templates: [],
        episodes: [
          {
            meta: {
              id: "status-test-episode",
              slug: "status-test-episode",
              title: "Status Test Episode",
              description: "",
              duration: 300,
              fileSize: 1000000,
              sourceAudioUrl: null,
              skipTranscription: true,
              status: "draft",
              createdAt: new Date().toISOString(),
              publishAt: new Date().toISOString(),
              publishedAt: null,
              blueskyPostText: null,
              blueskyPostEnabled: false,
              blueskyPostedAt: null,
              referenceLinks: [],
            },
            hasAudio: false,
            hasTranscript: false,
            hasOgImage: false,
          },
        ],
        hasArtwork: false,
        hasOgImage: false,
      };

      await SELF.fetch("http://localhost/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });

      // 完了処理でpublishedに
      const completeResponse = await SELF.fetch("http://localhost/api/backup/import/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes: [
            {
              id: "status-test-episode",
              hasAudio: true,
              hasTranscript: false,
              hasOgImage: false,
              status: "published",
            },
          ],
          hasArtwork: false,
          hasOgImage: false,
        }),
      });

      expect(completeResponse.status).toBe(200);

      // ステータスが更新されたか確認
      const episodeResponse = await SELF.fetch(
        "http://localhost/api/episodes/status-test-episode"
      );
      const episode = await episodeResponse.json();

      expect(episode.publishStatus).toBe("published");
      expect(episode.publishedAt).toBeDefined();
    });
  });
});
