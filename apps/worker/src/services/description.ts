import type { EpisodeMeta, ReferenceLink } from "../types";

/**
 * HTMLエスケープ
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 参考リンクをHTMLに変換
 */
export function formatReferenceLinks(links: ReferenceLink[]): string {
  if (!links || links.length === 0) {
    return "";
  }
  return links
    .map(
      (link) =>
        `<p>${escapeHtml(link.title)}<br><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></p>`
    )
    .join("\n");
}

/**
 * 説明文のプレースホルダーを置換
 */
export function processDescriptionPlaceholders(
  description: string,
  meta: EpisodeMeta
): string {
  let result = description;

  // {{REFERENCE_LINKS}} を変換
  if (meta.referenceLinks && meta.referenceLinks.length > 0) {
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, formatReferenceLinks(meta.referenceLinks));
  } else {
    // リンクがない場合は、タグごと削除（<p>{{REFERENCE_LINKS}}</p> など）
    result = result.replace(/<p>\s*\{\{REFERENCE_LINKS\}\}\s*<\/p>\s*/gi, "");
    result = result.replace(/<div>\s*\{\{REFERENCE_LINKS\}\}\s*<\/div>\s*/gi, "");
    // 残りのプレースホルダーも削除
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, "");
  }

  return result;
}

/**
 * 説明に文字起こしリンクを追加（既に存在する場合は追加しない）
 */
export function addTranscriptLink(
  description: string,
  transcriptUrl: string | null
): string {
  if (!transcriptUrl) {
    return description;
  }
  // 既に文字起こしリンクが含まれている場合は追加しない
  if (description.includes("📝 文字起こし:")) {
    return description;
  }
  return `${description}\n\n📝 文字起こし: ${transcriptUrl}`;
}

/**
 * 公開時の説明文処理（プレースホルダー置換 + 文字起こしリンク追加）
 */
export function processDescriptionForPublish(meta: EpisodeMeta): string {
  let description = processDescriptionPlaceholders(meta.description, meta);
  description = addTranscriptLink(description, meta.transcriptUrl);
  return description;
}
