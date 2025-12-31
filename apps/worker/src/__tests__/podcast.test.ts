import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";

// テスト用エピソード作成ヘルパー
async function createTestEpisode(data: { title: string; slug?: string }) {
  const response = await SELF.fetch("http://localhost/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return response.json() as Promise<{ id: string; slug: string }>;
}

// テスト用テンプレート作成ヘルパー
async function createTestTemplate(data: { name: string; content: string }) {
  const response = await SELF.fetch("http://localhost/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return response.json() as Promise<{ id: string }>;
}

describe("DELETE /api/podcast/reset", () => {
  beforeEach(async () => {
    // テスト前にバケットをクリア
    const listed = await env.R2_BUCKET.list();
    for (const obj of listed.objects) {
      await env.R2_BUCKET.delete(obj.key);
    }
  });

  it("deletes all data from R2 bucket", async () => {
    // テストデータを作成
    await createTestEpisode({ title: "Episode 1", slug: "episode-1" });
    await createTestEpisode({ title: "Episode 2", slug: "episode-2" });
    await createTestTemplate({ name: "Template 1", content: "Content 1" });

    // 設定を更新
    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Podcast",
        description: "Test Description",
      }),
    });

    // データが存在することを確認
    const beforeList = await env.R2_BUCKET.list();
    expect(beforeList.objects.length).toBeGreaterThan(0);

    // 全データを削除
    const response = await SELF.fetch("http://localhost/api/podcast/reset", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      success: boolean;
      message: string;
      deletedCount: number;
    };
    expect(json.success).toBe(true);
    expect(json.deletedCount).toBeGreaterThan(0);

    // データが削除されたことを確認
    const afterList = await env.R2_BUCKET.list();
    expect(afterList.objects.length).toBe(0);
  });

  it("succeeds even when bucket is empty", async () => {
    // 空のバケットで削除を実行
    const response = await SELF.fetch("http://localhost/api/podcast/reset", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      success: boolean;
      message: string;
      deletedCount: number;
    };
    expect(json.success).toBe(true);
    expect(json.deletedCount).toBe(0);
  });

  it("deletes episodes and they cannot be retrieved after", async () => {
    // エピソードを作成
    const { id } = await createTestEpisode({
      title: "Episode to Delete",
      slug: "episode-to-delete",
    });

    // エピソードが存在することを確認
    const beforeResponse = await SELF.fetch(
      `http://localhost/api/episodes/${id}`
    );
    expect(beforeResponse.status).toBe(200);

    // 全データを削除
    await SELF.fetch("http://localhost/api/podcast/reset", {
      method: "DELETE",
    });

    // エピソードが削除されたことを確認
    const afterResponse = await SELF.fetch(
      `http://localhost/api/episodes/${id}`
    );
    expect(afterResponse.status).toBe(404);
  });

  it("resets settings to default after deletion", async () => {
    // 設定を更新
    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Custom Podcast Title",
        description: "Custom Description",
        author: "Custom Author",
      }),
    });

    // 全データを削除
    await SELF.fetch("http://localhost/api/podcast/reset", {
      method: "DELETE",
    });

    // 設定がデフォルトにリセットされていることを確認
    const response = await SELF.fetch("http://localhost/api/settings");
    const settings = (await response.json()) as {
      title: string;
      description: string;
      author: string;
    };

    // デフォルト値（envから取得される）に戻っていることを確認
    expect(settings.description).toBe("");
    expect(settings.author).toBe("");
  });
});
