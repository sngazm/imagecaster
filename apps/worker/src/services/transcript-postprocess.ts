/**
 * 文字起こしの後処理パイプライン
 *
 * Whisper の生出力（transcript.raw.json）を入力に、公開用の transcript.json を
 * 組み立てる。後処理を文字起こしから切り離してここに置くことで、Whisper を
 * 再実行せずに何度でも適用し直せる。修正ルールを育てたときに過去のエピソードへ
 * 一括で反映できるのはこの分離のため。
 */

import type {
  CorrectionRule,
  Env,
  EpisodeMeta,
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
  corrections: CorrectionRule[]
): CorrectionResult {
  const active = corrections.filter((rule) => rule.enabled && rule.from);

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

/**
 * 後処理設定の既定値
 */
export const DEFAULT_POST_PROCESS_SETTINGS: TranscriptPostProcessSettings = {
  speakerDefaults: [],
  merge: DEFAULT_MERGE_OPTIONS,
  corrections: [],
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

/**
 * 管理画面から届いた後処理設定を、保存できる形に正規化する
 */
export function sanitizePostProcessSettings(
  input: unknown
): TranscriptPostProcessSettings {
  if (typeof input !== "object" || input === null) {
    return { ...DEFAULT_POST_PROCESS_SETTINGS };
  }

  const entry = input as Record<string, unknown>;

  return {
    speakerDefaults: sanitizeSpeakerTracks(entry.speakerDefaults),
    merge: sanitizeMerge(entry.merge),
    corrections: sanitizeCorrections(entry.corrections),
  };
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

  const merged = mergeSegments(raw.segments, settings?.merge);
  const { segments, applied } = applyCorrections(merged, settings?.corrections ?? []);
  const processed: TranscriptData = { ...raw, segments };

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
