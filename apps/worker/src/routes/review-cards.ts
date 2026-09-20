import { Hono } from "hono";
import type { Env, EpisodeMeta, ReviewCard, ReviewCardsData, TranscriptSegment } from "../types";
import { findEpisodeBySlug, getIndex, saveEpisodeMeta, saveIndex } from "../services/r2";
import {
  anchorIncomingCorrections,
  bestOverlapping,
  getRawTranscript,
  pinnedSpan,
  refineDetailed,
  saveRefined,
  toRefineOptions,
  transcriptKeys,
} from "../services/transcript-refine";
import {
  isOpen,
  mergeIncomingCards,
  openCardViews,
  type IncomingCard,
} from "../services/review-cards";
import { validateTranscriptData } from "../services/vtt";

/**
 * 確認カード（/api/episodes/* にマウント）
 *
 * 機械が「怪しいが決められない」とした行を、人が音声を聞いて決める。描くのは管理画面、
 * カードを作るのは文字起こしを回すマシン。詳しくは features/review-cards を参照。
 */
export const reviewCards = new Hono<{ Bindings: Env }>();

/** 確認待ちの一覧（/api/review-cards/* にマウント） */
export const pendingReviewCards = new Hono<{ Bindings: Env }>();

async function readCards(env: Env, meta: EpisodeMeta): Promise<ReviewCard[]> {
  const obj = await env.R2_BUCKET.get(transcriptKeys(meta.storageKey).reviewCards);
  if (!obj) return [];

  try {
    const data = JSON.parse(await obj.text()) as ReviewCardsData;
    return Array.isArray(data.cards) ? data.cards : [];
  } catch {
    return [];
  }
}

async function writeCards(env: Env, meta: EpisodeMeta, cards: ReviewCard[]): Promise<void> {
  const data: ReviewCardsData = { cards };
  await env.R2_BUCKET.put(transcriptKeys(meta.storageKey).reviewCards, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
}

/**
 * いまの本文（この回かぎりの修正まで当てたもの）
 *
 * 公開用の transcript.json ではなく、生データから作り直す。カードで決めた直しは
 * この本文から from を探して登録するので、見せるものと登録の土台を同じにしておく。
 */
async function currentSegments(env: Env, meta: EpisodeMeta): Promise<TranscriptSegment[] | null> {
  const raw = await getRawTranscript(env, meta.storageKey);
  if (!raw || !validateTranscriptData(raw)) return null;

  const index = await getIndex(env);
  return refineDetailed(raw, toRefineOptions(index.podcast.transcriptRefine, meta)).episode
    .segments;
}

/** 確認待ちの索引（index.json の reviewCardIds）を、この回の開いている枚数に合わせる */
export async function syncReviewIndex(env: Env, episodeId: string, open: number): Promise<void> {
  const index = await getIndex(env);
  const ids = index.reviewCardIds ?? [];
  const listed = ids.includes(episodeId);

  // 変わっていなければ index.json を書き換えない
  if (listed === open > 0 && index.reviewCardIds !== undefined) return;

  index.reviewCardIds = open > 0 ? [...new Set([...ids, episodeId])] : ids.filter((id) => id !== episodeId);
  await saveIndex(env, index);
}

/**
 * 取り直しのあとに、この回の確認待ちを数え直す
 *
 * 人が決めた直しは、新しい本文に合わなければ失効する（修正規則としては消える）。
 * 確認した文面はカードに残っているので、本文から消えたものを確認待ちの一覧に戻す。
 * カードの無い回では何もしない。
 */
export async function recountAfterRetake(env: Env, meta: EpisodeMeta): Promise<void> {
  const cards = await readCards(env, meta);
  if (cards.length === 0) return;

  const segments = (await currentSegments(env, meta)) ?? [];
  const open = cards.filter((card) => isOpen(card, segments)).length;
  await syncReviewIndex(env, meta.id, open);
}

function sanitizeIncoming(input: unknown): IncomingCard[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter(
      (c) =>
        typeof c.start === "number" &&
        typeof c.end === "number" &&
        Number.isFinite(c.start) &&
        Number.isFinite(c.end) &&
        typeof c.line === "string" &&
        c.line.trim() !== ""
    )
    .map((c) => ({
      start: c.start as number,
      end: c.end as number,
      line: c.line as string,
      reason: typeof c.reason === "string" ? c.reason : "",
      candidates: Array.isArray(c.candidates)
        ? c.candidates.filter(
            (t): t is string => typeof t === "string" && t.trim() !== "" && t !== c.line
          )
        : [],
      whisper: typeof c.whisper === "string" && c.whisper ? c.whisper : undefined,
      source: c.source === "readback" ? ("readback" as const) : ("suspicion" as const),
    }));
}

/**
 * PUT /api/episodes/:id/review-cards - 機械が決められなかった箇所を受け取る
 *
 * まだ決めていない機械のカードは、届いたもので入れ替える。人が決めたカードは残し、
 * 人が確認済みの文面について機械がもう一度聞いてきたら捨てる。
 */
reviewCards.put("/:id/review-cards", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const body = await c.req.json<{ cards?: unknown }>();
  const incoming = sanitizeIncoming(body.cards);

  const merged = mergeIncomingCards(
    await readCards(c.env, meta),
    incoming,
    new Date().toISOString(),
    () => crypto.randomUUID().slice(0, 8)
  );
  await writeCards(c.env, meta, merged);

  const segments = (await currentSegments(c.env, meta)) ?? [];
  const open = merged.filter((card) => isOpen(card, segments)).length;
  await syncReviewIndex(c.env, meta.id, open);

  return c.json({ success: true, received: incoming.length, cards: merged.length, open });
});

/** GET /api/episodes/:id/review-cards - 開いているカードを、いまの本文を添えて返す */
reviewCards.get("/:id/review-cards", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const cards = await readCards(c.env, meta);
  const segments = (await currentSegments(c.env, meta)) ?? [];
  const open = openCardViews(cards, segments);

  // 取り直しで戻ってきたカードは、ここで初めて数に入る
  await syncReviewIndex(c.env, meta.id, open.length);

  return c.json({
    episodeId: meta.id,
    title: meta.title,
    audioUrl: meta.audioUrl || meta.sourceAudioUrl || null,
    cards: open,
    decided: cards.length - open.length,
  });
});

/**
 * POST /api/episodes/:id/review-cards/:cardId/resolve - 人が決めた結果を受け取る
 *
 * keep: いまの形で正しい。fix: `text`（直したあとの行の全文）にする。
 *
 * fix は、行の中でちょうど 1 箇所に決まる形の修正にして、その行の時刻で登録する。
 * 公開サイトはすぐには作り直さない。旗を立てて Cron に 1 回にまとめさせる。
 */
reviewCards.post("/:id/review-cards/:cardId/resolve", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const body = await c.req.json<{ action?: unknown; text?: unknown; expected?: unknown }>();
  const action = body.action === "fix" ? "fix" : body.action === "keep" ? "keep" : null;
  if (!action) return c.json({ error: "action は keep か fix" }, 400);

  const cards = await readCards(c.env, meta);
  const card = cards.find((x) => x.id === c.req.param("cardId"));
  if (!card) return c.json({ error: "Card not found" }, 404);

  const raw = await getRawTranscript(c.env, meta.storageKey);
  if (!raw || !validateTranscriptData(raw)) {
    return c.json({ error: "No transcript available" }, 400);
  }

  const index = await getIndex(c.env);
  const settings = index.podcast.transcriptRefine;
  const current = refineDetailed(raw, toRefineOptions(settings, meta)).episode;
  const line = bestOverlapping(current.segments, card);
  if (!line) return c.json({ error: "その時刻に行がありません" }, 409);

  // 画面を開いてから本文が変わっていたら、見ていたものと違う行を直すことになる
  if (typeof body.expected === "string" && body.expected !== line.text) {
    return c.json({ error: "本文が変わっています。読み込み直してください", current: line.text }, 409);
  }

  let verified = line.text;
  let correction: { from: string; to: string } | undefined;

  if (action === "fix") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "text が要ります" }, 400);

    const span = pinnedSpan(line.text, text);
    if (span) {
      const anchored = anchorIncomingCorrections(current.segments, [
        {
          from: span.from,
          to: span.to,
          note: card.reason || undefined,
          source: "human",
          at: { start: line.start, end: line.end },
        },
      ]);
      if (anchored.rules.length === 0) {
        return c.json({ error: "直す場所が決まりませんでした" }, 409);
      }

      correction = { from: span.from, to: span.to };
      meta.transcriptCorrections = [...current.rules, ...anchored.rules];
      await saveRefined(c.env, meta, raw, settings);
      await saveEpisodeMeta(c.env, meta);

      if (meta.publishStatus === "published" && !index.webRebuildPending) {
        const latest = await getIndex(c.env);
        latest.webRebuildPending = true;
        await saveIndex(c.env, latest);
      }
    }

    verified = text;
  }

  card.resolution = { action, text: verified, at: new Date().toISOString(), correction };
  await writeCards(c.env, meta, cards);

  const segments = (await currentSegments(c.env, meta)) ?? [];
  const open = cards.filter((x) => isOpen(x, segments)).length;
  await syncReviewIndex(c.env, meta.id, open);

  return c.json({ success: true, action, text: verified, open });
});

/**
 * DELETE /api/episodes/:id/review-cards/:cardId/resolution - 決めた結果を取り消す
 *
 * スワイプで決める画面は押し間違いが起きる。相手は公開中の本文なので、直前の判断を
 * 戻せるようにしておく。直していた場合は、そのとき登録した修正も外す。
 */
reviewCards.delete("/:id/review-cards/:cardId/resolution", async (c) => {
  const meta = await findEpisodeBySlug(c.env, c.req.param("id"));
  if (!meta) return c.json({ error: "Episode not found" }, 404);

  const cards = await readCards(c.env, meta);
  const card = cards.find((x) => x.id === c.req.param("cardId"));
  if (!card) return c.json({ error: "Card not found" }, 404);
  if (!card.resolution) return c.json({ success: true, removed: 0 });

  const made = card.resolution.correction;
  let removed = 0;

  if (made) {
    const before = meta.transcriptCorrections ?? [];
    // このカードの行に、人が入れた、同じ from / to の修正
    const remaining = before.filter(
      (rule) =>
        !(
          rule.source === "human" &&
          rule.from === made.from &&
          rule.to === made.to &&
          rule.anchor !== undefined &&
          rule.anchor.end >= card.start - 2 &&
          rule.anchor.start <= card.end + 2
        )
    );
    removed = before.length - remaining.length;

    if (removed > 0) {
      const raw = await getRawTranscript(c.env, meta.storageKey);
      if (!raw || !validateTranscriptData(raw)) {
        return c.json({ error: "No transcript available" }, 400);
      }

      const index = await getIndex(c.env);
      meta.transcriptCorrections = remaining.length > 0 ? remaining : null;
      await saveRefined(c.env, meta, raw, index.podcast.transcriptRefine);
      await saveEpisodeMeta(c.env, meta);

      if (meta.publishStatus === "published" && !index.webRebuildPending) {
        const latest = await getIndex(c.env);
        latest.webRebuildPending = true;
        await saveIndex(c.env, latest);
      }
    }
  }

  card.resolution = undefined;
  await writeCards(c.env, meta, cards);

  const segments = (await currentSegments(c.env, meta)) ?? [];
  await syncReviewIndex(c.env, meta.id, cards.filter((x) => isOpen(x, segments)).length);

  return c.json({ success: true, removed });
});

/** GET /api/review-cards/pending - 確認待ちのカードがある回の一覧 */
pendingReviewCards.get("/pending", async (c) => {
  const index = await getIndex(c.env);
  const ids = index.reviewCardIds ?? [];

  const found = await Promise.all(
    ids.map(async (id) => {
      const meta = await findEpisodeBySlug(c.env, id);
      if (!meta) return null;

      // ここでは本文を作り直さない（回の数だけ整形が走る）。まだ決めていない枚数だけ数える。
      // 取り直しで戻ってきたカードは、その回を開いたときに数に入る
      const undecided = (await readCards(c.env, meta)).filter((card) => !card.resolution).length;
      return { episodeId: meta.id, title: meta.title, open: undecided };
    })
  );

  return c.json({ episodes: found.filter((e) => e !== null) });
});
