/**
 * 文字起こしの後処理パイプライン
 *
 * Whisper の生出力（transcript.raw.json）を入力に、公開用の transcript.json を
 * 組み立てる。後処理を文字起こしから切り離してここに置くことで、Whisper を
 * 再実行せずに何度でも適用し直せる。修正ルールを育てたときに過去のエピソードへ
 * 一括で反映できるのはこの分離のため。
 */

import type {
  BackchannelSettings,
  CorrectionProposal,
  FillerSettings,
  CorrectionRule,
  Env,
  EpisodeMeta,
  HallucinationSettings,
  MergeSettings,
  SpeakerTrackAssignment,
  TranscriptData,
  TranscriptPostProcessSettings,
  TranscriptSegment,
} from "../types";
import { convertToVtt, validateTranscriptData } from "./vtt";

/**
 * セグメント統合の設定
 *
 * Whisper は音響的な切れ目でセグメントを分けるため、同じ人の続きの発話が
 * 複数のチャンクに割れる。話者が同じで間が短いものをまとめて読みやすくする。
 */
export const DEFAULT_MERGE_OPTIONS: MergeSettings = {
  enabled: true,
  maxGapSec: null,
  maxDurationSec: 10,
  maxChars: 200,
};

/** どのルールが何回効いたか。辞書を育てるための手がかりにする */
export interface AppliedCorrection {
  from: string;
  to: string;
  count: number;
}

export interface CorrectionResult {
  segments: TranscriptSegment[];
  applied: AppliedCorrection[];
}

export interface PostProcessOptions {
  merge?: Partial<MergeSettings>;
  corrections?: CorrectionRule[];
  hallucination?: Partial<HallucinationSettings>;
  backchannel?: Partial<BackchannelSettings>;
  /** この回かぎりの修正。番組全体の辞書のあとに当てる */
  episodeCorrections?: CorrectionRule[];
  filler?: Partial<FillerSettings>;
}

/**
 * 相槌の整形の既定値
 *
 * 実データでは 3 回の繰り返し（「はいはいはい」など）が最も多く、日本語として自然。
 * 5 回以上は稀（最新10話で 6 件）で、文字で読むとくどいので 3 回で頭打ちにする。
 */
/**
 * 話者交代を疑わしいと見なす間の上限（秒）
 *
 * 実データではこの種の交代は 62 件すべてが 0.00 秒だった。少し余裕を持たせている。
 */
export const SPURIOUS_SWITCH_MAX_GAP_SEC = 0.05;

/**
 * 判定のぶれとみなす断片の長さと間
 *
 * 句読点で終わらない短い断片は、前後が同じ話者なら判定のぶれ。実データでは
 * 4 文字以下の島 107 件のうち、本物の相槌（「はい。」「うん。」）はすべて
 * 句点で終わっていて、誤判定（「だ」「いわ」「感じで」）は終わっていなかった。
 */
const STRAY_FRAGMENT_MAX_CHARS = 4;
const STRAY_FRAGMENT_MAX_GAP_SEC = 0.3;

/** 句読点で終わっているか。読点も文の切れ目として数える */
const ANY_PUNCTUATION_END = /[。．、，,！？!?」』）)\]…]\s*$/;

/**
 * 節として切れる形で終わっているか
 *
 * 「大変なんだみたいな」「こうして」のように意味が切れていれば、次の行は
 * 相手の別の発話でありうる。「多いかもし」「で、そう」のように語の途中なら、
 * 音量判定のぶれで割れただけ。
 *
 * 見分けるのは**終止形・連体形・接続助詞**。これで終わっていれば節が閉じている。
 */
const ENDS_A_CLAUSE = new RegExp(
  "(?:" +
    [
      // 助動詞・終止形
      "です", "ます", "ました", "でした", "ません", "ない", "たい", "らしい",
      // 連体形・比況
      "みたいな", "ような", "そうな", "という", "っていう",
      // 接続助詞
      "から", "ので", "んで", "けど", "けれど", "のに", "たら", "れば",
      "ながら", "つつ", "して", "くて", "とか",
    ].join("|") +
    ")\\s*$"
);

/**
 * 言いよどみの既定
 *
 * 音で聞くと自然でも、文字で読むと目に付く。「AIが、その、効率化するってことを、
 * あの、ゴールにしちゃうと」のような行を読みやすくする。
 *
 * 読点で挟まれているか行頭にあるものだけを落とすので、「なんか変だよね」の
 * 「なんか」のように意味を持っているものは残る。
 */
export const DEFAULT_FILLER_SETTINGS: FillerSettings = {
  enabled: true,
  words: [
    "えー", "えーと", "ええと", "えっと", "えと",
    "あの", "あのー", "あのう", "あーの",
    "その", "そのー",
    "まあ", "まー", "まぁ",
    "なんか", "なんていうか", "なんつうか",
    "こう", "こー",
    "ほら", "ね",
    "うーんと", "んー",
  ],
};

/** 疑問符が誤って付く言いよどみ。「えー、で、」が「え?で、」になる */
const MISHEARD_FILLERS = ["え", "えー", "あ", "あー", "ま", "まあ"];

export const DEFAULT_BACKCHANNEL_SETTINGS: BackchannelSettings = {
  enabled: true,
  units: [
    "うん", "はい", "そう", "ええ", "へえ", "へー", "ああ", "あー", "なるほど",
    "ふん", "ふーん", "はぁ", "はあ", "ほう", "ほー", "うーん", "いや", "まあ",
    "うむ", "むむ", "ふむ", "へえ", "ほお", "おお", "おー",
    // 笑い声。文字で読むと意味を持たない。「うふふふ」は「ふんふんふん」の
    // 聞き取りで、笑い声として出てくることもある
    "は", "ハ", "ふ", "フ", "え", "へ", "う", "ウ", "あ", "ア",
  ],
  maxRepeat: 3,
  dropStandalone: true,
  // 実データ（公開済み6本・8291セグメント）を分類して選んだ。
  // 相槌だけで1セグメントを占めており、消しても前後の文意が変わらないもの。
  standalonePhrases: [
    "はい", "うん", "ええ", "ああ", "あー", "うーん", "ふーん", "へー", "へえ",
    "なるほど", "そう", "そうそう", "そうですね", "そうですか", "そうなんですね",
    "確かに", "確かにね", "はいはい", "うんうん", "そうそうそう",
    "はいはいはい", "うんうんうん", "なるほどね", "そうなんだ",
  ],
};

/**
 * ハルシネーション除去の既定値
 *
 * Whisper は無音や環境音に対して、学習データにあった定型句を出力することがある。
 * 番組の実データ（公開済み26本・約60万字）を調べて確認できたものを既定に入れている。
 */
export const DEFAULT_HALLUCINATION_SETTINGS: HallucinationSettings = {
  phrases: [
    // 番組の実データで確認したもの
    "ヤンヤン",
    "ご視聴ありがとうございました",
    "ご視聴ありがとうございます",
    "最後までご視聴いただきありがとうございました",
    "チャンネル登録お願いします",
    "チャンネル登録よろしくお願いします",
    "高評価とチャンネル登録をお願いします",
  ],
  // 相槌や擬音は正当に繰り返される。実データでは「ピピピピピピピン」の 7 回が最多で、
  // 6 回以下は「うんうんうんうんうんうん」など全て正常だった。壊さないよう高めにする。
  maxRepeat: 10,
  // 同じ文が続くこと自体はある（「さよなら」を 2 人が言う等）。3 回までは許す。
  maxConsecutive: 4,
};

/** 文の切れ目を示す文字。これで終わっていれば区切りを足さなくてよい */
const SENTENCE_END = /[。．！？!?、，,…」』）)\]]$/;

/**
 * 2 つのセグメントのテキストを連結する
 *
 * 句読点で終わっていれば、日本語は区切り文字を挟まずに繋ぐ。句読点が無い場合は
 * 空白を入れる。文字起こしには句読点が付かない設定もあり、そのまま繋ぐと
 * 別々の発話が一続きの文に見えてしまうため。
 *
 * ただし間が空いていない場合は空白を入れない。Whisper の単語境界は語の途中に
 * 落ちることがあり（「多いかもし」「れないけど」）、そこに空白を入れると語が割れる。
 * 英数字同士だけは例外で、繋ぐと 1 語になってしまうため必ず空白を入れる。
 */
function joinText(left: string, right: string, gapSec: number = Infinity): string {
  const a = left.trimEnd();
  const b = right.trimStart();

  if (!a) return b;
  if (!b) return a;

  // 句読点で終わっているなら、そのまま繋いで文の切れ目が読み取れる
  if (SENTENCE_END.test(a)) {
    return `${a}${b}`;
  }

  // 英数字同士は繋ぐと 1 語になってしまうので、必ず空白で分ける
  const latinBoundary = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);

  // 間が無いなら 1 つの語が割れているだけなので、そのまま繋ぐ
  if (!latinBoundary && gapSec <= SPURIOUS_SWITCH_MAX_GAP_SEC) {
    return `${a}${b}`;
  }

  return `${a} ${b}`;
}

/**
 * 2 つのセグメントが同じ話者のものか
 *
 * 話者が分かっていて一致する場合だけ true。統合は「同じ人の続きの発話をまとめる」
 * 処理なので、誰が喋っているか分からないセグメントは対象にしない。
 *
 * 未判定同士を同一扱いにすると、話者分離をしていないエピソードで全セグメントが
 * 繋がってしまう。実際、話者情報の無い回に適用したところ「ありがとうございます
 * あずまです鉄塔です…」のように 2 人の発話が 1 つの塊になった。細切れのまま残る
 * ほうが、誤って混ぜるより読み手を惑わせない。
 */
function isSameSpeaker(a: TranscriptSegment, b: TranscriptSegment): boolean {
  return Boolean(a.speaker) && a.speaker === b.speaker;
}

/**
 * 同一話者の連続セグメントを統合する
 */
export function mergeSegments(
  segments: TranscriptSegment[],
  options: Partial<MergeSettings> = {}
): TranscriptSegment[] {
  const opts: MergeSettings = { ...DEFAULT_MERGE_OPTIONS, ...options };

  if (!opts.enabled || segments.length === 0) {
    return segments.map((seg) => ({ ...seg }));
  }

  const merged: TranscriptSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const previous = merged[merged.length - 1];

    const gap = current.start - previous.end;
    const mergedText = joinText(previous.text, current.text, gap);
    const mergedDuration = current.end - previous.start;

    const withinGap = opts.maxGapSec === null || gap <= opts.maxGapSec;

    // 上限に達していても、文の途中なら繋ぐ。
    //
    // 上限をそのまま切れ目にすると「だんだん良くなってきて、だ」「いぶ周りに…」
    // のように語の途中で割れる。上限は「このくらいで区切りたい」という目安で
    // あって、語を割ってよいという意味ではない。切るのは句読点のある位置だけ。
    const atSentenceEnd = SENTENCE_END.test(previous.text.trimEnd());
    const withinLimits =
      mergedDuration <= opts.maxDurationSec && mergedText.length <= opts.maxChars;

    const canMerge =
      isSameSpeaker(previous, current) &&
      withinGap &&
      (withinLimits || !atSentenceEnd);

    if (canMerge) {
      previous.end = current.end;
      previous.text = mergedText;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * 文字列中の出現箇所をすべて置換し、置換回数も返す
 *
 * 正規表現ではなく単純な文字列一致にしている。辞書を書くのは人であり、
 * 正規表現の書き損じで本文が壊れるほうが、拾えない誤字が残るより害が大きい。
 */
function replaceAll(text: string, from: string, to: string): { text: string; count: number } {
  if (!from) {
    return { text, count: 0 };
  }

  let count = 0;
  let result = "";
  let index = 0;

  for (;;) {
    const found = text.indexOf(from, index);
    if (found === -1) {
      result += text.slice(index);
      break;
    }

    result += text.slice(index, found) + to;
    index = found + from.length;
    count++;
  }

  return { text: result, count };
}

/**
 * 辞書による誤字修正を適用する
 */
export function applyCorrections(
  segments: TranscriptSegment[],
  corrections: CorrectionRule[]
): CorrectionResult {
  // 長い規則から先に当てる。短い規則が先に当たると、それを含む長い規則が
  // 二度と一致しなくなる。「バント → 番頭」が「バントウ」に当たって
  // 「番頭ウ」になり、「バントウ → 番頭」が効かなくなっていた。
  const active = corrections
    .filter((rule) => rule.enabled && rule.from)
    .sort((a, b) => b.from.length - a.from.length);

  if (active.length === 0) {
    return { segments: segments.map((seg) => ({ ...seg })), applied: [] };
  }

  const counts = new Map<CorrectionRule, number>();

  const replaced = segments.map((segment) => {
    let text = segment.text;

    for (const rule of active) {
      const result = replaceAll(text, rule.from, rule.to);
      if (result.count > 0) {
        text = result.text;
        counts.set(rule, (counts.get(rule) ?? 0) + result.count);
      }
    }

    return { ...segment, text };
  });

  const applied: AppliedCorrection[] = active
    .filter((rule) => counts.has(rule))
    .map((rule) => ({
      from: rule.from,
      to: rule.to,
      count: counts.get(rule) ?? 0,
    }));

  return { segments: replaced, applied };
}

/**
 * 文字列の末尾の句読点や記号を落として比較用に整える
 */
function normalizeForMatch(text: string): string {
  return text.trim().replace(/[。、．，!！?？\s]+$/g, "");
}

/**
 * ハルシネーションを取り除く
 *
 * Whisper は無音区間や環境音に対して、学習データにあった語を出力することがある。
 *
 * 当初はセグメント全体が一致する場合だけ落としていたが、それでは足りなかった。
 * 実データでは 883 件のうち 831 件が「ヤンヤン この仕事体験、…」のように
 * **文頭に貼り付いて** おり、全体一致では 1 件も取れていなかった。
 *
 * そこで文頭・文末・単独のいずれでも落とす。ただし文中に埋もれているものは
 * 触らない。本当にその言葉を喋った可能性があり、前後の文を壊す危険があるため。
 */
export function removeHallucinations(
  segments: TranscriptSegment[],
  phrases: string[]
): { segments: TranscriptSegment[]; removed: string[] } {
  const blocked = phrases.map((p) => p.trim()).filter((p) => p !== "");

  if (blocked.length === 0) {
    return { segments: segments.map((s) => ({ ...s })), removed: [] };
  }

  const removed: string[] = [];
  const result: TranscriptSegment[] = [];

  for (const segment of segments) {
    let text = segment.text.trim();
    let hit = false;

    // 文頭・文末から繰り返し剥がす（「ヤンヤン ヤンヤン そうですね」に備える）
    for (let pass = 0; pass < 5; pass++) {
      const before = text;

      for (const phrase of blocked) {
        // 文頭（後続の空白・句読点も一緒に落とす）
        if (text.startsWith(phrase)) {
          text = text.slice(phrase.length).replace(/^[\s、。,.]+/, "");
          hit = true;
        }
        // 文末。残った文の句読点は消さない（「そうですね。」を保つ）
        if (text.endsWith(phrase)) {
          text = text.slice(0, -phrase.length).replace(/[\s]+$/, "");
          hit = true;
        }
      }

      if (text === before) break;
    }

    if (hit) {
      removed.push(segment.text.trim());
    }

    // 剥がした結果が空になったらセグメントごと落とす
    if (text === "") {
      continue;
    }

    result.push({ ...segment, text });
  }

  return { segments: result, removed };
}

/**
 * セグメント内で同じ単位が過剰に繰り返される箇所を畳む
 *
 * 「うんうんうんうん」のような相槌や「ガタガタガタ」のような擬音は正当な発話なので、
 * 実データで確認できた範囲（最多 7 回）を超える回数だけを対象にする。
 */
function collapseInnerRepeats(text: string, maxRepeat: number): string {
  // 1〜12文字の単位が maxRepeat 回以上続く箇所を、maxRepeat 回に切り詰める
  const pattern = new RegExp(`(.{1,12}?)\\1{${maxRepeat - 1},}`, "g");

  return text.replace(pattern, (match, unit: string) =>
    unit.repeat(maxRepeat)
  );
}

/**
 * 繰り返しループを畳む
 *
 * Whisper が同じ言葉を延々と出力し続ける状態への対処。セグメント内の反復と、
 * 同一テキストのセグメントが続く場合の両方を見る。
 */
export function collapseRepetitions(
  segments: TranscriptSegment[],
  options: { maxRepeat: number; maxConsecutive: number }
): { segments: TranscriptSegment[]; collapsed: number } {
  let collapsed = 0;

  // セグメント内の反復
  const inner = segments.map((segment) => {
    const text = collapseInnerRepeats(segment.text, options.maxRepeat);
    if (text !== segment.text) {
      collapsed++;
    }
    return { ...segment, text };
  });

  // 同一テキストのセグメントが続く場合
  const result: TranscriptSegment[] = [];
  let runText: string | null = null;
  let runCount = 0;

  for (const segment of inner) {
    const key = normalizeForMatch(segment.text);

    if (key === runText) {
      runCount++;
      if (runCount > options.maxConsecutive) {
        // 直前のセグメントの終端だけ伸ばして、重複分は捨てる
        result[result.length - 1].end = segment.end;
        collapsed++;
        continue;
      }
    } else {
      runText = key;
      runCount = 1;
    }

    result.push(segment);
  }

  return { segments: result, collapsed };
}

/**
 * ハルシネーションの候補を探す
 *
 * 「毎回同じ場所に同じ語が出る」「1 エピソードに異常な数だけ出る」ものを拾う。
 * 自動では消さず、人が見て判断できるよう候補として返す。
 */
export function findHallucinationCandidates(
  segments: TranscriptSegment[],
  known: string[] = []
): Array<{ text: string; count: number; reason: string }> {
  const knownSet = new Set(known.map(normalizeForMatch));
  const counts = new Map<string, number>();

  for (const segment of segments) {
    const text = normalizeForMatch(segment.text);
    // 短い相槌は正当なので対象外。長すぎる文は偶然の一致がないので対象外。
    if (text.length < 4 || text.length > 40) continue;
    if (knownSet.has(text)) continue;

    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  const total = segments.length;
  const candidates: Array<{ text: string; count: number; reason: string }> = [];

  for (const [text, count] of counts) {
    // 1 エピソード内で同じ文が何十回も出るのは、喋っているのではなく機械が繰り返している
    if (count >= 20) {
      candidates.push({
        text,
        count,
        reason: `1エピソード内に${count}回出現（全${total}セグメント中）`,
      });
    }
  }

  return candidates.sort((a, b) => b.count - a.count).slice(0, 20);
}

/**
 * 音量判定のぶれで文の途中に落ちた話者の境界を直す
 *
 * 話者は各トラックの音量で決めるため、1 語だけ相手のトラックが勝つと、そこで
 * 話者が入れ替わったことになる。すると「多いかもし」「れないけど、そ」「こが〜」の
 * ように、1 つの発話が単語の途中で切られて別々の人に割り振られる。
 *
 * 本物の交代と見分ける手がかりは**間**だった。#285 の生データで話者交代 624 件を
 * 調べたところ、はっきり分かれた。
 *
 * | 直前の終わり方 | 件数 | 間の中央値 |
 * |---|---|---|
 * | 句読点で終わる | 562 | 0.40 秒 |
 * | 文の途中 | 62 | **0.00 秒（62件すべて）** |
 *
 * 人が交代するには必ず間が空く。文の途中で、しかも間も無く入れ替わるのは、
 * 同じ人が喋り続けているのを切ってしまった場合しかない。
 *
 * 寄せる先は**その塊で最も長く喋っている話者**にする。直前に合わせると、
 * 判定をしくじった短い断片が正しい発話を引っ張ってしまう。
 */
export function repairSpeakerBoundaries(
  segments: TranscriptSegment[],
  maxGapSec: number = SPURIOUS_SWITCH_MAX_GAP_SEC
): { segments: TranscriptSegment[]; repaired: number } {
  const result = segments.map((segment) => ({ ...segment }));
  let repaired = 0;

  // 途切れずに続いている塊を集める。塊の中の話者の食い違いは、
  // 音量判定のぶれでしかない
  let start = 0;
  while (start < result.length) {
    let end = start;
    while (end + 1 < result.length) {
      const previous = result[end];
      const next = result[end + 1];

      const continues =
        !ANY_PUNCTUATION_END.test(previous.text) &&
        next.start - previous.end <= maxGapSec;

      // 語の途中で切れているか。
      //
      // 音量判定のぶれで割れた場合、前の行は語の途中で終わる（「多いかもし」
      // 「で、そう」「投」）。一方、相手が言葉を挟んだ場合は意味の切れる形で
      // 終わる（「大変なんだみたいな」「そうやって、なんか、こうして」）。
      //
      // 前者だけを繋ぐ。後者まで繋ぐと、長い発話の中に挟まった相手の一言が
      // 巻き込まれて、発言者が入れ替わる。
      const splitsAWord = !ENDS_A_CLAUSE.test(previous.text.trimEnd());

      // 句読点で終わらない短い断片は、前後が同じ話者なら判定のぶれ。
      // 「文句言い続けて、」「だ」「いぶ周りに…」の「だ」がこれで、
      // 前後 0.1 秒の間があるだけで塊が切れ、語が割れていた。
      // 本物の相槌は「はい。」「うん。」のように句点で終わる
      const isStrayFragment =
        !ANY_PUNCTUATION_END.test(next.text) &&
        next.text.trim().length <= STRAY_FRAGMENT_MAX_CHARS &&
        next.start - previous.end <= STRAY_FRAGMENT_MAX_GAP_SEC;

      if (!(continues && splitsAWord) && !isStrayFragment) break;
      end += 1;
    }

    if (end > start) {
      const winner = dominantSpeaker(result.slice(start, end + 1));

      if (winner) {
        for (let i = start; i <= end; i++) {
          if (result[i].speaker && result[i].speaker !== winner) {
            result[i] = { ...result[i], speaker: winner };
            repaired += 1;
          }
        }
      }
    }

    start = end + 1;
  }

  return { segments: result, repaired };
}

/**
 * 塊の中で最も長く喋っている話者
 *
 * 短いほうに合わせると、判定をしくじった断片が正しい発話を引っ張る。実際に
 * 0.88 秒の「で、そう」（鉄塔）が 16.9 秒の「すると、向こうが提案してきたのが…」
 * （あずま）を巻き込み、あずまの発言が丸ごと鉄塔のものになっていた。
 */
function dominantSpeaker(block: TranscriptSegment[]): string | null {
  const totals = new Map<string, number>();

  for (const segment of block) {
    if (!segment.speaker) continue;
    const duration = Math.max(0, segment.end - segment.start);
    totals.set(segment.speaker, (totals.get(segment.speaker) ?? 0) + duration);
  }

  if (totals.size <= 1) {
    return totals.size === 1 ? [...totals.keys()][0] : null;
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * 読点の手前が、次の語に直接つながる形か
 *
 * 言いよどみを落としたあと読点を残すかの判断に使う。
 *
 * - 格助詞で終わる（「AIが、」「ことを、」）なら、次の語に直接つながる。
 *   読点は言いよどみを挟むために置かれただけなので、一緒に落とす
 * - 接続助詞で終わる（「言うし、」「〜ので、」）なら、そこが文の切れ目。
 *   読点を落とすと「言うしまあ一重しく」になって読めなくなる
 */
function bindsToNextWord(head: string): boolean {
  // 「ので」「んで」「から」「けど」は切れ目。「で」の判定より先に見る
  if (/(?:ので|んで|から|けど|けれど|のに|たら|れば|よう)$/.test(head)) {
    return false;
  }

  // 接続助詞。「言うし、」「やって、」のように、そこで文が切れている
  if (/(?:[^ま]し|って|んで|いで|えて|けて|せて|べて|めて|れて)$/.test(head)) {
    return false;
  }

  return /[がをにはもでとのへや]$/.test(head);
}

/** 正規表現に埋め込める形にする */
function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 言いよどみを落とす
 *
 * 音で聞くと自然でも、文字で読むと目に付く。次の 3 つの形だけを対象にする。
 *
 * | 形 | 例 |
 * |---|---|
 * | 読点で挟まれている | 「AIが、その、効率化する」→「AIが効率化する」 |
 * | 行頭にある | 「なんか、そうやって」→「そうやって」 |
 * | 接続詞が重なっている | 「で、で、Asana」→「で、Asana」 |
 *
 * 読点が付いていないものは残す。「なんか変だよね」の「なんか」は意味を持っていて、
 * 消すと文が変わる。判定に文脈が要る場合は LLM の校正が拾う。
 */
export function removeFillers(
  segments: TranscriptSegment[],
  settings: FillerSettings
): { segments: TranscriptSegment[]; removed: number } {
  if (!settings.enabled || settings.words.length === 0) {
    return { segments: segments.map((s) => ({ ...s })), removed: 0 };
  }

  const words = settings.words
    .map((w) => w.trim())
    .filter((w) => w !== "")
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");

  // 文の途中で読点に挟まれたもの。読点ごと落とす。
  // 「AIが、効率化する」より「AIが効率化する」のほうが自然で、元の読点は
  // 言いよどみを挟むために置かれたものでしかない。
  //
  // ただし落としたあとに読点が 1 つも無くなるなら、1 つ残す。
  // 「言うし、なんていうか、まあ一重しく」から両方の読点を取ると
  // 「言うしまあ一重しく」になって切れ目が読めなくなる。
  const enclosed = new RegExp(`(?<=[^、。\\s])、(?:(?:${words})、)+`, "g");

  // 行頭にあるもの。ここは読点ごと落とす
  const leading = new RegExp(`^(?:(?:${words})、)+`, "");

  // 行頭の言いよどみに疑問符が誤って付いたもの。
  // 「えー、で、」が「え?で、」になる。直後が接続詞のときだけ落とす。
  // 「え?本当に?」のような、本物の問いかけを消さないため。
  const misheard = new RegExp(
    `^(?:${MISHEARD_FILLERS.map(escapeRegExp).join("|")})[?？](?=(?:で|そう|だから|でも|それで)、)`,
    ""
  );

  // 行末にあるもの。手前の読点ごと落として、読点は 1 つだけ残す。
  // 読点は次の行に続く印なので消さない
  const trailing = new RegExp(`(?:、|^)(?:(?:${words})、)+$`, "");

  // 「で、で、」のような接続詞の重なり
  const doubled = /^(で|そう|だから|でも)、\1、/;

  let removed = 0;

  const cleaned = segments.map((segment) => {
    const before = segment.text;
    let text = before;

    // 落としたあとに新しく隣り合う形が現れるので、変化が止まるまで通す
    for (let pass = 0; pass < 4; pass++) {
      // 行頭と行末を先に片付ける。文中の処理を先にすると、行頭の
      // 言いよどみに付いた読点まで巻き込んでしまう
      const next = text
        .replace(misheard, "")
        .replace(leading, "")
        .replace(trailing, "、")
        // offset は置換中の文字列を基準にするので、text ではなく whole を見る
        .replace(enclosed, (_match, offset: number, whole: string) =>
          bindsToNextWord(whole.slice(0, offset)) ? "" : "、"
        )
        .replace(doubled, "$1、");

      if (next === text) break;
      text = next;
    }

    text = text.trim();

    if (text !== before) {
      removed += 1;
    }

    // 落とした結果が中身を失うなら、元のまま残す
    const empty = text.replace(/[、。．，,\s]/g, "") === "";
    return { ...segment, text: empty ? before : text };
  });

  return { segments: cleaned, removed };
}

/**
 * 文の途中に埋まった相槌を落とす
 *
 * 相槌が独立した行になっていれば `dropStandaloneBackchannels` が落とすが、
 * 話者判定が揺れると相手の相槌が長い発話の中に取り込まれる。
 *
 *     だからね、絶対忘れちゃうんですよ。うん。っていうことが私のずっと悩みでして。
 *
 * この「うん。」は鉄塔の相槌で、あずまの発言ではない。行全体としては相槌でないので
 * 従来の判定では見えなかった。
 *
 * **句点に挟まれたもの**だけを対象にする。「うん、そうだね」のように読点で
 * 続くものは文の一部で、消すと意味が変わる。
 */
export function removeEmbeddedBackchannels(
  segments: TranscriptSegment[],
  settings: BackchannelSettings
): { segments: TranscriptSegment[]; removed: number } {
  if (!settings.dropStandalone || settings.standalonePhrases.length === 0) {
    return { segments: segments.map((s) => ({ ...s })), removed: 0 };
  }

  const phrases = settings.standalonePhrases
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");

  // 句点のあとに来て、句点で終わるもの。行頭のものは残す
  // （行頭は「その行が相槌で始まる」だけで、次に本文が続くとは限らない）
  const embedded = new RegExp(`(?<=[。．！？!?])(?:(?:${phrases})[。．]\\s*)+`, "g");

  let removed = 0;

  const cleaned = segments.map((segment) => {
    const before = segment.text;
    const text = before.replace(embedded, "").trim();

    if (text === before) {
      return { ...segment };
    }

    // 全部消えるなら元のまま残す。行全体が相槌なら別の処理が落とす
    if (text === "") {
      return { ...segment };
    }

    removed += 1;
    return { ...segment, text };
  });

  return { segments: cleaned, removed };
}

/**
 * 相槌だけで構成されるセグメントを落とす
 *
 * 「はい。」「なるほど。」のように、それだけで1つのセグメントになっているものを消す。
 * 実際に発話されていても、文字で読むと相槌が並ぶだけで読みにくい。
 *
 * 消さないものが2つある。
 *
 * - 読点で終わるもの（「なんか、」「でも、」）。相槌ではなく**次の発話の一部**が
 *   切れているだけで、消すと文が壊れる。実データでは 14 文字以下のセグメント
 *   5312 件のうち 2252 件が読点終わりだった
 * - 直前が疑問文のもの。「汚い手?」→「はい。」の「はい」は相槌ではなく**返事**で、
 *   消すと問いが宙に浮く
 */
export function dropStandaloneBackchannels(
  segments: TranscriptSegment[],
  settings: BackchannelSettings
): { segments: TranscriptSegment[]; dropped: string[] } {
  if (!settings.dropStandalone || settings.standalonePhrases.length === 0) {
    return { segments: segments.map((s) => ({ ...s })), dropped: [] };
  }

  const phrases = new Set(settings.standalonePhrases.map((p) => p.trim()));
  const dropped: string[] = [];

  // 相槌の語の繰り返しだけで出来た行も落とす。
  //
  // 「ふんふんふん。」を消すのに、語形を1つずつ登録していくときりがない。
  // 対象の語の並びだけで出来ているかを見れば、繰り返しの回数によらず拾える。
  const units = settings.units
    .map((u) => u.trim())
    .filter((u) => u !== "")
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length);
  const alternation = units.join("|");
  const repeated = units.length > 0 ? new RegExp(`^(?:${alternation})+$`) : null;

  // 同じ語を 2 回以上繰り返したもの。返事ではなく相槌の勢い
  const emphatic =
    units.length > 0
      ? new RegExp(`^(?:${alternation})(?:${alternation})+$`)
      : null;

  const kept: TranscriptSegment[] = [];

  for (const segment of segments) {
    const text = segment.text.trim();

    // 読点で終わるものは次に続く断片なので触らない
    if (/[、，,]$/.test(text)) {
      kept.push(segment);
      continue;
    }

    // 句点・感嘆符などを外した中身が相槌そのものか
    const core = text.replace(/[。．！？!?\s]+$/g, "");

    // 区切りを詰めてから判定する。「はい、はい、はい。」「はっはっはっ。」は
    // 読点や促音を挟むだけで、相槌や笑い声であることに変わりはない
    const compact = core.replace(/[、，,っッー\s]/g, "");

    const isBackchannel =
      core !== "" &&
      (phrases.has(core) ||
        (repeated?.test(core) ?? false) ||
        (compact.length >= 2 && (repeated?.test(compact) ?? false)));

    if (!isBackchannel) {
      kept.push(segment);
      continue;
    }

    // 直前が疑問文なら、これは相槌ではなく**返事**。消すと問いが宙に浮く。
    //
    // ただし同じ語を繰り返しただけのもの（「そうそうそう」）は除く。返事としては
    // 1 回で足り、繰り返しは相槌の勢いでしかない。
    const prev = kept[kept.length - 1];
    const isEmphatic =
      (emphatic?.test(core) ?? false) || (emphatic?.test(compact) ?? false);

    if (prev && /[？?]\s*$/.test(prev.text.trim()) && !isEmphatic) {
      kept.push(segment);
      continue;
    }

    dropped.push(text);
  }

  return { segments: kept.map((s) => ({ ...s })), dropped };
}

/**
 * 相槌の繰り返し回数を抑える
 *
 * 実際にそう喋っていても、文字で読むとくどい。読みやすさのために回数を揃える。
 * 対象は相槌として使われる語に限る。擬音（「ガタガタガタ」など）は意味が変わるので
 * 触らない。
 */
export function normalizeBackchannels(
  segments: TranscriptSegment[],
  settings: BackchannelSettings
): { segments: TranscriptSegment[]; normalized: number } {
  if (!settings.enabled || settings.units.length === 0) {
    return { segments: segments.map((s) => ({ ...s })), normalized: 0 };
  }

  // 長い単位から先に見ないと、「なるほど」が別の単位に割れてしまう
  const units = [...settings.units].sort((a, b) => b.length - a.length);
  const escaped = units.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})\\1{${settings.maxRepeat},}`, "g");

  let normalized = 0;

  const result = segments.map((segment) => {
    const text = segment.text.replace(pattern, (_match, unit: string) => {
      normalized++;
      return unit.repeat(settings.maxRepeat);
    });
    return { ...segment, text };
  });

  return { segments: result, normalized };
}

/**
 * 後処理パイプラインを適用する
 *
 * 統合してから置換する。セグメントをまたいで分断されていた誤字も、
 * 統合後なら 1 つの文字列として拾える。
 */
export function postProcess(
  data: TranscriptData,
  options: PostProcessOptions = {}
): TranscriptData {
  const hallucination = {
    ...DEFAULT_HALLUCINATION_SETTINGS,
    ...options.hallucination,
  };

  // ノイズを先に落とす。統合してからでは、まとまった文の一部になって取り除けない
  const { segments: cleaned } = removeHallucinations(
    data.segments,
    hallucination.phrases
  );
  const { segments: collapsed } = collapseRepetitions(cleaned, hallucination);

  const backchannel = {
    ...DEFAULT_BACKCHANNEL_SETTINGS,
    ...options.backchannel,
  };

  // 回数を抑えてから、相槌だけのセグメントを落とす。順序が逆だと
  // 「うんうんうんうんうん」が対象語に一致せず残ってしまう
  // 言いよどみを先に落とす。「なんか、」が消えると相槌だけの行になることがある
  const { segments: deflated } = removeFillers(collapsed, {
    ...DEFAULT_FILLER_SETTINGS,
    ...options.filler,
  });

  const { segments: tidied } = normalizeBackchannels(deflated, backchannel);
  const { segments: withoutFillers } = dropStandaloneBackchannels(tidied, backchannel);

  // 統合の前に直す。話者が違うままだと統合されず、単語の途中で切れた断片が残る
  const { segments: repaired } = repairSpeakerBoundaries(withoutFillers);

  const merged = mergeSegments(repaired, options.merge);

  // 統合してからもう一度落とす。「そう」と「そうそう」が繋がって
  // 「そうそうそう」が生まれることがある。判定は読者が見る最終形に対して行う。
  const { segments: tidy } = dropStandaloneBackchannels(merged, backchannel);

  // 統合してから、文の途中に埋まった相槌を落とす。話者判定が揺れると
  // 相手の相槌が長い発話の中に取り込まれ、行全体としては相槌でなくなる
  const { segments: cleared } = removeEmbeddedBackchannels(tidy, backchannel);

  // 文中の相槌を落とした結果、行全体が相槌になることがある。
  // 「はい、はい、はい、はい。なるほど。」から「なるほど。」が消えると、
  // 残るのは相槌だけになる
  const { segments: settled } = dropStandaloneBackchannels(cleared, backchannel);
  // 番組全体の辞書を当ててから、この回かぎりの修正を当てる。
  // 全体の辞書に入れると誤爆するものを、ここで拾う
  const { segments: corrected } = applyCorrections(settled, options.corrections ?? []);
  const { segments } = applyCorrections(corrected, options.episodeCorrections ?? []);

  return {
    ...data,
    segments,
  };
}

/**
 * 後処理設定の既定値
 */
export const DEFAULT_POST_PROCESS_SETTINGS: TranscriptPostProcessSettings = {
  speakerDefaults: [],
  merge: DEFAULT_MERGE_OPTIONS,
  corrections: [],
  // 既定では同時発話を検出しない。会話中の相槌のかぶりまで拾うと誤検出が多すぎるため
  simultaneousUntilSec: null,
  hallucination: DEFAULT_HALLUCINATION_SETTINGS,
  backchannel: DEFAULT_BACKCHANNEL_SETTINGS,
};

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 話者割り当ての配列を正規化する
 *
 * label は空文字を null（非発話トラック）として扱う。管理画面のテキスト入力を
 * 空にしたときに「BGM なので判定から外す」を表現できるようにするため。
 */
export function sanitizeSpeakerTracks(input: unknown): SpeakerTrackAssignment[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<number>();
  const result: SpeakerTrackAssignment[] = [];

  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;

    const entry = item as Record<string, unknown>;
    const track = entry.track;

    if (typeof track !== "number" || !Number.isInteger(track) || track < 1) continue;
    if (seen.has(track)) continue;

    seen.add(track);

    const rawLabel = entry.label;
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== "" ? rawLabel.trim() : null;

    result.push({ track, label });
  }

  return result.sort((a, b) => a.track - b.track);
}

function sanitizeCorrections(input: unknown): CorrectionRule[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: CorrectionRule[] = [];

  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;

    const entry = item as Record<string, unknown>;
    const from = typeof entry.from === "string" ? entry.from : "";
    const to = typeof entry.to === "string" ? entry.to : "";

    if (from === "") continue;

    const rule: CorrectionRule = {
      from,
      to,
      enabled: entry.enabled !== false,
    };

    if (typeof entry.note === "string" && entry.note.trim() !== "") {
      rule.note = entry.note.trim();
    }

    result.push(rule);
  }

  return result;
}

function sanitizeMerge(input: unknown): MergeSettings {
  if (typeof input !== "object" || input === null) {
    return { ...DEFAULT_MERGE_OPTIONS };
  }

  const entry = input as Record<string, unknown>;
  const rawGap = entry.maxGapSec;

  return {
    enabled: entry.enabled !== false,
    // null は「間の長さを条件にしない」という意味なので、既定値で埋めずに保つ
    maxGapSec:
      rawGap === null
        ? null
        : typeof rawGap === "number" && Number.isFinite(rawGap)
          ? rawGap
          : DEFAULT_MERGE_OPTIONS.maxGapSec,
    maxDurationSec: toFiniteNumber(
      entry.maxDurationSec,
      DEFAULT_MERGE_OPTIONS.maxDurationSec
    ),
    maxChars: toFiniteNumber(entry.maxChars, DEFAULT_MERGE_OPTIONS.maxChars),
  };
}

function sanitizeHallucination(input: unknown): HallucinationSettings {
  if (typeof input !== "object" || input === null) {
    return { ...DEFAULT_HALLUCINATION_SETTINGS };
  }

  const entry = input as Record<string, unknown>;
  const rawPhrases = entry.phrases;

  return {
    phrases: Array.isArray(rawPhrases)
      ? rawPhrases
          .filter((p): p is string => typeof p === "string" && p.trim() !== "")
          .map((p) => p.trim())
      : DEFAULT_HALLUCINATION_SETTINGS.phrases,
    // 低すぎる値は正常な相槌や擬音を壊すので下限を設ける
    maxRepeat: Math.max(
      8,
      toFiniteNumber(entry.maxRepeat, DEFAULT_HALLUCINATION_SETTINGS.maxRepeat)
    ),
    maxConsecutive: Math.max(
      3,
      toFiniteNumber(entry.maxConsecutive, DEFAULT_HALLUCINATION_SETTINGS.maxConsecutive)
    ),
  };
}

/** 文字列の配列が同じ中身か */
function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * 語の一覧を正規化する。既定と同じなら保存しない
 *
 * 管理画面は設定を取得してそのまま送り返すので、そのときの既定値が保存に焼き付く。
 * すると**コード側の既定を更新しても効かなくなる**。実際に相槌の語を増やしても、
 * 保存された古い一覧が使われ続けた。既定と同じものは持たせない。
 */
function sanitizeWordList(
  input: unknown,
  defaults: string[]
): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const words = input
    .filter((w): w is string => typeof w === "string" && w.trim() !== "")
    .map((w) => w.trim());

  return sameStrings(words, defaults) ? undefined : words;
}

function sanitizeBackchannel(input: unknown): Partial<BackchannelSettings> {
  if (typeof input !== "object" || input === null) {
    return {};
  }

  const entry = input as Record<string, unknown>;

  const settings: Partial<BackchannelSettings> = {
    enabled: entry.enabled !== false,
    // 1 回に潰すと不自然なので下限を 2 にする
    maxRepeat: Math.max(
      2,
      toFiniteNumber(entry.maxRepeat, DEFAULT_BACKCHANNEL_SETTINGS.maxRepeat)
    ),
    dropStandalone: entry.dropStandalone !== false,
  };

  const units = sanitizeWordList(entry.units, DEFAULT_BACKCHANNEL_SETTINGS.units);
  if (units) {
    settings.units = units;
  }

  const phrases = sanitizeWordList(
    entry.standalonePhrases,
    DEFAULT_BACKCHANNEL_SETTINGS.standalonePhrases
  );
  if (phrases) {
    settings.standalonePhrases = phrases;
  }

  return settings;
}

/**
 * 管理画面から届いた後処理設定を、保存できる形に正規化する
 */
/**
 * 保存されている設定を後処理のオプションに変換する
 *
 * 呼び出し側で項目を書き写していると、設定を足したときに写し忘れた経路だけ
 * 既定値で動く。実際に backchannel を足したときこれが起きたので関数にまとめた。
 */
/**
 * 保存された設定を、管理画面に見せる形にする
 *
 * 保存には既定と違う項目しか入っていない。画面で編集できるよう、既定を補って返す。
 */
export function withDefaults(
  settings: TranscriptPostProcessSettings | undefined | null
): TranscriptPostProcessSettings {
  const base = settings ?? DEFAULT_POST_PROCESS_SETTINGS;

  return {
    ...base,
    backchannel: { ...DEFAULT_BACKCHANNEL_SETTINGS, ...base.backchannel },
    hallucination: { ...DEFAULT_HALLUCINATION_SETTINGS, ...base.hallucination },
  };
}

export function toPostProcessOptions(
  settings: TranscriptPostProcessSettings | undefined | null,
  meta?: EpisodeMeta | null
): PostProcessOptions {
  return {
    merge: settings?.merge,
    corrections: settings?.corrections,
    hallucination: settings?.hallucination,
    backchannel: settings?.backchannel,
    episodeCorrections: meta?.transcriptCorrections ?? undefined,
  };
}

export function sanitizePostProcessSettings(
  input: unknown
): TranscriptPostProcessSettings {
  if (typeof input !== "object" || input === null) {
    return { ...DEFAULT_POST_PROCESS_SETTINGS };
  }

  const entry = input as Record<string, unknown>;

  const rawUntil = entry.simultaneousUntilSec;

  return {
    speakerDefaults: sanitizeSpeakerTracks(entry.speakerDefaults),
    merge: sanitizeMerge(entry.merge),
    corrections: sanitizeCorrections(entry.corrections),
    // 0 以下は「検出しない」と同じ意味なので null に寄せる
    simultaneousUntilSec:
      typeof rawUntil === "number" && Number.isFinite(rawUntil) && rawUntil > 0
        ? rawUntil
        : null,
    hallucination: sanitizeHallucination(entry.hallucination),
    backchannel: sanitizeBackchannel(entry.backchannel),
    proposals: sanitizeProposals(entry.proposals),
  };
}

/**
 * 校正からの提案を正規化する
 *
 * 落とすと、設定を保存するたびに提案が消える。管理画面は設定を取得して
 * そのまま送り返すので、承認の画面を開いただけで一覧が空になってしまう。
 */
function sanitizeProposals(input: unknown): CorrectionProposal[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null
    )
    .filter(
      (entry) =>
        typeof entry.from === "string" &&
        typeof entry.to === "string" &&
        entry.from.trim() !== "" &&
        entry.to.trim() !== ""
    )
    .map((entry) => ({
      from: String(entry.from).trim(),
      to: String(entry.to).trim(),
      note: typeof entry.note === "string" ? entry.note : undefined,
      episodeId: typeof entry.episodeId === "string" ? entry.episodeId : "",
      occurrences:
        typeof entry.occurrences === "number" && Number.isFinite(entry.occurrences)
          ? entry.occurrences
          : 0,
      proposedAt:
        typeof entry.proposedAt === "string"
          ? entry.proposedAt
          : new Date().toISOString(),
    }));
}

/**
 * エピソードに適用する話者割り当てを決める
 *
 * エピソード固有の設定があればそれを使い、無ければ番組の既定値にする。
 * ゲスト回でトラック構成が変わる場合にエピソード側で上書きできるようにするため。
 */
export function resolveSpeakerTracks(
  episodeTracks: SpeakerTrackAssignment[] | null | undefined,
  settings: TranscriptPostProcessSettings | undefined
): SpeakerTrackAssignment[] {
  if (episodeTracks && episodeTracks.length > 0) {
    return episodeTracks;
  }
  return settings?.speakerDefaults ?? [];
}

/**
 * R2 上の文字起こしファイルのキー
 */
export function transcriptKeys(storageKey: string) {
  return {
    /** Whisper の生出力（話者判定済み・後処理前）。後処理をやり直す入力 */
    raw: `episodes/${storageKey}/transcript.raw.json`,
    /** 後処理済み JSON */
    json: `episodes/${storageKey}/transcript.json`,
    /** 後処理済み VTT（公開サイトが読む） */
    vtt: `episodes/${storageKey}/transcript.vtt`,
  };
}

/**
 * 後処理の入力になる生データを取得する
 *
 * 話者分離の導入前に作られたエピソードは、後処理前のデータが transcript.json に
 * 入っている。その場合は一度だけ raw として複製し、以後の入力をそちらに寄せる。
 * こうしないと、後処理済みの transcript.json を入力に再処理してしまい、
 * 統合や置換が二重にかかる。
 */
export async function getRawTranscript(
  env: Env,
  storageKey: string
): Promise<TranscriptData | null> {
  const keys = transcriptKeys(storageKey);

  const raw = await env.R2_BUCKET.get(keys.raw);
  if (raw) {
    return JSON.parse(await raw.text()) as TranscriptData;
  }

  const legacy = await env.R2_BUCKET.get(keys.json);
  if (!legacy) {
    return null;
  }

  const text = await legacy.text();
  await env.R2_BUCKET.put(keys.raw, text, {
    httpMetadata: { contentType: "application/json" },
  });

  return JSON.parse(text) as TranscriptData;
}

/**
 * 生データに後処理をかけ、公開用の JSON と VTT を書き出す
 *
 * meta の transcriptUrl / transcriptRawUrl を書き換えるが、保存は呼び出し側で行う。
 */
export async function savePostProcessed(
  env: Env,
  meta: EpisodeMeta,
  raw: TranscriptData,
  settings: TranscriptPostProcessSettings | undefined
): Promise<{ segments: number; applied: AppliedCorrection[] }> {
  const keys = transcriptKeys(meta.storageKey);

  // パイプライン全体を通す。ここで mergeSegments と applyCorrections だけを
  // 直接呼んでいたため、ハルシネーション除去と相槌の整形が効いていなかった。
  const processed = postProcess(raw, toPostProcessOptions(settings, meta));

  // どの置換が何回効いたかは呼び出し側に返す（統合後のテキストに対して数える）
  const merged = mergeSegments(raw.segments, settings?.merge);
  const { applied } = applyCorrections(merged, settings?.corrections ?? []);
  const segments = processed.segments;

  await env.R2_BUCKET.put(keys.json, JSON.stringify(processed), {
    httpMetadata: { contentType: "application/json" },
  });

  await env.R2_BUCKET.put(keys.vtt, convertToVtt(processed), {
    httpMetadata: { contentType: "text/vtt" },
  });

  meta.transcriptRawUrl = `${env.R2_PUBLIC_URL}/${keys.raw}`;
  meta.transcriptUrl = `${env.R2_PUBLIC_URL}/${keys.vtt}`;

  return { segments: segments.length, applied };
}

/**
 * 生データを読み直して後処理をかける
 *
 * 辞書や統合条件を変えたあとに、文字起こしをやり直さずに適用し直すために使う。
 */
export async function applyPostProcessAndSave(
  env: Env,
  meta: EpisodeMeta,
  settings: TranscriptPostProcessSettings | undefined
): Promise<{ segments: number; applied: AppliedCorrection[] } | null> {
  const raw = await getRawTranscript(env, meta.storageKey);

  if (!raw || !validateTranscriptData(raw)) {
    return null;
  }

  return savePostProcessed(env, meta, raw, settings);
}
