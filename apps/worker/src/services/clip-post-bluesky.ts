import type { ClipLayoutName } from "../types";
import type { Poster, PostContext, PostResult } from "./clip-posts";
import { createSession, detectUrls } from "./bluesky";
import type { BlueskySession } from "./bluesky";

/**
 * 切り抜きを Bluesky に動画つきで投稿する。
 *
 * 手順は公式のチュートリアル（bsky-docs の tutorials/video）のとおり：
 *   1. アプリパスワードでログイン
 *   2. 自分の PDS あてのサービス認証トークンを貰う（動画サービスが PDS に blob を置くのに使う）
 *   3. video.bsky.app に動画を送る → jobId
 *   4. 処理が済むまで待つ → blob
 *   5. blob を埋め込んだ投稿を作る
 *
 * 4 にどれだけ掛かるかは保証が無い。少しだけ待って終わらなければ jobId を控え、次の Cron が
 * 4 から続ける。jobId さえあれば、処理の状況は認証なしで聞ける。
 */

const ENTRYWAY = "https://bsky.social";
const VIDEO_SERVICE = "https://video.bsky.app";

/**
 * 同じ回の中で処理の完了を待つ回数と間隔。待っている間は CPU 時間を使わない。
 * テストが待たずに済むよう、外から変えられる形にしてある
 */
export const POLLING = { count: 8, intervalMs: 2500 };

/** 投稿本文の上限（書記素） */
const MAX_GRAPHEMES = 300;

const SIZES: Record<ClipLayoutName, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

interface Blob {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface JobStatus {
  jobId: string;
  state: string;
  blob?: Blob;
  error?: string;
  message?: string;
}

interface State {
  jobId: string;
}

type Session = BlueskySession & {
  didDoc?: { service?: Array<{ id: string; serviceEndpoint: string }> };
};

/** 自分の PDS。bsky.social で入っても、blob が置かれるのは別のホスト */
function pdsOf(session: Session): string {
  const pds = session.didDoc?.service?.find((s) => s.id === "#atproto_pds");
  return (pds?.serviceEndpoint ?? ENTRYWAY).replace(/\/$/, "");
}

/** 応答は { jobStatus } で包まれていることも、そのまま返ることもある（文書と定義で食い違う） */
const unwrap = (json: { jobStatus?: JobStatus } & Partial<JobStatus>): JobStatus =>
  (json.jobStatus ?? json) as JobStatus;

async function upload(ctx: PostContext, session: Session): Promise<JobStatus> {
  const object = await ctx.env.R2_BUCKET.get(ctx.videoKey);
  if (!object) throw new Error(`動画がありません: ${ctx.videoKey}`);

  const pds = pdsOf(session);
  const params = new URLSearchParams({
    aud: `did:web:${new URL(pds).host}`,
    lxm: "com.atproto.repo.uploadBlob",
    // 小数だと弾かれる。1 時間を超えても弾かれる
    exp: String(Math.floor(Date.now() / 1000) + 1800),
  });
  const auth = await fetch(`${pds}/xrpc/com.atproto.server.getServiceAuth?${params}`, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
  if (!auth.ok) throw new Error(`Bluesky: サービス認証に失敗（${auth.status}）${await auth.text()}`);
  const { token } = await auth.json<{ token: string }>();

  // 数十 MB をメモリに載せない。ただの ReadableStream を渡すと chunked になるので、
  // 長さの分かっているストリームに通して Content-Length を付ける
  const fixed = new FixedLengthStream(object.size);
  const piping = object.body.pipeTo(fixed.writable);
  const name = `${ctx.clip.episodeId}-${ctx.clip.id}.mp4`;
  const res = await fetch(
    `${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=${name}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" },
      body: fixed.readable,
    }
  );
  await piping.catch(() => {});
  const json = await res.json<{ jobStatus?: JobStatus } & Partial<JobStatus>>().catch(() => ({}));
  const status = unwrap(json);
  // 同じ動画を前に上げていると already_exists のエラーになるが、blob は一緒に返る。
  // 成否にかかわらず、blob があればそれを使う
  if (!res.ok && !status.blob && !status.jobId) {
    throw new Error(`Bluesky: 動画を上げられませんでした（${res.status}）${JSON.stringify(json)}`);
  }
  return status;
}

async function jobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(
    `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`
  );
  if (!res.ok) throw new Error(`Bluesky: 処理の状況を聞けませんでした（${res.status}）`);
  return unwrap(await res.json());
}

function clip(text: string): string {
  const parts = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)];
  if (parts.length <= MAX_GRAPHEMES) return text;
  return `${parts.slice(0, MAX_GRAPHEMES - 1).map((p) => p.segment).join("")}…`;
}

async function createPost(ctx: PostContext, session: Session, blob: Blob): Promise<string> {
  const text = clip(ctx.text);
  const layout = ctx.clip.posts.bluesky.layout;
  const facets = detectUrls(text);
  const res = await fetch(`${pdsOf(session)}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        ...(facets.length ? { facets } : {}),
        langs: ["ja"],
        createdAt: new Date().toISOString(),
        embed: { $type: "app.bsky.embed.video", video: blob, aspectRatio: SIZES[layout] },
      },
    }),
  });
  if (!res.ok) throw new Error(`Bluesky: 投稿できませんでした（${res.status}）${await res.text()}`);
  const { uri } = await res.json<{ uri: string }>();
  // at://did/app.bsky.feed.post/rkey → 人が開ける URL
  return `https://bsky.app/profile/${session.handle}/post/${uri.split("/").pop()}`;
}

export const postClipToBluesky: Poster = async (ctx): Promise<PostResult> => {
  const { BLUESKY_IDENTIFIER, BLUESKY_PASSWORD } = ctx.env;
  if (!BLUESKY_IDENTIFIER || !BLUESKY_PASSWORD) {
    throw new Error("Bluesky の認証情報（BLUESKY_IDENTIFIER / BLUESKY_PASSWORD）がありません");
  }
  const session = (await createSession(BLUESKY_IDENTIFIER, BLUESKY_PASSWORD)) as Session;

  const previous = ctx.state as State | undefined;
  let status = previous?.jobId ? await jobStatus(previous.jobId) : await upload(ctx, session);

  for (let i = 0; i < POLLING.count && !status.blob; i++) {
    if (status.state === "JOB_STATE_FAILED") break;
    await new Promise((r) => setTimeout(r, POLLING.intervalMs));
    status = await jobStatus(status.jobId);
  }

  if (status.blob) return { done: true, url: await createPost(ctx, session, status.blob) };
  if (status.state === "JOB_STATE_FAILED") {
    throw new Error(`Bluesky: 動画の処理に失敗しました（${status.error ?? status.message ?? "理由不明"}）`);
  }
  return { done: false, state: { jobId: status.jobId } satisfies State };
};
