import { useEffect, useRef } from "react";
import type { ClipDraft, ClipLayoutName } from "../../lib/api";
import {
  GlyphTable,
  SUBTITLE_FONT_FAMILY,
  drawSubtitle,
  rgb,
  subtitleBox,
  subtitleFont,
  subtitleTop,
} from "../../lib/clipGlyphs";
import type { ClipLayout } from "../../lib/clipGlyphs";
import { cardAt, drawCard, fadeAt, spokenInRows, subAt, subtitleShiftFor } from "../../lib/clipTimeline";
import type { PlacedSub, Timeline } from "../../lib/clipTimeline";

/**
 * 動画になったときの画面を、canvas にそのまま描く。
 *
 * 字幕と画像は、動画を描く側と同じ式で同じ座標に置く（clipGlyphs / clipTimeline）。
 * 人物と背景は描かない。代わりに、人物が占める場所と投稿先の UI がかぶる場所を
 * 線で示す。字幕や画像がそこへ入り込んでいないかを見るための線。
 */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&display=swap";

function ensureFontStylesheet() {
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

/**
 * 投稿先の UI がかぶる場所（画面に対する比）。縦長の動画は、右にボタンの列、下に
 * 説明文が重なる。各サービスの公式な数値ではなく、広めに取った目安。投稿したものを
 * 実機で見て、合っていなければここを直す
 */
const PLATFORM_UI: Partial<Record<ClipLayoutName, { right: number; bottom: number }>> = {
  portrait: { right: 0.16, bottom: 0.2 },
};

interface Props {
  draft: ClipDraft;
  timeline: Timeline;
  shown: PlacedSub[];
  table: GlyphTable;
  layoutName: ClipLayoutName;
  /** いまの再生位置（繋いだあとの秒）を返す。毎フレーム呼ぶ */
  getTime: () => number;
  showGuides: boolean;
}

export function ClipStage({ draft, timeline, shown, table, layoutName, getTime, showGuides }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  // 描画ループは 1 本だけ回し、いつも最新の値を読む。値が変わるたびに回し直すと
  // 文字を 1 字打つごとにループが作り直される
  const latest = useRef({ draft, timeline, shown, table, layoutName, getTime, showGuides });
  latest.current = { draft, timeline, shown, table, layoutName, getTime, showGuides };

  useEffect(ensureFontStylesheet, []);

  // 出てくる字のフォントを先に読む。Google Fonts は字の範囲ごとに分かれて届くので、
  // 使う字を渡して必要な分だけ読ませる。読めていない字は別のフォントで描かれてしまう
  const text = draft.subs.map((s) => s.rows.join("")).join("");
  useEffect(() => {
    document.fonts.load(subtitleFont(68, 700), text || "あ").catch(() => {});
  }, [text]);

  useEffect(() => {
    for (const card of draft.cards) {
      if (images.current.has(card.image)) continue;
      const img = new Image();
      img.src = card.image;
      images.current.set(card.image, img);
    }
  }, [draft.cards]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { table, layoutName } = latest.current;
      const layout = table.metrics.layouts[layoutName];

      // 見た目の大きさに合わせて解像度を決める。原寸（1080 幅）で持つと、スマホで
      // 毎フレーム描くには重い
      const cssWidth = canvas.clientWidth;
      if (cssWidth === 0) return;
      const ratio = (cssWidth * Math.min(window.devicePixelRatio || 1, 2)) / layout.width;
      const w = Math.round(layout.width * ratio);
      const h = Math.round(layout.height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(ctx, layout, latest.current, images.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const layout = table.metrics.layouts[layoutName];
  return (
    <canvas
      ref={canvasRef}
      className="block w-full rounded"
      style={{ aspectRatio: `${layout.width} / ${layout.height}`, fontFamily: SUBTITLE_FONT_FAMILY }}
    />
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  layout: ClipLayout,
  { draft, timeline, shown, table, layoutName, getTime, showGuides }: Props,
  images: Map<string, HTMLImageElement>
) {
  const m = table.metrics;
  const tau = getTime();
  const bg = ctx.createLinearGradient(0, 0, 0, layout.height);
  bg.addColorStop(0, rgb(m.background[0]));
  bg.addColorStop(1, rgb(m.background[1]));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (showGuides) paintGuides(ctx, layout, layoutName);

  const card = cardAt(draft, timeline, tau, m.timing);
  if (card) {
    const img = images.get(card.card.image);
    if (img?.complete && img.naturalWidth > 0) drawCard(ctx, m, layout, img, card);
  }

  const placed = subAt(shown, tau, m.timing.subHold);
  const shift = subtitleShiftFor(card);
  if (placed) {
    if (showGuides) paintSubtitleLimit(ctx, layout, placed.sub.rows.length, shift);
    drawSubtitle(ctx, table, {
      rows: placed.sub.rows,
      layout,
      edge: m.speakers[placed.sub.speaker] ?? m.unknownSpeaker,
      spoken: spokenInRows(placed, tau),
      shift,
    });
  }

  const fade = fadeAt(timeline, tau, m.timing.fade);
  if (fade < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }
}

const GUIDE = "rgba(255,255,255,0.28)";
const GUIDE_WARN = "rgba(251,191,36,0.55)";

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = `500 24px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function paintGuides(ctx: CanvasRenderingContext2D, layout: ClipLayout, name: ClipLayoutName) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);

  // 画像カードが入る枠
  ctx.strokeStyle = GUIDE;
  ctx.strokeRect(
    layout.card_cx - layout.card_w / 2,
    layout.card_cy - layout.card_h / 2,
    layout.card_w,
    layout.card_h
  );
  label(ctx, "画像", layout.card_cx - layout.card_w / 2 + 10, layout.card_cy - layout.card_h / 2 + 8, GUIDE);

  // 人物。大きさは面積で揃えてあるので形は回ごとに違う。ここでは同じ面積の正方形を
  // 足元から立てて、だいたいの場所を示す
  for (const cx of [layout.char_cx_left, layout.char_cx_right]) {
    const s = layout.char_size;
    ctx.strokeRect(cx - s / 2, layout.char_bottom - s * 1.25, s, s * 1.25);
  }

  // 字幕の中心線と、画像が出ているときの下端
  ctx.beginPath();
  ctx.moveTo(0, layout.sub_center_y);
  ctx.lineTo(layout.width, layout.sub_center_y);
  ctx.moveTo(0, layout.sub_bottom);
  ctx.lineTo(layout.width, layout.sub_bottom);
  ctx.stroke();

  const ui = PLATFORM_UI[name];
  if (ui) {
    ctx.strokeStyle = GUIDE_WARN;
    const x = layout.width * (1 - ui.right);
    const y = layout.height * (1 - ui.bottom);
    ctx.beginPath();
    ctx.moveTo(x, layout.height * 0.35);
    ctx.lineTo(x, layout.height);
    ctx.moveTo(0, y);
    ctx.lineTo(layout.width, y);
    ctx.stroke();
    label(ctx, "投稿先のボタンや説明文がかぶる", 16, y + 8, GUIDE_WARN);
  }
  ctx.restore();
}

/** いま出ている字幕の、1 行の上限。字がこの線を越えたら動画でも越える */
function paintSubtitleLimit(
  ctx: CanvasRenderingContext2D,
  layout: ClipLayout,
  rowCount: number,
  shift: number
) {
  const box = subtitleBox(layout, rowCount);
  const top = subtitleTop(layout, rowCount, shift);
  const x0 = (layout.width - layout.sub_max_w) / 2;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = GUIDE;
  ctx.strokeRect(x0, top + box.pad, layout.sub_max_w, box.rowH * rowCount);
  ctx.restore();
}
