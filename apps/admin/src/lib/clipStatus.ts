import type { ClipLayoutName, ClipPostTarget, ClipStatus } from "./api";

export const CLIP_STATUS: Record<ClipStatus, { label: string; badgeClass: string }> = {
  draft: { label: "確認待ち", badgeClass: "badge badge-default" },
  approved: { label: "OK・描画待ち", badgeClass: "badge badge-info" },
  rendered: { label: "描画済み", badgeClass: "badge badge-success" },
  published: { label: "投稿済み", badgeClass: "badge badge-accent" },
  rejected: { label: "ボツ", badgeClass: "badge badge-error" },
};

export const CLIP_LAYOUT_LABEL: Record<ClipLayoutName, string> = {
  portrait: "縦",
  landscape: "横",
  square: "正方形",
};

export const CLIP_LAYOUT_NAMES: ClipLayoutName[] = ["portrait", "landscape", "square"];

export const CLIP_POST_LABEL: Record<ClipPostTarget, string> = {
  x: "X",
  bluesky: "Bluesky",
  youtube: "YouTube Shorts",
  instagram: "Instagram",
};

export const CLIP_POST_TARGETS: ClipPostTarget[] = ["x", "bluesky", "youtube", "instagram"];

/**
 * 人が手で出す投稿先。Worker の CLIP_MANUAL_TARGETS と揃える。
 * X は API を使わない自動操作が規約で禁じられていて、YouTube は審査を通るまで API から上げた
 * 動画が非公開に固定される
 */
export const CLIP_MANUAL_TARGETS: ClipPostTarget[] = ["x", "youtube"];

/** 投稿を諦めるまでの回数。Worker の CLIP_POST_MAX_ATTEMPTS と揃える */
export const CLIP_POST_MAX_ATTEMPTS = 5;
