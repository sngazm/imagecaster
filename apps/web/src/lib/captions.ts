/**
 * 文字起こしをプレイヤー直下の字幕に割る
 *
 * VTT のキューは字幕 1 枚ではなく「ひと続きの発言」で、最長で 30 秒・173 字ある。
 * 再生時間の 6 割はそういう長いキューが占めるので、そのまま出すと字幕が止まって
 * 見える。句読点で 28 字ほどに割り、キューの中の時刻は文字数で按分する。
 * 話速は中央値 6 字/秒でほぼ一定なので、按分でもズレは 1〜2 秒に収まる。
 */

/**
 * 字幕 1 枚の上限
 *
 * 320px 幅でも 2 行に収まる長さ。全角で 1 行 16 字ほど入る。
 */
const MAX_CHARS = 28;
/** 余りがこれより短ければ前の字幕にくっつける。1〜2 字だけの字幕を出さないため */
const MIN_CHARS = 8;
/** くっつけた結果の上限。ここまでなら 2 行に収まる */
const MERGE_MAX_CHARS = 32;
/** 終了時刻が無いキューの尺を見積もる話速 */
const CHARS_PER_SECOND = 6;
/** ここで切ると読みやすい文字 */
const BREAK_AFTER = /[。、？！…」』）]/;

/**
 * 文字の種類
 *
 * 句読点が来ないまま上限に達したとき、どこで切るかを決めるのに使う。
 * 種類の変わり目はだいたい語の切れ目なので、「Apple Watc / h」のような
 * 割れ方を避けられる。
 */
type CharClass = "latin" | "kana" | "katakana" | "other";

function classOf(char: string): CharClass {
  if (/[0-9A-Za-z]/.test(char)) return "latin";
  if (/[ぁ-ん]/.test(char)) return "kana";
  if (/[ァ-ヴーｦ-ﾟ]/.test(char)) return "katakana";
  return "other";
}

/**
 * 次に切る位置を返す
 *
 * 句読点があればそこで切る。無ければ、上限の手前で語の切れ目らしいところを探す。
 * ひらがな（助詞）の後ろがいちばん切れ目らしいので優先し、次に文字種の変わり目、
 * どちらも無ければ上限で切る。
 */
function nextCut(chars: string[], from: number, target: number): number {
  const rest = chars.length - from;
  if (rest <= MAX_CHARS) return chars.length;

  const limit = from + MAX_CHARS;

  for (let i = from + target; i <= limit; i++) {
    if (BREAK_AFTER.test(chars[i - 1])) return i;
  }

  // ひらがなの後ろ（「〜のを」「〜って」の切れ目）
  for (let i = limit; i > from + MIN_CHARS; i--) {
    if (classOf(chars[i - 1]) === "kana" && classOf(chars[i]) !== "kana") return i;
  }

  // 文字種の変わり目
  for (let i = limit; i > from + MIN_CHARS; i--) {
    if (classOf(chars[i - 1]) !== classOf(chars[i])) return i;
  }

  return limit;
}

/** 元になる発言。時刻は秒 */
export interface Utterance {
  start: number;
  /** 終了時刻。取れないときは 0 でよい（次の発言の頭か話速で補う） */
  end: number;
  text: string;
  speaker: string;
}

export interface Caption {
  start: number;
  text: string;
  speaker: string;
  /** 元になった発言の番号。文字起こしのハイライトに使う */
  utterance: number;
}

/**
 * 発言を字幕の大きさに割る
 *
 * 頭から 30 字ずつ詰めると最後に 1〜2 字が余ることがあるので、枚数から 1 枚の
 * 目安を決めて均す。区切りは句読点を優先し、来なければ上限で切る。
 */
export function splitIntoCaptions(text: string): string[] {
  if (!text) return [];

  const chars = [...text];
  const target = Math.ceil(chars.length / Math.ceil(chars.length / MAX_CHARS));
  const chunks: string[] = [];

  for (let from = 0; from < chars.length; ) {
    const cut = nextCut(chars, from, target);
    chunks.push(chars.slice(from, cut).join(""));
    from = cut;
  }

  // 余りが短すぎるときは前にくっつける。1〜2 字だけの字幕を出さないため
  const tail = chunks[chunks.length - 1];
  const head = chunks[chunks.length - 2];
  if (
    head !== undefined &&
    [...tail].length < MIN_CHARS &&
    [...head].length + [...tail].length <= MERGE_MAX_CHARS
  ) {
    chunks.splice(chunks.length - 2, 2, head + tail);
  }

  return chunks;
}

/** 発言の終わり。無ければ次の発言の頭、それも無ければ話速から見積もる */
function endOf(utterances: Utterance[], index: number): number {
  const { start, end, text } = utterances[index];
  if (end > start) return end;

  const next = utterances[index + 1]?.start ?? 0;
  if (next > start) return next;

  return start + text.length / CHARS_PER_SECOND;
}

/**
 * 発言の列を字幕の列にする
 *
 * 字幕の開始時刻は、発言の尺をその字幕までの文字数で按分して求める。
 */
export function toCaptions(utterances: Utterance[]): Caption[] {
  const captions: Caption[] = [];

  utterances.forEach((utterance, index) => {
    const chunks = splitIntoCaptions(utterance.text);
    if (chunks.length === 0) return;

    const start = utterance.start;
    const duration = endOf(utterances, index) - start;

    let offset = 0;
    for (const text of chunks) {
      captions.push({
        start: start + (duration * offset) / utterance.text.length,
        text,
        speaker: utterance.speaker,
        utterance: index,
      });
      offset += text.length;
    }
  });

  return captions;
}
