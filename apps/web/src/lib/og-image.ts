/**
 * OGP 画像（1200x630）をビルド時に描く
 *
 * 左にアートワーク、右にエピソード名。SNS のカードで隠れたり読めなくなったりしないよう、
 * 下の帯には何も置かず（SAFE_BOTTOM）、字は大きめに組む。背景と差し色はアートワークから取るので、
 * 回ごとのアートワークがあればその回の色になる。
 *
 * satori で SVG にし（文字はパスになる）、sharp で JPEG にする。
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import satori from "satori";
import sharp from "sharp";
import { loadDefaultJapaneseParser } from "budoux";
import { OG_WIDTH, OG_HEIGHT, type OgCard } from "./og-card";

/**
 * 大事なものを置いてよい下端
 *
 * X はカードの左下に、ページのタイトルを黒い帯で重ねる。スマホの幅だと、帯の上端は
 * 画像の下から 17% あたり（1200x630 では y=523）まで来る。それより下には、隠れて困るものを置かない。
 * アートワークも文字もこの線より上に収め、下は余白にする。
 */
const SAFE_BOTTOM = 520;
const SIDE = 64;
const ART_TOP = 60;
const ART_SIZE = SAFE_BOTTOM - ART_TOP; // 460
const ART_RADIUS = 34;
const GAP = 52;
const TEXT_WIDTH = OG_WIDTH - SIDE * 2 - ART_SIZE - GAP; // 560

const INK = "#18181b";
const INK_MUTED = "#52525b";
const FALLBACK_ACCENT = "#3b82f6";
const FALLBACK_BG = "#f4f4f5";

const FONT = "Noto Sans JP";

type Node = {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown; [key: string]: unknown };
};

function h(type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node {
  return { type, props: { style, children, ...extra } };
}

// ---------------------------------------------------------------------------
// フォント
// ---------------------------------------------------------------------------

type SatoriFont = { name: string; data: Buffer; weight: 500 | 700 | 900; style: "normal" };

let fontsPromise: Promise<SatoriFont[]> | null = null;

function loadFonts(): Promise<SatoriFont[]> {
  if (!fontsPromise) {
    const require = createRequire(import.meta.url);
    const load = async (subset: string, weight: 500 | 700 | 900): Promise<SatoriFont> => ({
      name: FONT,
      // satori は woff2 を読めないので woff
      data: await readFile(
        require.resolve(`@fontsource/noto-sans-jp/files/noto-sans-jp-${subset}-${weight}-normal.woff`)
      ),
      weight,
      style: "normal",
    });
    // 同じ名前で並べると、前のファイルに無い字を後ろのファイルから探す
    fontsPromise = Promise.all([
      load("japanese", 700),
      load("latin", 700),
      load("japanese", 500),
      load("latin", 500),
      load("latin", 900),
    ]);
  }
  return fontsPromise;
}

// ---------------------------------------------------------------------------
// アートワーク（画像と、そこから取る色）
// ---------------------------------------------------------------------------

interface Artwork {
  /** 角を丸めた本体（PNG）。SVG には入れず、sharp で直接重ねる */
  image: Buffer;
  /** ぼかして白を被せた背景（RGB の生データ） */
  backdrop: Buffer;
  accent: string;
}

const artworkCache = new Map<string, Promise<Artwork | null>>();

function hslToHex(hue: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * アートワークでいちばん目立つ鮮やかな色を、差し色にする
 *
 * 平均や最頻の色だと背景色（たいてい淡い色）を拾ってしまうので、
 * 彩度のある画素だけを色相で数える。
 */
async function pickAccent(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .resize(48, 48, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, x: 0, y: 0, s: 0 }));

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.01) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    if (s < 0.45 || l < 0.2 || l > 0.8) continue;

    let hue: number;
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;

    const bin = bins[Math.floor(hue / (360 / BINS)) % BINS];
    const rad = (hue * Math.PI) / 180;
    // 黄色は文字が読める暗さにすると濁るので、ほかに色があればそちらを取る
    const w = hue > 35 && hue < 75 ? s * 0.3 : s;
    bin.weight += w;
    bin.x += Math.cos(rad) * w;
    bin.y += Math.sin(rad) * w;
    bin.s += s * w;
  }

  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  // 鮮やかな画素がほとんど無い（モノクロなど）なら、無理に色を作らない
  if (best.weight < 48 * 48 * 0.01) return FALLBACK_ACCENT;

  const hue = ((Math.atan2(best.y, best.x) * 180) / Math.PI + 360) % 360;
  const saturation = Math.min(0.85, Math.max(0.6, best.s / best.weight));
  // 淡い背景の上で読めるよう、明るさは抑える。黄〜緑は同じ明るさでも薄く見えるのでさらに下げる
  const lightness = hue > 40 && hue < 190 ? 0.36 : 0.46;
  return hslToHex(hue, saturation, lightness);
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function prepareArtwork(url: string): Promise<Artwork | null> {
  const original = await fetchImage(url);
  if (!original) return null;

  try {
    const mask = Buffer.from(
      `<svg width="${ART_SIZE}" height="${ART_SIZE}"><rect width="${ART_SIZE}" height="${ART_SIZE}" rx="${ART_RADIUS}" ry="${ART_RADIUS}"/></svg>`
    );
    const image = await sharp(original)
      .resize(ART_SIZE, ART_SIZE, { fit: "cover" })
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png({ compressionLevel: 1 })
      .toBuffer();

    const backdrop = await sharp(original)
      .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" })
      .removeAlpha()
      .blur(70)
      .modulate({ saturation: 1.25 })
      .composite([
        {
          input: {
            create: {
              width: OG_WIDTH,
              height: OG_HEIGHT,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 0.76 },
            },
          },
        },
      ])
      .removeAlpha()
      .raw()
      .toBuffer();

    return {
      image,
      backdrop,
      accent: await pickAccent(original),
    };
  } catch {
    return null;
  }
}

/** 同じ URL は 1 度だけ取る。取り込んだ回はアートワークが共通なことが多い */
function getArtwork(url: string | null | undefined): Promise<Artwork | null> {
  if (!url) return Promise.resolve(null);
  let cached = artworkCache.get(url);
  if (!cached) {
    cached = prepareArtwork(url);
    artworkCache.set(url, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// タイトルの折り返し
// ---------------------------------------------------------------------------

const parser = loadDefaultJapaneseParser();

/** 1 文字の幅（em）。satori に測らせる手段がないので、字種で見積もる */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === " ") return 0.26;
  if (code < 0x80) {
    if (/[A-Z]/.test(ch)) return ch === "I" ? 0.3 : /[MW]/.test(ch) ? 0.88 : 0.68;
    if (/[a-z]/.test(ch)) return /[iljtfr]/.test(ch) ? 0.36 : /[mw]/.test(ch) ? 0.88 : 0.58;
    if (/[0-9#]/.test(ch)) return 0.58;
    return 0.4;
  }
  // 半角カナ
  if (code >= 0xff61 && code <= 0xff9f) return 0.5;
  return 1;
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** 行の終わりに置かない字（開き括弧） */
const NO_LINE_END = /[（(「『【［\[〈《“‘"'@#＃]$/;
/** 行の頭に置かない字（閉じ括弧・句読点・小書きの仮名・長音） */
const NO_LINE_START = /^[／/｜）)」』】］\]〉》”’、。，．,.!?！？:;：；・…ー〜ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々]/;

/**
 * 折り返してよい単位に切る
 *
 * 文節（BudouX）を基本に、「／」や「 / 」で話題を並べたタイトルは区切りの後ろでも、
 * 英単語の並びは空白でも切れるようにする。
 */
function toPhrases(text: string): string[] {
  const pieces = text
    .split(/(?<=[／｜|・]\s*|\s\/\s)(?=\S)/)
    .flatMap((part) => parser.parse(part))
    .flatMap((phrase) => phrase.split(/(?<=\s)(?=\S)/))
    .filter((phrase) => phrase.length > 0);

  // 禁則: 開き括弧で終わる・閉じ括弧や句読点で始まる切れ目は、つなげて消す
  const phrases: string[] = [];
  for (const piece of pieces) {
    const prev = phrases[phrases.length - 1];
    if (prev !== undefined && (NO_LINE_END.test(prev.trimEnd()) || NO_LINE_START.test(piece))) {
      phrases[phrases.length - 1] = prev + piece;
    } else {
      phrases.push(piece);
    }
  }
  return phrases;
}

interface Wrapped {
  lines: string[];
  /** 1 行に入らない文節があり、文字の途中で切った */
  broken: boolean;
}

function wrap(text: string, maxEm: number): Wrapped {
  const lines: string[] = [];
  let line = "";
  let broken = false;

  const push = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };

  for (const phrase of toPhrases(text)) {
    if (textWidth((line + phrase).trimEnd()) <= maxEm) {
      line += phrase;
      continue;
    }
    push();
    if (textWidth(phrase.trimEnd()) <= maxEm) {
      line = phrase.trimStart();
      continue;
    }
    // 1 文節が 1 行に入らないときだけ、文字で切る
    broken = true;
    const chars = [...phrase];
    chars.forEach((ch, i) => {
      const next = chars[i + 1] ?? "";
      // 次の字を行頭に置けないなら、この字ごと次の行へ送る
      const needed = NO_LINE_START.test(next) ? ch + next : ch;
      if (line && !NO_LINE_START.test(ch) && textWidth(line + needed) > maxEm) push();
      line += ch;
    });
  }
  push();
  return { lines, broken };
}

/**
 * 行数を変えずに、行の長さをそろえる
 *
 * 前から詰めるだけだと最後の行に 2〜3 文字だけ残ることがある。
 * 同じ行数に収まるいちばん狭い幅で折り直す。
 */
function balance(text: string, maxEm: number, lineCount: number): string[] {
  let best = wrap(text, maxEm).lines;
  if (lineCount < 2) return best;

  let low = maxEm / 2;
  let high = maxEm;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    const wrapped = wrap(text, mid);
    if (!wrapped.broken && wrapped.lines.length <= lineCount) {
      best = wrapped.lines;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

interface FittedText {
  lines: string[];
  fontSize: number;
}

interface SizeOption {
  fontSize: number;
  /** この大きさで許す行数。大きい字で細切れの行が並ぶより、小さくして行を減らす */
  maxLines: number;
}

/**
 * 入るいちばん大きな字で組む。どうしても入らなければ最後の行を「…」で切る
 */
function fitText(text: string, sizes: SizeOption[], maxHeight: number, lineHeight: number): FittedText {
  // 見積もりのずれで右にはみ出さないよう、少し内側で折る
  const usable = TEXT_WIDTH * 0.97;
  const linesFor = ({ fontSize, maxLines }: SizeOption) =>
    Math.max(1, Math.min(maxLines, Math.floor(maxHeight / (fontSize * lineHeight))));

  // まず文字の途中で切らずに済む大きさを探し、無ければ途中で切るのを許す
  for (const allowBroken of [false, true]) {
    for (const size of sizes) {
      const maxEm = usable / size.fontSize;
      const wrapped = wrap(text, maxEm);
      if (wrapped.lines.length <= linesFor(size) && (allowBroken || !wrapped.broken)) {
        const lines = wrapped.broken ? wrapped.lines : balance(text, maxEm, wrapped.lines.length);
        return { lines, fontSize: size.fontSize };
      }
    }
  }

  const smallest = sizes[sizes.length - 1];
  const maxEm = usable / smallest.fontSize;
  const lines = wrap(text, maxEm).lines.slice(0, linesFor(smallest));
  let last = lines[lines.length - 1];
  while (last.length > 1 && textWidth(`${last}…`) > maxEm) {
    last = last.slice(0, -1);
  }
  lines[lines.length - 1] = `${last}…`;
  return { lines, fontSize: smallest.fontSize };
}

function textBlock(fitted: FittedText, lineHeight: number, style: Record<string, unknown>): Node {
  return h(
    "div",
    { display: "flex", flexDirection: "column", ...style },
    fitted.lines.map((line) =>
      h(
        "div",
        {
          fontSize: fitted.fontSize,
          lineHeight: lineHeight,
          whiteSpace: "nowrap",
        },
        line
      )
    )
  );
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

/** アートワークが無いときに左に置く */
function placeholderArt(accent: string, label: string): Node {
  return h(
    "div",
    {
      width: ART_SIZE,
      height: ART_SIZE,
      borderRadius: ART_RADIUS,
      background: `linear-gradient(135deg, ${accent} 0%, ${INK} 130%)`,
      display: "flex",
      alignItems: "flex-end",
      flexShrink: 0,
    },
    h(
      "div",
      {
        margin: 40,
        color: "#ffffff",
        fontSize: 44,
        fontWeight: 700,
        lineHeight: 1.25,
      },
      // 2 行ぶんまで。日本語は 700 までしか読み込んでいないので、太さは 700
      truncate(label, ((ART_SIZE - 80) / 44) * 2 - 1)
    )
  );
}

/** 1 行に収まるよう、長ければ「…」で切る */
function truncate(text: string, maxEm: number): string {
  if (textWidth(text) <= maxEm) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`) > maxEm) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function renderOgImage(card: OgCard): Promise<Buffer> {
  const fonts = await loadFonts();

  let artwork: Artwork | null = null;
  for (const url of card.artworkUrls) {
    artwork = await getArtwork(url);
    if (artwork) break;
  }
  const accent = artwork?.accent ?? FALLBACK_ACCENT;

  // SNS のカードはスマホだと幅 340px ほどに縮む（3.5 分の 1）。そこで読める大きさを下限にする
  const TITLE_LINE_HEIGHT = 1.3;
  const SUBTITLE_SIZE = 32;
  const SUBTITLE_LINE_HEIGHT = 1.45;
  const EYEBROW_SIZE = 40;
  const LABEL_SIZE = 28;
  const META_SIZE = 28;
  const HEAD_HEIGHT = 48;
  const HEAD_GAP = 18;
  const META_HEIGHT = 40;
  const META_GAP = 18;

  const hasHead = Boolean(card.eyebrow || card.label);
  const eyebrowEm = card.eyebrow ? (textWidth(card.eyebrow) * EYEBROW_SIZE + 18) / LABEL_SIZE : 0;
  const label = card.label ? truncate(card.label, (TEXT_WIDTH - 26) / LABEL_SIZE - eyebrowEm) : null;
  const meta = card.meta ? truncate(card.meta, TEXT_WIDTH / META_SIZE) : null;

  const subtitle = card.subtitle
    ? fitText(
        card.subtitle,
        [{ fontSize: SUBTITLE_SIZE, maxLines: 3 }],
        SUBTITLE_SIZE * SUBTITLE_LINE_HEIGHT * 3,
        SUBTITLE_LINE_HEIGHT
      )
    : null;
  const subtitleHeight = subtitle
    ? subtitle.lines.length * subtitle.fontSize * SUBTITLE_LINE_HEIGHT + 16
    : 0;

  // 右の列の高さから、上の番号と下の日付のぶんを引いた残りがタイトルの場所
  const titleSpace =
    ART_SIZE -
    (hasHead ? HEAD_HEIGHT + HEAD_GAP : 0) -
    (meta ? META_HEIGHT + META_GAP : 0) -
    subtitleHeight;
  const title = fitText(
    card.title,
    [
      { fontSize: 72, maxLines: 3 },
      { fontSize: 64, maxLines: 3 },
      { fontSize: 56, maxLines: 4 },
      { fontSize: 50, maxLines: 4 },
      { fontSize: 45, maxLines: 5 },
      { fontSize: 40, maxLines: 6 },
    ],
    titleSpace,
    TITLE_LINE_HEIGHT
  );

  // アートワークがあるときは影だけ描き、絵は後で sharp が同じ場所に重ねる
  const art: Node = artwork
    ? h("div", {
        width: ART_SIZE,
        height: ART_SIZE,
        borderRadius: ART_RADIUS,
        boxShadow: "0 26px 50px -18px rgba(24, 24, 27, 0.4), 0 0 0 1px rgba(24, 24, 27, 0.06)",
        flexShrink: 0,
      })
    : placeholderArt(accent, card.label ?? card.title);

  const head = hasHead
    ? h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          height: HEAD_HEIGHT,
          marginBottom: HEAD_GAP,
        },
        [
          h("div", {
            width: 10,
            height: 38,
            borderRadius: 5,
            background: accent,
            marginRight: 16,
          }),
          card.eyebrow
            ? h(
                "div",
                {
                  color: accent,
                  fontSize: EYEBROW_SIZE,
                  fontWeight: 900,
                  letterSpacing: "0.02em",
                  marginRight: 18,
                  whiteSpace: "nowrap",
                },
                card.eyebrow
              )
            : null,
          label
            ? h(
                "div",
                { color: INK_MUTED, fontSize: LABEL_SIZE, fontWeight: 700, whiteSpace: "nowrap" },
                label
              )
            : null,
        ]
      )
    : null;

  const column = h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      width: TEXT_WIDTH,
      height: ART_SIZE,
      marginLeft: GAP,
    },
    [
      head,
      textBlock(title, TITLE_LINE_HEIGHT, {
        color: INK,
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }),
      subtitle
        ? textBlock(subtitle, SUBTITLE_LINE_HEIGHT, {
            color: INK_MUTED,
            fontWeight: 500,
            marginTop: 16,
          })
        : null,
      meta
        ? h(
            "div",
            {
              display: "flex",
              alignItems: "center",
              height: META_HEIGHT,
              marginTop: META_GAP,
              fontSize: META_SIZE,
              color: INK_MUTED,
              fontWeight: 500,
              whiteSpace: "nowrap",
            },
            meta
          )
        : null,
    ]
  );

  const root = h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      alignItems: "flex-start",
      paddingTop: ART_TOP,
      paddingLeft: SIDE,
      paddingRight: SIDE,
      fontFamily: FONT,
    },
    [art, column]
  );

  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });

  const background = artwork
    ? sharp(artwork.backdrop, { raw: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3 } })
    : sharp({
        create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, background: FALLBACK_BG },
      });

  return background
    .composite([
      { input: Buffer.from(svg) },
      ...(artwork ? [{ input: artwork.image, left: SIDE, top: ART_TOP }] : []),
    ])
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
