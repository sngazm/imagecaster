import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { POLLING, postClipToBluesky } from "../services/clip-post-bluesky";
import type { PostContext } from "../services/clip-posts";

/**
 * Bluesky への動画つき投稿。向こうのサーバーは叩かず、やり取りの形を確かめる。
 *
 * 公式の文書で指定されている、間違えやすいところを押さえる：サービス認証の aud は
 * 動画サービスではなく自分の PDS、lxm は uploadBlob、exp は整数。動画は Content-Length つきで送る。
 */
describe("Bluesky への切り抜きの投稿", () => {
  POLLING.intervalMs = 0;
  afterEach(() => vi.unstubAllGlobals());

  const blob = { $type: "blob", ref: { $link: "bafy" }, mimeType: "video/mp4", size: 5 };

  const context = async (state?: unknown): Promise<PostContext> => {
    const videoKey = "episodes/k/clips/c1/v1/square.mp4";
    await env.R2_BUCKET.put(videoKey, "video");
    return {
      env: { ...env, BLUESKY_IDENTIFIER: "me.example", BLUESKY_PASSWORD: "app-pass" },
      clip: {
        id: "c1",
        episodeId: "286",
        posts: { bluesky: { layout: "square" } },
      } as PostContext["clip"],
      episode: { id: "286", storageKey: "k" } as PostContext["episode"],
      videoKey,
      videoUrl: `https://r2.example/${videoKey}`,
      text: "基板を自作する話 https://cast.image.club/episodes/286/",
      state,
    };
  };

  /** 呼ばれた順に記録しながら、決めた応答を返す */
  const stub = (jobStates: unknown[]) => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (init?.body instanceof ReadableStream) await new Response(init.body).arrayBuffer();

      if (url.pathname.endsWith("createSession")) {
        return json({
          accessJwt: "jwt", refreshJwt: "r", handle: "me.example", did: "did:plc:me",
          didDoc: { service: [{ id: "#atproto_pds", serviceEndpoint: "https://shiitake.host.bsky.network" }] },
        });
      }
      if (url.pathname.endsWith("getServiceAuth")) return json({ token: "service-token" });
      if (url.pathname.endsWith("uploadVideo")) return json({ jobStatus: { jobId: "j1", state: "JOB_STATE_CREATED" } });
      if (url.pathname.endsWith("getJobStatus")) return json({ jobStatus: jobStates.shift() });
      if (url.pathname.endsWith("createRecord")) return json({ uri: "at://did:plc:me/app.bsky.feed.post/3kabc" });
      return json({}, 404);
    });
    return calls;
  };

  it("上げて、処理を待って、動画つきで投稿する", async () => {
    const calls = stub([{ jobId: "j1", state: "JOB_STATE_COMPLETED", blob }]);
    const result = await postClipToBluesky(await context());

    expect(result).toEqual({ done: true, url: "https://bsky.app/profile/me.example/post/3kabc" });

    const auth = calls.find((c) => c.url.pathname.endsWith("getServiceAuth"))!;
    expect(auth.url.host).toBe("shiitake.host.bsky.network");
    expect(auth.url.searchParams.get("aud")).toBe("did:web:shiitake.host.bsky.network");
    expect(auth.url.searchParams.get("lxm")).toBe("com.atproto.repo.uploadBlob");
    expect(auth.url.searchParams.get("exp")).toMatch(/^\d+$/);

    const upload = calls.find((c) => c.url.pathname.endsWith("uploadVideo"))!;
    expect(upload.url.host).toBe("video.bsky.app");
    expect(upload.url.searchParams.get("did")).toBe("did:plc:me");
    expect((upload.init!.headers as Record<string, string>).Authorization).toBe("Bearer service-token");

    const post = JSON.parse(calls.find((c) => c.url.pathname.endsWith("createRecord"))!.init!.body as string);
    expect(post.record.embed).toEqual({
      $type: "app.bsky.embed.video",
      video: blob,
      aspectRatio: { width: 1080, height: 1080 },
    });
    // リンクは自動では付かない。バイト位置で facet を付ける
    expect(post.record.facets[0].features[0].uri).toBe("https://cast.image.club/episodes/286/");
  });

  it("処理が終わらなければ jobId を控えて次の回に回し、次の回は上げ直さない", async () => {
    {
      stub(Array(20).fill({ jobId: "j1", state: "JOB_STATE_ENCODING" }));
      expect(await postClipToBluesky(await context())).toEqual({ done: false, state: { jobId: "j1" } });

      const calls = stub([{ jobId: "j1", state: "JOB_STATE_COMPLETED", blob }]);
      const result = await postClipToBluesky(await context({ jobId: "j1" }));
      expect(result.done).toBe(true);
      expect(calls.some((c) => c.url.pathname.endsWith("uploadVideo"))).toBe(false);
    }
  });

  it("処理に失敗したら、理由を添えて失敗にする", async () => {
    stub([{ jobId: "j1", state: "JOB_STATE_FAILED", error: "unsupported_codec" }]);
    await expect(postClipToBluesky(await context())).rejects.toThrow("unsupported_codec");
  });

  it("本文は 300 字に収める", async () => {
    const calls = stub([{ jobId: "j1", state: "JOB_STATE_COMPLETED", blob }]);
    const ctx = await context();
    ctx.text = "あ".repeat(400);
    await postClipToBluesky(ctx);
    const post = JSON.parse(calls.find((c) => c.url.pathname.endsWith("createRecord"))!.init!.body as string);
    expect([...post.record.text]).toHaveLength(300);
  });
});
