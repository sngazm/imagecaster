import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { instagramToken, postClipToInstagram } from "../services/clip-post-instagram";
import type { PostContext } from "../services/clip-posts";

/**
 * Instagram へのリールの投稿。向こうのサーバーは叩かず、やり取りの形を確かめる。
 *
 * 動画はこちらから送らない。公開 URL を渡して、向こうに取りに来てもらう。処理が済むまでは
 * コンテナの番号を控えて、次の Cron に回す。
 */
describe("Instagram への切り抜きの投稿", () => {
  afterEach(() => vi.unstubAllGlobals());

  const context = (state?: unknown, extra: Record<string, unknown> = {}): PostContext => ({
    env: { ...env, INSTAGRAM_ACCESS_TOKEN: "secret-token", ...extra },
    clip: { id: "c1", episodeId: "286" } as PostContext["clip"],
    episode: { id: "286", storageKey: "k" } as PostContext["episode"],
    videoKey: "episodes/k/clips/c1/v1/portrait.mp4",
    videoUrl: "https://cast-bucket.example/episodes/k/clips/c1/v1/portrait.mp4",
    text: "基板を自作する話",
    state,
  });

  const stub = (statusCode = "FINISHED") => {
    const calls: Array<{ url: URL; body: URLSearchParams }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, body: new URLSearchParams((init?.body as string) ?? "") });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.pathname === "/me") return json({ user_id: "178" });
      if (url.pathname === "/178/media") return json({ id: "cont1" });
      if (url.pathname === "/cont1") return json({ status_code: statusCode, status: "2207026" });
      if (url.pathname === "/178/media_publish") return json({ id: "media1" });
      if (url.pathname === "/media1") return json({ permalink: "https://www.instagram.com/reel/abc/" });
      if (url.pathname === "/refresh_access_token") return json({ access_token: "fresh-token" });
      return json({ error: { message: "unknown", code: 100 } }, 400);
    });
    return calls;
  };

  it("最初の回はコンテナを作るだけ。動画は公開 URL で渡す", async () => {
    const calls = stub();
    const result = await postClipToInstagram(context());

    expect(result).toMatchObject({ done: false, state: { containerId: "cont1", userId: "178" } });
    const create = calls.find((c) => c.url.pathname === "/178/media")!;
    expect(create.url.host).toBe("graph.instagram.com");
    expect(create.body.get("media_type")).toBe("REELS");
    expect(create.body.get("video_url")).toContain("/v1/portrait.mp4");
    expect(create.body.get("caption")).toBe("基板を自作する話");
  });

  it("処理が済んでいたら公開して、投稿の URL を返す", async () => {
    const calls = stub("FINISHED");
    const state = { containerId: "cont1", userId: "178", createdAt: Date.now() };
    expect(await postClipToInstagram(context(state))).toEqual({
      done: true,
      url: "https://www.instagram.com/reel/abc/",
    });
    expect(calls.find((c) => c.url.pathname === "/178/media_publish")!.body.get("creation_id")).toBe("cont1");
  });

  it("まだ処理中なら公開せずに待つ。1 時間たっても終わらなければ失敗にする", async () => {
    const calls = stub("IN_PROGRESS");
    const state = { containerId: "cont1", userId: "178", createdAt: Date.now() };
    expect(await postClipToInstagram(context(state))).toEqual({ done: false, state });
    expect(calls.some((c) => c.url.pathname.endsWith("media_publish"))).toBe(false);

    const old = { ...state, createdAt: Date.now() - 2 * 60 * 60 * 1000 };
    await expect(postClipToInstagram(context(old))).rejects.toThrow("1 時間");
  });

  it("処理に失敗したら、向こうの理由を添えて失敗にする", async () => {
    stub("ERROR");
    const state = { containerId: "cont1", userId: "178", createdAt: Date.now() };
    await expect(postClipToInstagram(context(state))).rejects.toThrow("2207026");
  });

  it("公開までは済んでいたなら、もう一度は公開しない", async () => {
    const calls = stub("PUBLISHED");
    const state = { containerId: "cont1", userId: "178", createdAt: Date.now() };
    expect((await postClipToInstagram(context(state))).done).toBe(true);
    expect(calls.some((c) => c.url.pathname.endsWith("media_publish"))).toBe(false);
  });

  describe("トークン", () => {
    const kv = () => {
      const store = new Map<string, string>();
      return {
        store,
        get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
        put: async (key: string, value: string) => void store.set(key, value),
      } as unknown as KVNamespace & { store: Map<string, string> };
    };
    const WEEK = 7 * 24 * 60 * 60 * 1000;

    it("置き場が無ければ、secret のトークンをそのまま使う", async () => {
      const calls = stub();
      expect(await instagramToken({ ...env, INSTAGRAM_ACCESS_TOKEN: "secret-token" })).toBe("secret-token");
      expect(calls).toHaveLength(0);
    });

    it("置き場があれば、1 週間たったら更新して書き戻す", async () => {
      stub();
      const store = kv();
      const e = { ...env, INSTAGRAM_ACCESS_TOKEN: "secret-token", CLIP_SECRETS: store };

      expect(await instagramToken(e, 1000)).toBe("secret-token");
      expect(await instagramToken(e, 1000 + WEEK - 1)).toBe("secret-token");
      expect(await instagramToken(e, 1000 + WEEK + 1)).toBe("fresh-token");
      // 次からは secret ではなく、更新したほうを使う
      expect(await instagramToken(e, 1000 + WEEK + 2)).toBe("fresh-token");
    });

    it("更新に失敗しても、手元のトークンで投稿は続ける", async () => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "x" } }), { status: 400 }));
      const store = kv();
      const e = { ...env, INSTAGRAM_ACCESS_TOKEN: "secret-token", CLIP_SECRETS: store };
      await instagramToken(e, 1000);
      expect(await instagramToken(e, 1000 + WEEK + 1)).toBe("secret-token");
    });
  });
});
