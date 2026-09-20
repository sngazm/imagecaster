import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { handleClipPosts } from "../services/clip-posts";
import type { Posters, PostContext } from "../services/clip-posts";

/**
 * 描き終わった切り抜きの投稿。
 *
 * 投稿先そのものは叩かない。ここで見るのは、投稿先を知らない骨組みのほう：
 * 時刻が来るまで出さない、投稿先ごとに結果を残す、1 つの失敗で他を止めない、
 * 失敗した先だけやり直す、途中経過を次の回へ持ち越す、諦める。
 */
describe("切り抜きの投稿", () => {
  let episodeId: string;

  beforeAll(async () => {
    const res = await SELF.fetch("http://localhost/api/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `投稿テスト ${Date.now()}`, skipTranscription: true }),
    });
    episodeId = (await res.json()).id;
  });

  const send = (method: string, path: string, body?: unknown) =>
    SELF.fetch(`http://localhost/api/episodes/${episodeId}/clips${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const of = "え、ちなみに";
  const draft = {
    gap: 0.12,
    edgeFade: 0.03,
    lead: 0.18,
    trail: 0.22,
    audio: { format: "mp3-cbr", headerBytes: 160, bitrate: 192000, sampleRate: 44100, skipSamples: 0 },
    pool: [{ start: 600, end: 700 }],
    spans: [{ id: "p1", group: "g1", start: 644, end: 650, gap: null }],
    subs: [
      {
        id: "s1", speaker: "あずま", start: 645, end: 647, of,
        chars: [...of].map((_, i) => 645 + i * 0.1), rows: [of], skip: false,
      },
    ],
    cards: [],
  };

  /** 描き終わって投稿待ちになった切り抜きを用意する */
  const rendered = async (publishAt: string, posts: Record<string, unknown> = {}) => {
    // 索引は最初の巡回で作られる。作ってからでないと、投稿待ちに載らない
    await SELF.fetch("http://localhost/api/clips/pending");
    await send("PUT", "/c1", { label: "テスト", draft });
    await send("PUT", "/c1/status", { status: "approved", publishAt, postText: "本文", posts });
    const res = await send("POST", "/c1/versions", {
      revision: 1,
      layouts: ["portrait", "landscape", "square"],
    });
    expect(res.status).toBe(201);
  };

  const getClip = async () => (await send("GET", "/c1")).json();

  const PAST = "2020-01-01T00:00:00Z";
  const ok = (url: string) => async () => ({ done: true as const, url });

  it("時刻が来るまでは出さない", async () => {
    await rendered("2999-01-01T00:00:00Z");
    let called = 0;
    await handleClipPosts(env, { bluesky: async () => (called++, { done: true, url: "x" }) });
    expect(called).toBe(0);
  });

  it("投稿先ごとのレイアウトの動画と本文を渡す", async () => {
    await rendered(PAST, { youtube: { layout: "portrait" }, bluesky: { layout: "square" } });
    const seen: PostContext[] = [];
    const spy = (url: string) => async (ctx: PostContext) => (seen.push(ctx), { done: true as const, url });
    await handleClipPosts(env, { bluesky: spy("b"), youtube: spy("y") });

    expect(seen.map((c) => c.videoKey.split("/").slice(-2).join("/"))).toEqual([
      "v1/square.mp4",
      "v1/portrait.mp4",
    ]);
    expect(seen[0].text).toBe("本文");
    expect(seen[0].videoUrl).toContain("/clips/c1/v1/square.mp4");
  });

  it("全部出たら published になり、もう呼ばれない", async () => {
    await rendered(PAST, { x: { enabled: false }, instagram: { enabled: false } });
    await handleClipPosts(env, { bluesky: ok("https://b/1"), youtube: ok("https://y/1") });

    const clip = await getClip();
    expect(clip.status).toBe("published");
    expect(clip.posts.bluesky.url).toBe("https://b/1");
    expect(clip.posts.youtube.postedAt).toBeTruthy();

    let called = 0;
    await handleClipPosts(env, { bluesky: async () => (called++, { done: true, url: "" }) });
    expect(called).toBe(0);
  });

  it("1 つ失敗しても他は出す。失敗した先だけ次の回でやり直す", async () => {
    await rendered(PAST, { x: { enabled: false }, youtube: { enabled: false } });
    let blueskyCalls = 0;
    const posters: Posters = {
      bluesky: async () => (blueskyCalls++, { done: true, url: "https://b/1" }),
      instagram: async () => {
        throw new Error("quota exceeded");
      },
    };
    await handleClipPosts(env, posters);

    let clip = await getClip();
    expect(clip.status).toBe("rendered");
    expect(clip.posts.bluesky.postedAt).toBeTruthy();
    expect(clip.posts.instagram.error).toBe("quota exceeded");
    expect(clip.posts.instagram.attempts).toBe(1);

    await handleClipPosts(env, { ...posters, instagram: ok("https://y/1") });
    clip = await getClip();
    expect(blueskyCalls).toBe(1);
    expect(clip.posts.instagram.error).toBeNull();
    expect(clip.status).toBe("published");
  });

  it("途中経過を次の回へ持ち越す", async () => {
    await rendered(PAST, { x: { enabled: false }, instagram: { enabled: false }, youtube: { enabled: false } });
    const states: unknown[] = [];
    const poster = async (ctx: PostContext) => {
      states.push(ctx.state);
      return ctx.state ? { done: true as const, url: "https://b/1" } : { done: false as const, state: { jobId: "j1" } };
    };
    await handleClipPosts(env, { bluesky: poster });
    expect((await getClip()).posts.bluesky.postedAt).toBeNull();

    await handleClipPosts(env, { bluesky: poster });
    expect(states).toEqual([undefined, { jobId: "j1" }]);
    expect((await getClip()).status).toBe("published");
  });

  it("直らない失敗は、上限で諦める", async () => {
    await rendered(PAST, { x: { enabled: false }, instagram: { enabled: false }, youtube: { enabled: false } });
    let called = 0;
    const failing: Posters = {
      bluesky: async () => {
        called++;
        throw new Error("no");
      },
    };
    for (let i = 0; i < 8; i++) await handleClipPosts(env, failing);
    expect(called).toBe(5);
    expect((await getClip()).status).toBe("rendered");
  });

  describe("手で出す投稿先", () => {
    const mark = (target: string, body: unknown) => send("POST", `/c1/posts/${target}`, body);

    it("人が出すのを待っている間、Cron はその切り抜きを見にこない", async () => {
      await rendered(PAST, { instagram: { enabled: false } });
      await handleClipPosts(env, { bluesky: ok("https://b/1") });

      // 残っているのは x と youtube（どちらも手で出す）。Cron からは外れる
      const index = JSON.parse(await (await env.R2_BUCKET.get("index.json"))!.text());
      expect(index.clipPostIds).not.toContain(`${episodeId}/c1`);
      expect((await getClip()).status).toBe("rendered");
    });

    it("出した印を付けると結果が残り、全部済めば published になる", async () => {
      await rendered(PAST, { instagram: { enabled: false } });
      await handleClipPosts(env, { bluesky: ok("https://b/1") });

      const first = await (await mark("x", { action: "done", url: "https://x.com/me/status/1" })).json();
      expect(first.posts.x.url).toBe("https://x.com/me/status/1");
      expect(first.status).toBe("rendered");

      const second = await (await mark("youtube", { action: "done" })).json();
      expect(second.posts.youtube.postedAt).toBeTruthy();
      expect(second.status).toBe("published");
    });

    it("描き終わっていないものには付けられない。変な URL も受け取らない", async () => {
      await SELF.fetch("http://localhost/api/clips/pending");
      await send("PUT", "/c2", { label: "まだ下書き", draft });
      expect((await send("POST", "/c2/posts/x", { action: "done" })).status).toBe(409);

      await rendered(PAST);
      expect((await mark("x", { action: "done", url: "javascript:alert(1)" })).status).toBe(400);
      expect((await mark("tiktok", { action: "done" })).status).toBe(400);
    });

    it("諦めた投稿先を、もう一度試させられる", async () => {
      await rendered(PAST, { x: { enabled: false }, youtube: { enabled: false }, instagram: { enabled: false } });
      let called = 0;
      const failing: Posters = {
        bluesky: async () => {
          called++;
          throw new Error("no");
        },
      };
      for (let i = 0; i < 6; i++) await handleClipPosts(env, failing);
      expect(called).toBe(5);

      expect((await mark("bluesky", { action: "retry" })).status).toBe(200);
      await handleClipPosts(env, { bluesky: ok("https://b/1") });
      expect((await getClip()).status).toBe("published");
    });
  });

  it("Worker が受け持たない投稿先には触らない", async () => {
    await rendered(PAST);
    await handleClipPosts(env, { bluesky: ok("https://b/1") });
    const clip = await getClip();
    expect(clip.posts.x.postedAt).toBeNull();
    expect(clip.posts.x.attempts ?? 0).toBe(0);
    expect(clip.status).toBe("rendered");
  });
});
