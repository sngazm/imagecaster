import { describe, it, expect, afterEach, vi } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  buildAnnouncement,
  handleDiscordAnnouncements,
  queueDiscordAnnouncement,
} from "../services/discord";
import { getIndex, saveIndex } from "../services/r2";
import type { Env, EpisodeMeta } from "../types";

/**
 * Discord への新着エピソードの告知。Discord も公開サイトも叩かず、やり取りの形を確かめる。
 *
 * 押さえるところ：公開サイトは無いページにもトップページを 200 で返すので、ステータスでは
 * なく本文で「出た」を見分ける。出るまでは投稿せずに待つ。
 */
describe("Discord への新着エピソードの告知", () => {
  afterEach(() => vi.unstubAllGlobals());

  const WEBHOOK = "https://discord.test/api/webhooks/1/token";
  const testEnv: Env = { ...env, WEBSITE_URL: "https://cast.example", DISCORD_WEBHOOK_URL: WEBHOOK };

  /** 公開済みのエピソードを置いて、告知の待ち行列に入れる */
  const seed = async (slug: string, over: Partial<EpisodeMeta> = {}) => {
    const meta = {
      id: slug,
      slug,
      storageKey: `${slug}-abc`,
      title: `#${slug} 題名`,
      publishStatus: "published",
      transcribeStatus: "skipped",
      publishedAt: new Date().toISOString(),
      ...over,
    };
    await env.R2_BUCKET.put(`episodes/${meta.storageKey}/meta.json`, JSON.stringify(meta));
    await queueDiscordAnnouncement(testEnv, slug);
  };

  const readMeta = async (slug: string): Promise<EpisodeMeta> =>
    (await env.R2_BUCKET.get(`episodes/${slug}-abc/meta.json`))!.json();

  /** 公開サイトと Webhook の応答を決めて、Webhook に届いたものを記録する */
  const stub = (opts: { live: boolean; webhookStatus?: number }) => {
    const posts: Array<{ content: string; allowed_mentions: unknown; avatar_url?: string }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url === WEBHOOK) {
        posts.push(JSON.parse(init!.body as string));
        return new Response(null, { status: opts.webhookStatus ?? 204 });
      }
      // 公開サイト。まだ無いページにはトップページが 200 で返る
      const html = opts.live
        ? `<meta property="og:url" content="${url}">`
        : `<html><a href="/episodes/1/">前の回</a></html>`;
      return new Response(html, { status: 200 });
    });
    return posts;
  };

  it("Webhook が設定されていなければ待ち行列に入れない", async () => {
    await queueDiscordAnnouncement({ ...env, DISCORD_WEBHOOK_URL: undefined }, "300");
    expect((await getIndex(env)).discordAnnounceIds ?? []).toEqual([]);
  });

  it("同じ回を二重に待ち行列に入れない", async () => {
    await queueDiscordAnnouncement(testEnv, "300");
    await queueDiscordAnnouncement(testEnv, "300");
    expect((await getIndex(env)).discordAnnounceIds).toEqual(["300"]);
  });

  it("ページがまだ出ていなければ投稿せずに待つ", async () => {
    await seed("300");
    const posts = stub({ live: false });

    await handleDiscordAnnouncements(testEnv);

    expect(posts).toEqual([]);
    expect((await getIndex(env)).discordAnnounceIds).toEqual(["300"]);
    expect((await readMeta("300")).discordPostedAt).toBeUndefined();
  });

  it("ページが出たら告知して、待ち行列から外す", async () => {
    await seed("300");
    const posts = stub({ live: true });

    await handleDiscordAnnouncements(testEnv);

    expect(posts).toHaveLength(1);
    expect(posts[0].content).toBe("新しいエピソードを公開しました\n#300 題名\nhttps://cast.example/episodes/300/");
    expect(posts[0].allowed_mentions).toEqual({ parse: [] });
    // 投稿者のアイコンは番組のアートワーク。無ければ付けない
    expect(posts[0].avatar_url).toBeUndefined();
    expect((await getIndex(env)).discordAnnounceIds).toEqual([]);
    expect((await readMeta("300")).discordPostedAt).toBeTruthy();

    // 次の回でもう一度出したりしない
    await handleDiscordAnnouncements(testEnv);
    expect(posts).toHaveLength(1);
  });

  it("番組のアートワークを投稿者のアイコンにする", async () => {
    await seed("300");
    const index = await getIndex(env);
    index.podcast.artworkUrl = "https://r2.example/assets/artwork.png";
    await saveIndex(env, index);
    const posts = stub({ live: true });

    await handleDiscordAnnouncements(testEnv);

    expect(posts[0].avatar_url).toBe("https://r2.example/assets/artwork.png");
  });

  it("投稿に失敗したら残して、次の回でやり直す", async () => {
    await seed("300");
    stub({ live: true, webhookStatus: 429 });
    await handleDiscordAnnouncements(testEnv);
    expect((await getIndex(env)).discordAnnounceIds).toEqual(["300"]);

    const posts = stub({ live: true });
    await handleDiscordAnnouncements(testEnv);
    expect(posts).toHaveLength(1);
    expect((await getIndex(env)).discordAnnounceIds).toEqual([]);
  });

  it("1 日たってもページが出なければ諦める", async () => {
    await seed("300", { publishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
    const posts = stub({ live: false });

    await handleDiscordAnnouncements(testEnv);

    expect(posts).toEqual([]);
    expect((await getIndex(env)).discordAnnounceIds).toEqual([]);
  });

  it("公開をやめた回・消えた回は告知しない", async () => {
    await seed("300", { publishStatus: "draft" });
    await queueDiscordAnnouncement(testEnv, "no-such-episode");
    const posts = stub({ live: true });

    await handleDiscordAnnouncements(testEnv);

    expect(posts).toEqual([]);
    expect((await getIndex(env)).discordAnnounceIds).toEqual([]);
  });

  it("長すぎる題名は詰めて、URL は切らない", () => {
    const text = buildAnnouncement({ slug: "300", title: "あ".repeat(3000) } as EpisodeMeta, "https://cast.example/");
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith("\nhttps://cast.example/episodes/300/")).toBe(true);
  });

  describe("公開の経路", () => {
    const create = async (publishAt: string | null) => {
      const res = await SELF.fetch("http://localhost/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "告知される回", publishAt, skipTranscription: true }),
      });
      return ((await res.json()) as { id: string }).id;
    };
    const put = (id: string, body: unknown) =>
      SELF.fetch(`http://localhost/api/episodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const setMeta = async (id: string, over: Partial<EpisodeMeta>) => {
      const detail = (await (await SELF.fetch(`http://localhost/api/episodes/${id}`)).json()) as EpisodeMeta;
      await env.R2_BUCKET.put(`episodes/${detail.storageKey}/meta.json`, JSON.stringify({ ...detail, ...over }));
    };

    it("初めて公開された回が待ち行列に入る", async () => {
      const id = await create(null);
      await setMeta(id, { publishStatus: "draft" });

      const res = await put(id, { publishAt: new Date(Date.now() - 1000).toISOString() });
      expect(((await res.json()) as EpisodeMeta).publishStatus).toBe("published");

      expect((await getIndex(env)).discordAnnounceIds).toEqual([id]);
    });

    it("前に公開したことのある回（取り込んだ回・出し直した回）は入らない", async () => {
      const id = await create(null);
      await setMeta(id, { publishStatus: "draft", publishedAt: "2020-01-01T00:00:00.000Z" });

      await put(id, { publishAt: new Date(Date.now() - 1000).toISOString() });

      expect((await getIndex(env)).discordAnnounceIds ?? []).toEqual([]);
    });
  });
});
