import type { Env, ClipMeta, ClipPostTarget, EpisodeMeta } from "../types";
import { CLIP_POST_MAX_ATTEMPTS, CLIP_POST_TARGETS } from "../types";
import { clipsPrefix, readClip, saveClip } from "../routes/clips";
import { findEpisodeBySlug, getIndex } from "./r2";

/**
 * 描き終わった切り抜きを、予定の時刻に投稿する。Cron（5 分おき）から呼ばれる。
 *
 * 投稿先ごとに結果を残し、失敗した先だけ次の回でやり直す。1 つの失敗で他の投稿先を
 * 止めない。投稿先によっては、動画を上げてから処理が済むまで待つ必要があり、1 回の Cron では
 * 終わらない。そのときは途中経過（state）を控えて、次の回が続きからやる。
 *
 * ここは投稿先を知らない。知っているのは「いつ・どれを・どの形で出すか」と、結果の残し方だけ。
 * 投稿先ごとの手順は Poster に閉じ込める。
 */

export interface PostContext {
  env: Env;
  clip: ClipMeta;
  episode: EpisodeMeta;
  /** 出す動画（R2 のキーと公開 URL）。投稿先に選ばれたレイアウトのもの */
  videoKey: string;
  videoUrl: string;
  text: string;
  /** 前の回が控えた途中経過。初回は undefined */
  state: unknown;
}

export type PostResult =
  /** 出た */
  | { done: true; url: string | null }
  /** まだ途中。state を控えて次の回に続きをやる */
  | { done: false; state: unknown };

/** 投稿先 1 つぶんの手順。失敗は例外で知らせる */
export type Poster = (ctx: PostContext) => Promise<PostResult>;

export type Posters = Partial<Record<ClipPostTarget, Poster>>;

/**
 * Worker から出す投稿先。ここに無い投稿先（ブラウザを操作して出すものなど）は、
 * Worker では触らず、手元の道具が引き取る。
 */
export const workerPosters: Posters = {};

/** 投稿先を登録する。循環参照を避けるため、投稿先の側から呼ぶのではなく index.ts が繋ぐ */
export function registerPoster(target: ClipPostTarget, poster: Poster): void {
  workerPosters[target] = poster;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * 1 本の切り抜きについて、いま出せる投稿先を出す。変わったところがあれば true
 */
export async function postClip(
  env: Env,
  episode: EpisodeMeta,
  clip: ClipMeta,
  posters: Posters,
  now: Date
): Promise<boolean> {
  if (clip.status !== "rendered" || !clip.publishAt || new Date(clip.publishAt) > now) return false;

  const version = clip.versions[clip.versions.length - 1];
  let changed = false;

  for (const target of CLIP_POST_TARGETS) {
    const post = clip.posts[target];
    const poster = posters[target];
    if (!poster || !post.enabled || post.postedAt) continue;
    if ((post.attempts ?? 0) >= CLIP_POST_MAX_ATTEMPTS) continue;

    const videoKey = `${clipsPrefix(episode.storageKey)}/${clip.id}/v${version.n}/${post.layout}.mp4`;
    try {
      const result = await poster({
        env,
        clip,
        episode,
        videoKey,
        videoUrl: `${env.R2_PUBLIC_URL}/${videoKey}`,
        text: clip.postText,
        state: post.state,
      });
      if (result.done) {
        post.postedAt = now.toISOString();
        post.url = result.url;
        post.error = null;
        post.state = undefined;
      } else {
        post.state = result.state;
      }
    } catch (e) {
      post.attempts = (post.attempts ?? 0) + 1;
      post.error = message(e);
      // 途中経過は捨てる。上げた動画が向こうで失敗したのかもしれず、続きからやると同じ失敗を繰り返す
      post.state = undefined;
      console.error(`[clip-posts] ${clip.episodeId}/${clip.id} → ${target}: ${post.error}`);
    }
    changed = true;
  }

  const enabled = CLIP_POST_TARGETS.filter((t) => clip.posts[t].enabled);
  if (enabled.length > 0 && enabled.every((t) => clip.posts[t].postedAt)) {
    clip.status = "published";
    changed = true;
  }
  return changed;
}

/**
 * 投稿待ちの索引に載っているものだけを見る。全エピソードは走査しない
 */
export async function handleClipPosts(
  env: Env,
  posters: Posters = workerPosters,
  now: Date = new Date()
): Promise<void> {
  const index = await getIndex(env);
  for (const id of index.clipPostIds ?? []) {
    const [episodeId, clipId] = id.split("/");
    if (!episodeId || !clipId) continue;
    const episode = await findEpisodeBySlug(env, episodeId);
    if (!episode) continue;
    const clip = await readClip(env, episode.storageKey, clipId);
    if (!clip) continue;

    if (await postClip(env, episode, clip, posters, now)) {
      // saveClip が索引も揃える。全部出たもの・諦めたものは、ここで投稿待ちから外れる
      await saveClip(env, episode.storageKey, clip);
    }
  }
}
