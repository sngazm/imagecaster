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
function formatReferenceLinks(links: ReferenceLink[]): string {
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
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, "");
  }

  return result;
}

/**
 * 説明に文字起こしリンクを追加
 */
export function addTranscriptLink(
  description: string,
  transcriptUrl: string | null
): string {
  if (!transcriptUrl) {
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
