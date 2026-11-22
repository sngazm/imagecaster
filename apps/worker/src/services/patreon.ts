/**
 * Patreon の新しい投稿（アフタートーク）を Discord に告知する
 *
 * Patreon には公開の RSS が無く、API を見回るにはひと月ほどで切れるトークンを更新し続ける
 * ことになる。Webhook（posts:publish）なら向こうから知らせてくるので、鍵は署名の検証に使う
 * secret ひとつで済む。
 *
 * 投稿の中身の形は公式の文書に載っていない（例があるのは会員のイベントだけ）。そのため
 * 当てにするのは投稿の id だけにして、題名や URL は入っていれば使う。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../types";
import { getIndex, saveIndex } from "./r2";
import { CONTENT_LIMIT, postToDiscord } from "./discord";

/** 告知済みの投稿をいくつ覚えておくか。二重の告知を防げれば足りる */
const REMEMBERED_POSTS = 50;

export type PatreonWebhookResult =
  | { status: "posted" | "duplicate" | "ignored" }
  | { status: "error"; httpStatus: 401 | 400 | 502 | 503; message: string };

interface PatreonPostPayload {
  data?: {
    id?: string | number;
    type?: string;
    attributes?: { title?: string | null; url?: string | null };
  };
}

/**
 * 署名の検証
 *
 * 公式の文書の通り、本文を Webhook の secret で HMAC（MD5）にかけた 16 進が
 * X-Patreon-Signature に入ってくる。
 */
export function verifyPatreonSignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("md5", secret).update(body).digest("hex"));
  const given = Buffer.from(signature.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * 投稿の URL。相対で来ても絶対で来ても、無くても、patreon.com の投稿ページにする
 */
export function patreonPostUrl(id: string, url?: string | null): string {
  if (url) {
    try {
      const resolved = new URL(url, "https://www.patreon.com");
      if (resolved.hostname === "patreon.com" || resolved.hostname.endsWith(".patreon.com")) {
        return resolved.toString();
      }
    } catch {
      // 読めない URL は id から作り直す
    }
  }
  return `https://www.patreon.com/posts/${id}`;
}

export function buildPatreonAnnouncement(id: string, title?: string | null, url?: string | null): string {
  const link = patreonPostUrl(id, url);
  const head = "Patreon に新しい投稿を公開しました";
  const lines = [head];
  if (title) {
    const room = CONTENT_LIMIT - head.length - link.length - 2;
    lines.push(title.length > room ? `${title.slice(0, room - 1)}…` : title);
  }
  lines.push(link);
  return lines.join("\n");
}

/**
 * Patreon の Webhook を受けて、新しい投稿を Discord に告知する
 *
 * 失敗を返すと Patreon が間を置いて送り直してくる（30 秒後、5 分後、…）。Discord に
 * 出せなかったときはそれに任せる。送り直しや公開のやり直しで二重に出さないよう、
 * 告知した投稿の id を index.json に控える。
 */
export async function handlePatreonWebhook(
  env: Env,
  event: string | undefined,
  signature: string | undefined,
  body: string
): Promise<PatreonWebhookResult> {
  if (!env.PATREON_WEBHOOK_SECRET || !env.DISCORD_WEBHOOK_URL) {
    return { status: "error", httpStatus: 503, message: "Patreon webhook is not configured" };
  }
  if (!verifyPatreonSignature(body, signature, env.PATREON_WEBHOOK_SECRET)) {
    return { status: "error", httpStatus: 401, message: "Invalid signature" };
  }
  // 編集や削除は告知しない
  if (event !== "posts:publish") {
    return { status: "ignored" };
  }

  let payload: PatreonPostPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: "error", httpStatus: 400, message: "Invalid JSON" };
  }
  const postId = payload.data?.id !== undefined ? String(payload.data.id) : "";
  if (!/^\d+$/.test(postId)) {
    console.error(`[Patreon] 投稿の id が読めない: ${body.slice(0, 500)}`);
    return { status: "error", httpStatus: 400, message: "Missing post id" };
  }

  const index = await getIndex(env);
  if ((index.patreonAnnouncedPostIds ?? []).includes(postId)) {
    return { status: "duplicate" };
  }

  const { title, url } = payload.data?.attributes ?? {};
  const posted = await postToDiscord(
    env.DISCORD_WEBHOOK_URL,
    buildPatreonAnnouncement(postId, title, url),
    index.podcast.artworkUrl || undefined
  );
  if (!posted) {
    return { status: "error", httpStatus: 502, message: "Failed to post to Discord" };
  }

  // Discord に出している間に index が変わっているかもしれないので読み直す
  const current = await getIndex(env);
  current.patreonAnnouncedPostIds = [...(current.patreonAnnouncedPostIds ?? []), postId].slice(-REMEMBERED_POSTS);
  await saveIndex(env, current);
  console.log(`[Patreon] 告知した: ${postId}`);

  return { status: "posted" };
}
