import type { TranscriptSegment, TranscriptData } from "../types";

/**
 * 秒数をVTT形式のタイムスタンプに変換
 * 例: 125.5 -> "00:02:05.500"
 */
function formatVttTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * TranscriptDataをVTT形式の文字列に変換
 * 話者情報がある場合は <v speaker> タグを付与
 */
export function convertToVtt(data: TranscriptData): string {
  const lines: string[] = ["WEBVTT", ""];

  for (let i = 0; i < data.segments.length; i++) {
    const segment = data.segments[i];
    const startTime = formatVttTime(segment.start);
    const endTime = formatVttTime(segment.end);

    // キュー番号（オプション）
    lines.push(`${i + 1}`);

    // タイムスタンプ
    lines.push(`${startTime} --> ${endTime}`);

    // テキスト（話者情報付きの場合は <v> タグを追加）
    if (segment.speaker) {
      lines.push(`<v ${segment.speaker}>${segment.text}</v>`);
    } else {
      lines.push(segment.text);
    }

    // 空行で区切り
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * TranscriptDataのバリデーション
 */
export function validateTranscriptData(data: unknown): data is TranscriptData {
  if (!data || typeof data !== "object") {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.segments)) {
    return false;
  }

  for (const segment of obj.segments) {
    if (typeof segment !== "object" || segment === null) {
      return false;
    }

    const seg = segment as Record<string, unknown>;

    if (typeof seg.start !== "number" || seg.start < 0) {
      return false;
    }

    if (typeof seg.end !== "number" || seg.end < 0) {
      return false;
    }

    if (typeof seg.text !== "string") {
      return false;
    }

    // speaker は任意フィールド
    if (seg.speaker !== undefined && typeof seg.speaker !== "string") {
      return false;
    }
  }

  // language は任意フィールド
  if (obj.language !== undefined && typeof obj.language !== "string") {
    return false;
  }

  return true;
}
