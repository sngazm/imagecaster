import type { Env } from "../types";
import type { Poster, PostResult } from "./clip-posts";

/**
 * 切り抜きを Instagram にリールとして投稿する。
 *
 * 手順は公式の Content Publishing のとおり（Instagram Login の系統、graph.instagram.com）：
 *   1. コンテナを作る（media_type=REELS、video_url）。動画は向こうが video_url から取りに来るので、
 *      こちらからは送らない。R2 の公開 URL をそのまま渡す
 *   2. コンテナの status_code が FINISHED になるのを待つ。公式の目安は 1 分おき・5 分まで。
 *      Cron は 5 分おきなので、ここでは待たずに次の回へ回す
 *   3. media_publish で公開する
 *
 * 自分のアカウントにだけ出すので、アプリ審査もビジネス認証も要らない（Standard Access）。
 * プロアカウント（ビジネス / クリエイター）であること。
 */

const GRAPH = "https://graph.instagram.com";
const TOKEN_KEY = "instagram-token";

/** キャプションの上限（公式: 2200 文字） */
const MAX_CAPTION = 2200;
/** これだけ待っても処理が終わらなければ、失敗として最初からやり直す。コンテナは 24 時間で失効する */
const GIVE_UP_AFTER_MS = 60 * 60 * 1000;
/** トークンは 60 日で切れる。余裕を持って週に 1 度は更新する。発行から 24 時間は更新できない */
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

interface State {
  containerId: string;
  userId: string;
  createdAt: number;
}

interface StoredToken {
  token: string;
  refreshedAt: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) {
    const detail = json.error?.message ?? `HTTP ${res.status}`;
    // 190 はトークンが無効。放置して切れたトークンは更新できず、人が発行し直すしかない
    const hint = json.error?.code === 190 ? "（トークンが無効です。発行し直してください）" : "";
    throw new Error(`Instagram: ${detail}${hint}`);
  }
  return json;
}

/**
 * いま使うトークン。置き場（KV）があれば、古くなっていたら更新して書き戻す。
 *
 * 更新に失敗しても、手元のトークンがまだ生きていれば投稿はできる。更新の失敗で投稿まで
 * 止めない。ただし黙ってもいない（ログに残す）。
 */
export async function instagramToken(env: Env, now = Date.now()): Promise<string> {
  const kv = env.CLIP_SECRETS;
  const stored = kv ? await kv.get<StoredToken>(TOKEN_KEY, "json") : null;
  const current = stored?.token ?? env.INSTAGRAM_ACCESS_TOKEN;
  if (!current) throw new Error("Instagram のトークン（INSTAGRAM_ACCESS_TOKEN）がありません");
  if (!kv) return current;

  // 置き場に何も無ければ、secret のトークンを「いま発行された」ものとして覚える
  if (!stored) {
    await kv.put(TOKEN_KEY, JSON.stringify({ token: current, refreshedAt: now } satisfies StoredToken));
    return current;
  }
  if (now - stored.refreshedAt < REFRESH_EVERY_MS) return current;

  try {
    const fresh = await call<{ access_token: string }>(
      `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`
    );
    await kv.put(
      TOKEN_KEY,
      JSON.stringify({ token: fresh.access_token, refreshedAt: now } satisfies StoredToken)
    );
    return fresh.access_token;
  } catch (e) {
    console.error(`[instagram] トークンを更新できませんでした: ${e instanceof Error ? e.message : e}`);
    return current;
  }
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

export const postClipToInstagram: Poster = async (ctx): Promise<PostResult> => {
  const token = await instagramToken(ctx.env);
  const previous = ctx.state as State | undefined;

  if (!previous) {
    const me = await call<{ user_id: string }>(
      `${GRAPH}/me?fields=user_id&access_token=${encodeURIComponent(token)}`
    );
    const container = await call<{ id: string }>(
      `${GRAPH}/${me.user_id}/media`,
      form({
        media_type: "REELS",
        video_url: ctx.videoUrl,
        caption: [...ctx.text].slice(0, MAX_CAPTION).join(""),
        share_to_feed: "true",
        access_token: token,
      })
    );
    const state: State = { containerId: container.id, userId: me.user_id, createdAt: Date.now() };
    return { done: false, state };
  }

  const status = await call<{ status_code: string; status?: string }>(
    `${GRAPH}/${previous.containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`
  );

  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    throw new Error(`Instagram: 動画の処理に失敗しました（${status.status ?? status.status_code}）`);
  }
  if (status.status_code !== "FINISHED" && status.status_code !== "PUBLISHED") {
    if (Date.now() - previous.createdAt > GIVE_UP_AFTER_MS) {
      throw new Error("Instagram: 動画の処理が 1 時間たっても終わりません");
    }
    return { done: false, state: previous };
  }

  // 前の回が公開までは済ませたのに、結果を残す前に落ちた場合。もう一度公開すると二重に出る
  if (status.status_code === "PUBLISHED") return { done: true, url: null };

  const media = await call<{ id: string }>(
    `${GRAPH}/${previous.userId}/media_publish`,
    form({ creation_id: previous.containerId, access_token: token })
  );
  const link = await call<{ permalink?: string }>(
    `${GRAPH}/${media.id}?fields=permalink&access_token=${encodeURIComponent(token)}`
  ).catch(() => ({ permalink: undefined }));
  return { done: true, url: link.permalink ?? null };
};
