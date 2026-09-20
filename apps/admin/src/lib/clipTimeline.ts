/**
 * 切り抜きの下書きから、繋いだあとのある時刻に画面へ何が出るかを決める。
 *
 * 下書きの時刻はすべて元の音声の上の秒。ここでは区間の並びから「繋いだあとの時刻」（τ）を
 * 作り、字幕・画像・暗転をその上で決める。動画を描く側（imagecaster-video の splice.py /
 * segment.py / render.py）と同じ規則にしてある。ここで見えたものが、そのまま動画に出る。
 * 片方だけ変えないこと。
 */

import type { ClipDraft, ClipDraftCard, ClipDraftSub, ClipSpan } from "./api";
import type { ClipLayout, ClipMetrics } from "./clipGlyphs";
import { rgb } from "./clipGlyphs";

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** 0→1 を滑らかに。両端の角を取る */
export const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
/** 勢いよく入って、終わりへ向けて緩やかに止まる */
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** 行き過ぎてから少し戻る */
export const easeOutBack = (t: number) => {
  const u = clamp01(t);
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (u - 1) ** 3 + c1 * (u - 1) ** 2;
};

/** 繋いだあとの 1 区間 */
export interface Piece {
  span: ClipSpan;
  /** 繋いだあとの、この区間の頭 */
  tau: number;
  /** このあとに挟む間 */
  gap: number;
}

export interface Timeline {
  pieces: Piece[];
  /** 繋いだあとの長さ（速める前の秒） */
  duration: number;
}

/**
 * 鳴らす区間を順に並べる。
 *
 * 最後の区間のあとの間は、明示されているときだけ足す（末尾の余韻）。既定の間まで足すと、
 * どの動画も尻に無音が付く。
 */
export function buildTimeline(draft: ClipDraft): Timeline {
  const active = draft.spans.filter((s) => !s.off);
  const pieces: Piece[] = [];
  let tau = 0;
  active.forEach((span, i) => {
    const last = i === active.length - 1;
    const gap = last ? (span.gap ?? 0) : (span.gap ?? draft.gap);
    pieces.push({ span, tau, gap });
    tau += span.end - span.start + gap;
  });
  return { pieces, duration: tau };
}

/**
 * 元の音声の時刻を、繋いだあとの時刻に写す。どの区間にも入っていなければ null。
 *
 * 区間は頭を含み、尻を含まない。余白の字幕が区間の終わりちょうどから始まることがあり、
 * 尻まで含めると、その枚の 1 字目だけが区間に入って見える。
 */
export function toTau(tl: Timeline, t: number): number | null {
  for (const p of tl.pieces) {
    if (t >= p.span.start && t < p.span.end) return p.tau + (t - p.span.start);
  }
  return null;
}

/** 繋いだあとの時刻 τ に鳴っている区間。間の中なら、その手前の区間 */
export function pieceAt(tl: Timeline, tau: number): Piece | null {
  let found: Piece | null = null;
  for (const p of tl.pieces) {
    if (tau >= p.tau) found = p;
    else break;
  }
  return found;
}

/** 画面に出る字幕 1 枚と、その繋いだあとの時刻 */
export interface PlacedSub {
  sub: ClipDraftSub;
  start: number;
  end: number;
  /** 1 字ごとの読み始め（τ） */
  chars: number[];
}

export interface Placement {
  shown: PlacedSub[];
  /** 読み上げの一部だけが区間に入っている枚。区間の端が字幕の途中にある */
  partial: ClipDraftSub[];
}

/**
 * 字幕を繋いだあとの時間に置く。
 *
 * 出るのは、読み上げの時刻が全部どれかの区間に入っている枚だけ。無音を詰めた継ぎ目は
 * 字と字の間にあるので、1 枚が複数の区間にまたがるのは構わない。
 */
export function placeSubs(draft: ClipDraft, tl: Timeline): Placement {
  const shown: PlacedSub[] = [];
  const partial: ClipDraftSub[] = [];
  for (const sub of draft.subs) {
    const marks = sub.chars.length ? sub.chars : [sub.start];
    const taus = marks.map((t) => toTau(tl, t));
    const inside = taus.filter((v) => v !== null).length;
    if (inside === 0) continue;
    if (inside < taus.length) {
      if (!sub.skip) partial.push(sub);
      continue;
    }
    if (sub.skip) continue;
    const chars = taus as number[];
    // 言い終わりは、最後の字が入っている区間の中で測る。end が区間の外へはみ出して
    // いたら（余白を削った端）、区間の終わりまで
    const lastPiece = tl.pieces.find(
      (p) => marks[marks.length - 1] >= p.span.start && marks[marks.length - 1] < p.span.end
    )!;
    const end = lastPiece.tau + (Math.min(sub.end, lastPiece.span.end) - lastPiece.span.start);
    shown.push({ sub, start: chars[0], end: Math.max(end, chars[chars.length - 1]), chars });
  }
  shown.sort((a, b) => a.start - b.start);
  return { shown, partial };
}

/** その枚を画面に出しておく時間。言い終えてから少し残すが、次の枚が来たらそこで替わる */
export function displayWindow(shown: PlacedSub[], i: number, hold: number): [number, number] {
  const next = shown[i + 1];
  const end = shown[i].end + hold;
  return [shown[i].start, next ? Math.min(next.start, end) : end];
}

/** 時刻 τ に出ている枚 */
export function subAt(shown: PlacedSub[], tau: number, hold: number): PlacedSub | null {
  for (let i = 0; i < shown.length; i++) {
    const [from, to] = displayWindow(shown, i, hold);
    if (tau >= from && tau <= to) return shown[i];
    if (tau < from) break;
  }
  return null;
}

const codePoints = (s: string) => [...s].length;

/**
 * 時刻 τ までに読み終えた字数を、画面に出している文字（rows）の上で数える。
 *
 * 読み上げの時刻は元の書き起こし（of）の字に付いている。文字を直した枚では字数が
 * 変わるので、進み具合を比で写す。読んでいる最中の字は読み終えたほうに含める。
 */
export function spokenInRows(placed: PlacedSub, tau: number): number {
  const { sub } = placed;
  const shownLen = codePoints(sub.rows.join(""));
  if (sub.chars.length === 0) {
    // 元に無い、足した字幕。読み上げの時刻が無いので、出ている間に均等に進める
    const span = Math.max(placed.end - placed.start, 1e-6);
    return Math.ceil(clamp01((tau - placed.start) / span) * shownLen);
  }
  if (tau >= placed.end) return shownLen;
  let n = 0;
  while (n < placed.chars.length && tau > placed.chars[n]) n++;
  if (placed.chars.length === shownLen) return n;
  return Math.floor((n * shownLen) / placed.chars.length);
}

export interface CardState {
  card: ClipDraftCard;
  alpha: number;
  scale: number;
}

/** 時刻 τ に出ている画像。同時に 2 枚は出さない（先に始まったほうが勝つ） */
export function cardAt(
  draft: ClipDraft,
  tl: Timeline,
  tau: number,
  timing: ClipMetrics["timing"]
): CardState | null {
  const placed = draft.cards
    .map((card) => ({ card, at: toTau(tl, card.at) }))
    .filter((c): c is { card: ClipDraftCard; at: number } => c.at !== null)
    .sort((a, b) => a.at - b.at);

  for (const { card, at } of placed) {
    const dt = tau - at;
    if (dt < 0) continue;
    const holdEnd = timing.cardIn + timing.cardHold;
    let alpha = 0;
    let scale = 1;
    if (dt < timing.cardIn) {
      const u = dt / timing.cardIn;
      alpha = easeOut(u);
      scale = 0.9 + 0.1 * easeOutBack(u);
    } else if (dt < holdEnd) {
      alpha = 1;
    } else if (dt < holdEnd + timing.cardOut) {
      const u = (dt - holdEnd) / timing.cardOut;
      alpha = 1 - ease(u);
      scale = 1 - 0.05 * ease(u);
    }
    if (alpha > 0.002) return { card, alpha, scale };
  }
  return null;
}

/** 字幕を下へ避ける量（0〜1）。画像の不透明度にもう一度イージングを掛けて角を取る */
export const subtitleShiftFor = (state: CardState | null) => (state ? ease(state.alpha) : 0);

/** 冒頭と末尾の暗転（0 = 真っ暗、1 = そのまま） */
export function fadeAt(tl: Timeline, tau: number, fade: number): number {
  if (fade <= 0) return 1;
  return clamp01(Math.min(tau / fade, (tl.duration - tau) / fade));
}

/**
 * 画像を白い枠に収めて置く。枠は画像に合わせて縮める。画像は拡大しない
 */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  metrics: ClipMetrics,
  layout: ClipLayout,
  image: HTMLImageElement,
  state: CardState
): void {
  const pad = layout.card_pad;
  const fit = Math.min(
    (layout.card_w - pad * 2) / image.naturalWidth,
    (layout.card_h - pad * 2) / image.naturalHeight,
    1
  );
  const w = (Math.round(image.naturalWidth * fit) + pad * 2) * state.scale;
  const h = (Math.round(image.naturalHeight * fit) + pad * 2) * state.scale;
  const x = layout.card_cx - w / 2;
  const y = layout.card_cy - h / 2;
  const p = pad * state.scale;

  ctx.save();
  ctx.globalAlpha = state.alpha;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, layout.card_radius * state.scale);
  ctx.fillStyle = rgb(metrics.card.bg);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgb(metrics.card.edge);
  ctx.stroke();
  ctx.drawImage(image, x + p, y + p, w - p * 2, h - p * 2);
  ctx.restore();
}
