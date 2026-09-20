/**
 * 切り抜きの字幕を、動画と同じ座標に置く。
 *
 * 行をまるごと fillText に渡してはいけない。ブラウザは約物の連続を勝手に詰め、
 * 行の幅を整数に丸め、その挙動がブラウザごとに違う。動画を描く Pillow とも合わない
 * （「（笑）。、。」「」で 170px ずれる）。だから字の位置をエンジンに決めさせない。
 * フォントの送り幅表から x を出し、1 字ずつそこへ置く。
 *
 * 式は生成側（imagecaster-video の glyphs.py と render.py の _subtitle）と揃えてある。
 * 片方だけ変えないこと。変えたら向こうの scripts/glyph-parity.py で差分を見る。
 * 数値は向こうの `clip metrics` が書き出した clip-metrics.json から読む。書き写さない。
 */

export interface ClipLayout {
  width: number;
  height: number;
  char_size: number;
  char_bottom: number;
  char_cx_left: number;
  char_cx_right: number;
  card_cx: number;
  card_cy: number;
  card_w: number;
  card_h: number;
  card_radius: number;
  card_pad: number;
  sub_center_y: number;
  sub_bottom: number;
  sub_max_w: number;
  sub_size: number;
  sub_line_gap: number;
  sub_stroke: number;
}

export interface ClipMetrics {
  units: number;
  ascent: number;
  maxEm: number;
  /** 送り幅が 1em の字。コードポイントの範囲 [lo, hi] */
  full: [number, number][];
  /** それ以外の字。コードポイント → 送り幅 */
  other: Record<string, number>;
  text: number[];
  speakers: Record<string, number[]>;
  unknownSpeaker: number[];
  /** 背景の上端と下端の色 */
  background: number[][];
  card: { bg: number[]; edge: number[] };
  /** 出入りの秒数 */
  timing: {
    subHold: number;
    cardIn: number;
    cardHold: number;
    cardOut: number;
    fade: number;
    /** 本編のあとに出す、サムネイルとエピソード名のカードの長さ */
    endCard: number;
  };
  layouts: Record<string, ClipLayout>;
}

export type Rgb = readonly number[];

const ATTACHES = /^[\p{Mn}\p{Me}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]$/u;

/**
 * 画面の上で 1 字として置く単位に分ける。結合文字と異体字セレクタは前の字に付ける。
 *
 * Intl.Segmenter に任せない。絵文字の連結など、生成側で再現しきれない規則まで
 * 入ってきて、分け方が食い違う。
 */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (out.length && ATTACHES.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export class GlyphTable {
  private readonly other: Map<number, number>;

  constructor(readonly metrics: ClipMetrics) {
    this.other = new Map(Object.entries(metrics.other).map(([cp, w]) => [Number(cp), w]));
  }

  /** フォントにある字の送り幅。無ければ undefined */
  private lookup(g: string): number | undefined {
    const cp = g.codePointAt(0)!;
    const w = this.other.get(cp);
    if (w !== undefined) return w;
    const full = this.metrics.full;
    let lo = 0;
    let hi = full.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < full[mid][0]) hi = mid - 1;
      else if (cp > full[mid][1]) lo = mid + 1;
      else return this.metrics.units;
    }
    return undefined;
  }

  /** 1 字の送り幅。表に無い字は 1em として置く */
  advance(g: string): number {
    return this.lookup(g) ?? this.metrics.units;
  }

  /** フォントに無い字。環境によって別のフォントで描かれ、見た目が揃わない */
  missing(text: string): string[] {
    return graphemes(text).filter((g) => this.lookup(g) === undefined);
  }

  /** 行の幅（em）。レイアウトに依らない */
  rowEm(row: string): number {
    let sum = 0;
    for (const g of graphemes(row)) sum += this.advance(g);
    return sum / this.metrics.units;
  }

  overflows(row: string): boolean {
    return this.rowEm(row) > this.metrics.maxEm;
  }

  /** 幅 width の中央に寄せたときの、各字と x */
  place(row: string, size: number, width: number): [string, number][] {
    const gs = graphemes(row);
    const units = this.metrics.units;
    let sum = 0;
    for (const g of gs) sum += this.advance(g);
    let x = (width - (sum * size) / units) / 2;
    const out: [string, number][] = [];
    for (const g of gs) {
      out.push([g, x]);
      x += (this.advance(g) * size) / units;
    }
    return out;
  }
}

/** これから読む字の色。フチの色に字の色を 175/255 だけ混ぜた、不透明な色 */
export function dimColor(edge: Rgb, text: Rgb): number[] {
  return edge.map((e, i) => pyRound(e + ((text[i] - e) * 175) / 255));
}

/** Python の round()（偶数丸め）。色や座標の丸めを向こうと 1 も違えないため */
function pyRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

export const SUBTITLE_FONT_FAMILY = "Noto Sans JP";

export function subtitleFont(size: number, weight: number): string {
  return `${weight} ${size}px "${SUBTITLE_FONT_FAMILY}"`;
}

/** 字幕 1 枚が占める箱。生成側が 1 枚の画像として作って貼るのと同じ形 */
export function subtitleBox(layout: ClipLayout, rowCount: number) {
  const rowH = layout.sub_size + layout.sub_line_gap;
  const pad = layout.sub_stroke * 3;
  const width = layout.sub_max_w + pad * 2;
  const height = rowH * rowCount + pad * 2;
  return { rowH, pad, width, height, left: Math.floor((layout.width - width) / 2) };
}

/**
 * 箱の上端。ふだんは画面の真ん中、画像カードが出ている間（shift = 1）は下へ避ける。
 */
export function subtitleTop(layout: ClipLayout, rowCount: number, shift: number): number {
  const { height } = subtitleBox(layout, rowCount);
  const middle = layout.sub_center_y - Math.floor(height / 2);
  const lowered = layout.sub_bottom - height;
  return pyRound(middle + (lowered - middle) * shift);
}

export interface DrawSubtitleOptions {
  rows: string[];
  layout: ClipLayout;
  /** フチの色（話者の色） */
  edge: Rgb;
  /** 読み終えた文字数。rows を連ねた文字列の、コードポイントでの数 */
  spoken: number;
  /** 0 = 真ん中、1 = 画像カードを避けて下 */
  shift?: number;
}

/**
 * 字幕 1 枚を、レイアウトの原寸の座標で描く。縮めて見せるときは呼ぶ側が
 * ctx.scale を掛けておく。
 */
export function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  table: GlyphTable,
  { rows, layout, edge, spoken, shift = 0 }: DrawSubtitleOptions,
): void {
  const m = table.metrics;
  const box = subtitleBox(layout, rows.length);
  const top = subtitleTop(layout, rows.length, shift);
  const size = layout.sub_size;

  ctx.save();
  ctx.font = subtitleFont(size, 700);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fontKerning = "none";
  ctx.lineJoin = "round";
  ctx.lineWidth = layout.sub_stroke * 2;

  const placed = rows.map((row, r) => ({
    base: top + box.pad + r * box.rowH + (m.ascent * size) / m.units,
    glyphs: table.place(row, size, box.width),
  }));

  // フチを全部置いてから本体を置く。1 字ずつ交互に描くと、隣の字のフチが
  // 手前の字の本体に乗る
  ctx.strokeStyle = ctx.fillStyle = rgb(edge);
  for (const { base, glyphs } of placed) {
    for (const [g, x] of glyphs) {
      ctx.strokeText(g, box.left + x, base);
      ctx.fillText(g, box.left + x, base);
    }
  }

  // 結合文字を抱えた字は、全部読み終えてから白くする
  const bright = rgb(m.text);
  const dim = rgb(dimColor(edge, m.text));
  let idx = 0;
  for (const { base, glyphs } of placed) {
    for (const [g, x] of glyphs) {
      idx += [...g].length;
      ctx.fillStyle = idx <= spoken ? bright : dim;
      ctx.fillText(g, box.left + x, base);
    }
  }
  ctx.restore();
}
