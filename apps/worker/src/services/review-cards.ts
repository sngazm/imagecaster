/**
 * 確認カードのロジック
 *
 * 機械が「怪しいが決められない」とした行を、人が音声を聞いて決める。ここには R2 も
 * HTTP も出てこない。届いたカードをどう混ぜるか、人の確認がまだ有効か、だけを扱う。
 */

import type { ReviewCard, TranscriptSegment } from "../types";

/** カードの時刻と本文の行を突き合わせるときの余裕（秒）。取り直しで時刻は少しずれる */
const WINDOW_TOLERANCE_SEC = 2;

/** 届いたカード（id と作成時刻はこちらで付ける） */
export type IncomingCard = Pick<
  ReviewCard,
  "start" | "end" | "line" | "reason" | "candidates" | "whisper" | "source"
>;

/** 管理画面に見せる形 */
export interface ReviewCardView extends ReviewCard {
  /** いまの本文で、この時刻にいちばん長く重なる行。無ければ null */
  current: { start: number; end: number; text: string; speaker?: string } | null;
  /** 前後の行（読む手がかり） */
  before: string[];
  after: string[];
  /**
   * 前に人が決めた結果が、取り直しなどで本文から消えている
   *
   * 「前はこう直しました」を添えて、もう一度確認してもらう。大半は 1 タップで済む
   */
  reopened: boolean;
}

function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * その時刻の本文（重なる行を繋いだもの）
 *
 * 行の区切りは整形の設定で動く。確認した 1 行が 2 行に割れていても、隣と繋がって
 * いても見つかるよう、重なる行を繋いで空白を詰めたものと比べる。
 */
export function windowText(
  segments: TranscriptSegment[],
  range: { start: number; end: number }
): string {
  return squash(
    segments
      .filter(
        (s) =>
          s.end >= range.start - WINDOW_TOLERANCE_SEC &&
          s.start <= range.end + WINDOW_TOLERANCE_SEC
      )
      .map((s) => s.text)
      .join("")
  );
}

/** 人が確認した文面が、いまの本文にまだあるか */
export function verificationHolds(card: ReviewCard, segments: TranscriptSegment[]): boolean {
  if (!card.resolution) return false;
  return windowText(segments, card).includes(squash(card.resolution.text));
}

/** まだ人が決めていないか、決めた結果が本文から消えているカード */
export function isOpen(card: ReviewCard, segments: TranscriptSegment[]): boolean {
  return !card.resolution || !verificationHolds(card, segments);
}

/**
 * 届いたカードを、いまあるカードに混ぜる
 *
 * - 人が決めたカードは残す（取り直しをまたいで持ち越す）
 * - まだ決めていない機械のカードは、届いたもので入れ替える。校正を回し直すたびに
 *   機械の見立ては変わるので、古い問いを残さない
 * - 人が確認済みの文面と同じ行について、機械がもう一度聞いてきたら捨てる
 */
export function mergeIncomingCards(
  existing: ReviewCard[],
  incoming: IncomingCard[],
  now: string,
  newId: () => string
): ReviewCard[] {
  const decided = existing.filter((card) => card.resolution);

  const alreadyVerified = (card: IncomingCard) =>
    decided.some(
      (d) =>
        d.end >= card.start - WINDOW_TOLERANCE_SEC &&
        d.start <= card.end + WINDOW_TOLERANCE_SEC &&
        squash(d.resolution?.text ?? "").includes(squash(card.line))
    );

  const seen = new Set<string>();
  const fresh: ReviewCard[] = [];

  for (const card of incoming) {
    const key = `${Math.round(card.start)}\u0000${squash(card.line)}`;
    if (seen.has(key) || alreadyVerified(card)) continue;
    seen.add(key);

    fresh.push({ ...card, id: newId(), createdAt: now });
  }

  return [...decided, ...fresh].sort((a, b) => a.start - b.start);
}

/** いちばん長く重なる行の位置。無ければ -1 */
function bestIndex(segments: TranscriptSegment[], range: { start: number; end: number }): number {
  let best = -1;
  let bestOverlap = 0;

  segments.forEach((segment, i) => {
    const overlap = Math.min(segment.end, range.end) - Math.max(segment.start, range.start);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  });

  return best;
}

/**
 * いまの行に対して出せる候補
 *
 * 戻ってきたカードは、前に人が確認した文面が第一候補（大半は 1 タップで入れ直せる）。
 * 機械の候補は、カードを作ったときから行が変わっていたらもう当てはまらないので出さない。
 */
function candidatesFor(card: ReviewCard, current: string | null): string[] {
  if (current === null) return [];

  if (card.resolution) {
    return card.resolution.text !== current ? [card.resolution.text] : [];
  }

  return current === card.line ? card.candidates : [];
}

/** 開いているカードを、いまの本文と前後の行を添えて返す */
export function openCardViews(
  cards: ReviewCard[],
  segments: TranscriptSegment[]
): ReviewCardView[] {
  return cards
    .filter((card) => isOpen(card, segments))
    .map((card) => {
      const at = bestIndex(segments, card);
      const current = at >= 0 ? segments[at] : null;

      return {
        ...card,
        candidates: candidatesFor(card, current?.text ?? null),
        current: current
          ? { start: current.start, end: current.end, text: current.text, speaker: current.speaker }
          : null,
        before: at > 0 ? segments.slice(Math.max(0, at - 2), at).map((s) => s.text) : [],
        after: at >= 0 ? segments.slice(at + 1, at + 3).map((s) => s.text) : [],
        reopened: Boolean(card.resolution),
      };
    });
}
