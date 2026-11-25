import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { handleBlueskyPosts, queueBlueskyPost } from "../services/bluesky";
import { extractOgImageUrl } from "../services/episode-page";
import { getIndex } from "../services/r2";
import type { Env, EpisodeMeta } from "../types";

/**
 * エピソードの Bluesky への投稿。Bluesky も公開サイトも叩かず、やり取りの形を確かめる。
 *
 * 押さえるところ：公開した瞬間には投稿しない。ページが出てから、そのページの OGP 画像
 * （横長）を付けて投稿する。正方形のアートワークを付けると、カードで上下が切れる。
 */
describe("エピソードの Bluesky への投稿", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SITE = "https://cast.example";
  const testEnv: Env = {
    ...env,
    WEBSITE_URL: SITE,
    BLUESKY_IDENTIFIER: "cast.example",
    BLUESKY_PASSWORD: "app-password",
  };

  const makeMeta = (slug: string, over: Partial<EpisodeMeta> = {}) =>
    ({
      id: slug,
      slug,
      storageKey: `${slug}-abc`,
      title: `#${slug} 題名`,
      description: "説明",
      publishStatus: "published",
      transcribeStatus: "skipped",
      publishedAt: new Date().toISOString(),
      artworkUrl: null,
      audioUrl: "",
      blueskyPostEnabled: true,
      blueskyPostText: "公開しました {{EPISODE_URL}}",
      blueskyPostedAt: null,
      ...over,
    }) as EpisodeMeta;

  /** 公開済みのエピソードを置いて、投稿の待ち行列に入れる */
  const seed = async (slug: string, over: Partial<EpisodeMeta> = {}) => {
    const meta = makeMeta(slug, over);
    await env.R2_BUCKET.put(`episodes/${meta.storageKey}/meta.json`, JSON.stringify(meta));
    await queueBlueskyPost(testEnv, meta);
  };

  const readMeta = async (slug: string): Promise<EpisodeMeta> =>
    (await env.R2_BUCKET.get(`episodes/${slug}-abc/meta.json`))!.json();

  const queued = async () => (await getIndex(testEnv)).blueskyPostIds ?? [];

  /** 公開サイトと Bluesky の応答を決めて、取りに行った画像と投稿された内容を記録する */
  const stub = (opts: { live: boolean; ogImage?: string | null; missingImages?: string[]; postStatus?: number }) => {
    const fetchedImages: string[] = [];
    const posts: Array<{ record: { text: string; embed?: { external: { uri: string; thumb?: unknown } } } }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/com.atproto.server.createSession")) {
        return Response.json({ did: "did:plc:test", accessJwt: "jwt" });
      }
      if (url.endsWith("/com.atproto.repo.uploadBlob")) {
        return Response.json({ blob: { $type: "blob", ref: { $link: "cid" }, mimeType: "image/jpeg", size: 3 } });
      }
      if (url.endsWith("/com.atproto.repo.createRecord")) {
        posts.push(JSON.parse(init!.body as string));
        const status = opts.postStatus ?? 200;
        return status === 200 ? Response.json({ uri: "at://post", cid: "cid" }) : new Response("no", { status });
      }
      if (/\.(jpg|png)(\?|$)/.test(url)) {
        fetchedImages.push(url);
        return opts.missingImages?.includes(url)
          ? new Response("not found", { status: 404 })
          : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      }
      // 公開サイト。まだ無いページにはトップページが 200 で返る
      const og = opts.ogImage === undefined ? `${SITE}/og/x.jpg?v=abc&amp;w=1` : opts.ogImage;
      const html = opts.live
        ? `<meta property="og:url" content="${url}">${og ? `<meta property="og:image" content="${og}">` : ""}`
        : `<html><a href="/episodes/1/">前の回</a></html>`;
      return new Response(html, { status: 200 });
    });
    return { fetchedImages, posts };
  };

  it("認証情報が無い・投稿しない設定・投稿済みなら待ち行列に入れない", async () => {
    await queueBlueskyPost({ ...testEnv, BLUESKY_PASSWORD: "" }, makeMeta("bq-nocred"));
    await queueBlueskyPost(testEnv, makeMeta("bq-off", { blueskyPostEnabled: false }));
    await queueBlueskyPost(testEnv, makeMeta("bq-notext", { blueskyPostText: null }));
    await queueBlueskyPost(testEnv, makeMeta("bq-done", { blueskyPostedAt: new Date().toISOString() }));
    expect((await queued()).filter((id) => id.startsWith("bq-"))).toEqual([]);
  });

  it("ページがまだ無ければ投稿せず、待ち行列に残す", async () => {
    await seed("bw-1");
    const { posts } = stub({ live: false });
    await handleBlueskyPosts(testEnv);

    expect(posts).toHaveLength(0);
    expect(await queued()).toContain("bw-1");
    expect((await readMeta("bw-1")).blueskyPostedAt).toBeNull();
  });

  it("ページが出たら、そのページの OGP 画像を付けて投稿する", async () => {
    await seed("bl-1", { artworkUrl: "https://r2.example/episodes/bl-1/artwork.jpg" });
    const { posts, fetchedImages } = stub({ live: true });
    await handleBlueskyPosts(testEnv);

    expect(posts).toHaveLength(1);
    expect(posts[0].record.text).toBe(`公開しました ${SITE}/episodes/bl-1`);
    expect(posts[0].record.embed?.external.thumb).toBeDefined();
    // 正方形のアートワークではなく、ページに書いてある画像（&amp; は & に戻す）
    expect(fetchedImages).toEqual([`${SITE}/og/x.jpg?v=abc&w=1`]);
    expect(await queued()).not.toContain("bl-1");
    expect((await readMeta("bl-1")).blueskyPostedAt).toBeTruthy();
  });

  it("OGP 画像が取れなければアートワークに落とす", async () => {
    const artwork = "https://r2.example/episodes/bf-1/artwork.jpg";
    await seed("bf-1", { artworkUrl: artwork });
    const { posts, fetchedImages } = stub({ live: true, missingImages: [`${SITE}/og/x.jpg?v=abc&w=1`] });
    await handleBlueskyPosts(testEnv);

    expect(fetchedImages).toEqual([`${SITE}/og/x.jpg?v=abc&w=1`, artwork]);
    expect(posts[0].record.embed?.external.thumb).toBeDefined();
  });

  it("投稿に失敗したら残して、次の回でやり直す", async () => {
    await seed("br-1");
    stub({ live: true, postStatus: 500 });
    await handleBlueskyPosts(testEnv);
    expect(await queued()).toContain("br-1");

    const { posts } = stub({ live: true });
    await handleBlueskyPosts(testEnv);
    expect(posts).toHaveLength(1);
    expect(await queued()).not.toContain("br-1");
  });

  it("24 時間たってもページが出なければ諦める", async () => {
    await seed("bx-1", { publishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
    const { posts } = stub({ live: false });
    await handleBlueskyPosts(testEnv);

    expect(posts).toHaveLength(0);
    expect(await queued()).not.toContain("bx-1");
  });

  it("待っている間に公開をやめた・投稿をやめたものは出さない", async () => {
    await seed("bc-1");
    await seed("bc-2");
    await env.R2_BUCKET.put("episodes/bc-1-abc/meta.json", JSON.stringify(makeMeta("bc-1", { publishStatus: "draft" })));
    await env.R2_BUCKET.put("episodes/bc-2-abc/meta.json", JSON.stringify(makeMeta("bc-2", { blueskyPostEnabled: false })));
    const { posts } = stub({ live: true });
    await handleBlueskyPosts(testEnv);

    expect(posts).toHaveLength(0);
    expect((await queued()).filter((id) => id.startsWith("bc-"))).toEqual([]);
  });

  it("og:image は絶対 URL だけを取り出す", () => {
    expect(extractOgImageUrl(`<meta property="og:image" content="https://a.example/og/1.jpg?v=1">`)).toBe(
      "https://a.example/og/1.jpg?v=1"
    );
    expect(extractOgImageUrl(`<meta content="https://a.example/x.jpg" property="og:image">`)).toBe(
      "https://a.example/x.jpg"
    );
    expect(extractOgImageUrl(`<meta property="og:image" content="/og/1.jpg">`)).toBeNull();
    expect(extractOgImageUrl(`<meta property="og:image:width" content="1200">`)).toBeNull();
  });
});
