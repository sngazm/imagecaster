/**
 * 文字起こしの後処理パイプライン
 *
 * Whisper の生出力（transcript.raw.json）を入力に、公開用の transcript.json を
 * 組み立てる。後処理を文字起こしから切り離してここに置くことで、Whisper を
 * 再実行せずに何度でも適用し直せる。修正ルールを育てたときに過去のエピソードへ
 * 一括で反映できるのはこの分離のため。
 */

import type { TranscriptData, TranscriptSegment } from "../types";

/**
 * セグメント統合の設定
 *
 * Whisper は音響的な切れ目でセグメントを分けるため、同じ人の続きの発話が
 * 複数のチャンクに割れる。話者が同じで間が短いものをまとめて読みやすくする。
 */
export interface MergeOptions {
  enabled: boolean;
  /**
   * これ以上の間が空いていたら、話者が同じでも統合しない（秒）
   * null なら間の長さを考慮しない（会話では無音が入らないことが多いため既定は null）
   */
  maxGapSec: number | null;
  /** 統合後の 1 セグメントの最大長（秒） */
  maxDurationSec: number;
  /** 統合後の 1 セグメントの最大文字数（長さの上限に対する保険） */
  maxChars: number;
}

export const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  enabled: true,
  maxGapSec: null,
  maxDurationSec: 10,
  maxChars: 200,
};

/**
 * 誤字の置換ルール
 *
 * Whisper は固有名詞を取り違える（「鉄塔」が「テト」「テッド」になる等）。
 * LLM に本文を直接書き換えさせると毎回結果が変わって検証できないため、
 * 実際の置換はこの辞書による決定的な処理で行う。LLM は候補の提案に使う。
 */
export interface Correction {
  from: string;
  to: string;
  enabled: boolean;
  /** なぜこのルールを入れたか（管理画面での判断材料） */
  note?: string;
}

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
  merge?: Partial<MergeOptions>;
  corrections?: Correction[];
}

/**
 * 2 つのセグメントのテキストを連結する
 *
 * 日本語は区切り文字を挟まずに繋ぐ。英単語同士が隣接する場合だけ、
 * 単語がくっつかないよう空白を入れる。
 */
function joinText(left: string, right: string): string {
  const a = left.trimEnd();
  const b = right.trimStart();

  if (!a) return b;
  if (!b) return a;

  const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

/**
 * 2 つのセグメントが同じ話者のものか
 *
 * どちらも話者未判定（undefined）の場合は同一とみなす。話者情報が無い
 * エピソードでも統合が効くようにするため。片方だけ未判定なら統合しない。
 */
function isSameSpeaker(a: TranscriptSegment, b: TranscriptSegment): boolean {
  return (a.speaker ?? null) === (b.speaker ?? null);
}

/**
 * 同一話者の連続セグメントを統合する
 */
export function mergeSegments(
  segments: TranscriptSegment[],
  options: Partial<MergeOptions> = {}
): TranscriptSegment[] {
  const opts: MergeOptions = { ...DEFAULT_MERGE_OPTIONS, ...options };

  if (!opts.enabled || segments.length === 0) {
    return segments.map((seg) => ({ ...seg }));
  }

  const merged: TranscriptSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const previous = merged[merged.length - 1];

    const gap = current.start - previous.end;
    const mergedText = joinText(previous.text, current.text);
    const mergedDuration = current.end - previous.start;

    const withinGap = opts.maxGapSec === null || gap <= opts.maxGapSec;

    const canMerge =
      isSameSpeaker(previous, current) &&
      withinGap &&
      mergedDuration <= opts.maxDurationSec &&
      mergedText.length <= opts.maxChars;

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
  corrections: Correction[]
): CorrectionResult {
  const active = corrections.filter((rule) => rule.enabled && rule.from);

  if (active.length === 0) {
    return { segments: segments.map((seg) => ({ ...seg })), applied: [] };
  }

  const counts = new Map<Correction, number>();

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
 * 後処理パイプラインを適用する
 *
 * 統合してから置換する。セグメントをまたいで分断されていた誤字も、
 * 統合後なら 1 つの文字列として拾える。
 */
export function postProcess(
  data: TranscriptData,
  options: PostProcessOptions = {}
): TranscriptData {
  const merged = mergeSegments(data.segments, options.merge);
  const { segments } = applyCorrections(merged, options.corrections ?? []);

  return {
    ...data,
    segments,
  };
}
