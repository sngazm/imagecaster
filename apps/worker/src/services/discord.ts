/**
 * Discord への新着エピソードの告知
 *
 * 公開した瞬間には出さない。公開サイトは静的ビルドなので、公開から数分はエピソードの
 * ページがまだ無い。その間に URL を貼ると、押した人には何も出ず、Discord が作るリンクの
 * カードも空のまま固まる。
 *
 * そこで公開の時点では待ち行列（index.json の discordAnnounceIds）に入れるだけにして、
 * Cron がページが出たのを確かめてから Webhook に投げる。
 */

import type { Env, EpisodeMeta } from "../types";
import { getIndex, saveIndex, findEpisodeBySlug, saveEpisodeMeta } from "./r2";

/** ページが出ないまま、これだけ経ったら諦める。古い回を後から告知しないため */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Discord の本文の上限 */
export const CONTENT_LIMIT = 2000;

/**
 * エピソードの公開ページの URL（公開サイトの正規の形に合わせて末尾に / を付ける）
 */
export function episodePageUrl(websiteUrl: string, slug: string): string {
  return `${websiteUrl.replace(/\/+$/, "")}/episodes/${slug}/`;
}

/**
 * 初めて公開されたエピソードを、告知の待ち行列に入れる
 *
 * Webhook が設定されていなければ何もしない（待ち行列が溜まり続けるのを避ける）。
 */
export async function queueDiscordAnnouncement(env: Env, episodeId: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;

  const index = await getIndex(env);
  const ids = index.discordAnnounceIds ?? [];
  if (ids.includes(episodeId)) return;

  index.discordAnnounceIds = [...ids, episodeId];
  await saveIndex(env, index);
}

/**
 * エピソードのページが公開サイトに出ているか
 *
 * 公開サイトは存在しないパスにもトップページを 200 で返すので、ステータスでは分からない。
 * 本文にそのエピソード自身の URL（og:url）が入っているかで見分ける。
 */
export async function isEpisodePageLive(websiteUrl: string, slug: string): Promise<boolean> {
  try {
    const response = await fetch(episodePageUrl(websiteUrl, slug));
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes(`/episodes/${slug}/"`);
  } catch (err) {
    console.error(`[Discord] ページの確認に失敗: ${slug}`, err);
    return false;
  }
}

/**
 * 告知の本文
 */
export function buildAnnouncement(meta: EpisodeMeta, websiteUrl: string): string {
  const url = episodePageUrl(websiteUrl, meta.slug);
  const head = "新しいエピソードを公開しました";
  // URL は切らない。長すぎるときはタイトルの方を詰める
  const room = CONTENT_LIMIT - head.length - url.length - 2;
  const title = meta.title.length > room ? `${meta.title.slice(0, room - 1)}…` : meta.title;
  return `${head}\n${title}\n${url}`;
}

/**
 * Webhook に投稿する
 *
 * avatarUrl を渡すと、その画像を投稿者のアイコンにする（番組のアートワークを渡す）。
 * 無ければ Discord 側で Webhook に付けたアイコンのまま出る。
 */
export async function postToDiscord(webhookUrl: string, content: string, avatarUrl?: string): Promise<boolean> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      // タイトルに @everyone などが紛れていても、誰にも通知を飛ばさない
      allowed_mentions: { parse: [] },
      ...(avatarUrl && { avatar_url: avatarUrl }),
    }),
  });

  if (!response.ok) {
    // Webhook の URL はそれ自体が鍵なので、ログには出さない
    console.error(`[Discord] 投稿に失敗: ${response.status} - ${await response.text()}`);
    return false;
  }
  return true;
}

/**
 * Cron 処理: 待ち行列のエピソードのうち、ページが出たものを告知する
 *
 * ページがまだ無いもの・投稿に失敗したものは残して、次の回でやり直す。
 */
export async function handleDiscordAnnouncements(env: Env): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;

  const index = await getIndex(env);
  const ids = index.discordAnnounceIds ?? [];
  if (ids.length === 0) return;

  const now = new Date();
  const settled: string[] = [];

  for (const id of ids) {
    const meta = await findEpisodeBySlug(env, id);

    // 消された・公開をやめた・すでに出したものは待たない
    if (!meta || meta.publishStatus !== "published" || meta.discordPostedAt) {
      settled.push(id);
      continue;
    }

    const publishedAt = meta.publishedAt ? new Date(meta.publishedAt).getTime() : now.getTime();
    const expired = now.getTime() - publishedAt > GIVE_UP_AFTER_MS;

    const live = await isEpisodePageLive(env.WEBSITE_URL, meta.slug);
    const posted = live && (await postToDiscord(
        env.DISCORD_WEBHOOK_URL,
        buildAnnouncement(meta, env.WEBSITE_URL),
        index.podcast.artworkUrl || undefined
      ));

    if (posted) {
      meta.discordPostedAt = now.toISOString();
      await saveEpisodeMeta(env, meta);
      settled.push(id);
      console.log(`[Discord] 告知した: ${id}`);
    } else if (expired) {
      settled.push(id);
      console.error(`[Discord] 24 時間たっても出せなかったので諦める: ${id}（ページ: ${live ? "あり" : "なし"}）`);
    } else {
      console.log(`[Discord] 次の回に持ち越す: ${id}（ページ: ${live ? "あり" : "なし"}）`);
    }
  }

  if (settled.length === 0) return;

  // 確認している間に別の公開で待ち行列が増えているかもしれないので読み直す
  const current = await getIndex(env);
  current.discordAnnounceIds = (current.discordAnnounceIds ?? []).filter((id) => !settled.includes(id));
  await saveIndex(env, current);
}
