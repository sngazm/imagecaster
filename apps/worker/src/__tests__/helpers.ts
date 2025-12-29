import { SELF } from "cloudflare:test";

// テスト用のデフォルトポッドキャストID
export const TEST_PODCAST_ID = "test-podcast";

// API ベースURL
export function getApiBase(podcastId: string = TEST_PODCAST_ID): string {
  return `http://localhost/api/podcasts/${podcastId}`;
}

/**
 * テスト用ヘルパー: ポッドキャストを作成（存在しなければ）
 */
export async function ensureTestPodcast(): Promise<void> {
  // ポッドキャスト一覧を取得
  const listResponse = await SELF.fetch("http://localhost/api/podcasts");
  const { podcasts } = await listResponse.json();

  // テスト用ポッドキャストが存在しなければ作成
  const exists = podcasts.some((p: { id: string }) => p.id === TEST_PODCAST_ID);
  if (!exists) {
    await SELF.fetch("http://localhost/api/podcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: TEST_PODCAST_ID,
        title: "Test Podcast",
      }),
    });
  }
}

/**
 * テスト用ヘルパー: エピソードを作成してIDを返す
 */
export async function createTestEpisode(data: {
  title: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
  slug?: string;
}): Promise<{ id: string; slug: string }> {
  await ensureTestPodcast();

  const response = await SELF.fetch(`${getApiBase()}/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return { id: json.id, slug: json.slug };
}

/**
 * テスト用ヘルパー: テンプレートを作成してIDを返す
 */
export async function createTestTemplate(data: {
  name: string;
  content: string;
}): Promise<{ id: string }> {
  await ensureTestPodcast();

  const response = await SELF.fetch(`${getApiBase()}/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return { id: json.id };
}
