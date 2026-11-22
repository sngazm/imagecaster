import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { createHmac } from "node:crypto";
import { handlePatreonWebhook, patreonPostUrl, verifyPatreonSignature } from "../services/patreon";
import { getIndex } from "../services/r2";
import type { Env } from "../types";

/**
 * Patreon の新しい投稿の告知。Patreon も Discord も叩かず、やり取りの形を確かめる。
 *
 * 押さえるところ：署名は本文を secret で HMAC（MD5）にかけた 16 進。投稿の中身の形は
 * 公式の文書に無いので、id だけあれば告知できること。
 */
describe("Patreon の新しい投稿の告知", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SECRET = "whsec";
  const WEBHOOK = "https://discord.test/api/webhooks/1/token";
  const testEnv: Env = { ...env, DISCORD_WEBHOOK_URL: WEBHOOK, PATREON_WEBHOOK_SECRET: SECRET };

  const sign = (body: string) => createHmac("md5", SECRET).update(body).digest("hex");
  const post = (attributes: Record<string, unknown> = { title: "アフタートーク #300", url: "/posts/after-300-123456" }) =>
    JSON.stringify({ data: { id: "123456", type: "post", attributes } });

  const stub = (status = 204) => {
    const posts: Array<{ content: string }> = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      expect(String(input)).toBe(WEBHOOK);
      posts.push(JSON.parse(init!.body as string));
      return new Response(null, { status });
    });
    return posts;
  };

  it("署名が合えば告知する（相対の URL は patreon.com のものにする）", async () => {
    const posts = stub();
    const body = post();

    const result = await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body);

    expect(result).toEqual({ status: "posted" });
    expect(posts.map((p) => p.content)).toEqual([
      "Patreon に新しい投稿を公開しました\nアフタートーク #300\nhttps://www.patreon.com/posts/after-300-123456",
    ]);
    expect((await getIndex(env)).patreonAnnouncedPostIds).toEqual(["123456"]);
  });

  it("署名が無い・合わないものは受けない", async () => {
    const posts = stub();
    const body = post();

    expect(await handlePatreonWebhook(testEnv, "posts:publish", undefined, body)).toMatchObject({ httpStatus: 401 });
    expect(await handlePatreonWebhook(testEnv, "posts:publish", sign(body + " "), body)).toMatchObject({ httpStatus: 401 });
    expect(posts).toEqual([]);
  });

  it("同じ投稿を二度告知しない（送り直し・公開のやり直し）", async () => {
    const posts = stub();
    const body = post();

    await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body);
    const again = await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body);

    expect(again).toEqual({ status: "duplicate" });
    expect(posts).toHaveLength(1);
  });

  it("編集や削除は告知しない", async () => {
    const posts = stub();
    const body = post();

    expect(await handlePatreonWebhook(testEnv, "posts:update", sign(body), body)).toEqual({ status: "ignored" });
    expect(posts).toEqual([]);
  });

  it("Discord に出せなかったら失敗を返して、送り直しで出す", async () => {
    stub(500);
    const body = post();
    expect(await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body)).toMatchObject({ httpStatus: 502 });
    expect((await getIndex(env)).patreonAnnouncedPostIds ?? []).toEqual([]);

    const posts = stub();
    expect(await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body)).toEqual({ status: "posted" });
    expect(posts).toHaveLength(1);
  });

  it("題名も URL も無くても、id から告知できる", async () => {
    const posts = stub();
    const body = post({});

    await handlePatreonWebhook(testEnv, "posts:publish", sign(body), body);

    expect(posts[0].content).toBe("Patreon に新しい投稿を公開しました\nhttps://www.patreon.com/posts/123456");
  });

  it("設定が無ければ受けない", async () => {
    const body = post();
    const result = await handlePatreonWebhook({ ...env, PATREON_WEBHOOK_SECRET: undefined }, "posts:publish", sign(body), body);
    expect(result).toMatchObject({ httpStatus: 503 });
  });

  it("patreon.com 以外の URL は使わない", () => {
    expect(patreonPostUrl("1", "https://evil.example/posts/1")).toBe("https://www.patreon.com/posts/1");
    expect(patreonPostUrl("1", "https://www.patreon.com/posts/x-1")).toBe("https://www.patreon.com/posts/x-1");
  });

  it("署名は大文字で来ても通す", () => {
    expect(verifyPatreonSignature("a", sign("a").toUpperCase(), SECRET)).toBe(true);
  });
});
