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
