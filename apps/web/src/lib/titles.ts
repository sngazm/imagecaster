/**
 * タイトルと日付の、見せ方の決まり
 *
 * 公開サイトの一覧・エピソードのページと、OGP 画像で同じ形にする。
 */

/** 「番組名 - ひとこと」の形なら、番組名とひとことに分ける */
export function splitPodcastTitle(title: string): { name: string; tagline: string | null } {
  const match = title.match(/^(.+?)\s+[-–—|｜]\s+(.+)$/);
  return match ? { name: match[1], tagline: match[2] } : { name: title, tagline: null };
}

/** 「#12 タイトル」の形なら、番号（12）とタイトルに分ける */
export function splitEpisodeTitle(title: string): { number: string | null; rest: string } {
  const match = title.match(/^[#＃]\s?(\d[\d\-.]*)\s+(.+)$/);
  return match ? { number: match[1], rest: match[2] } : { number: null, rest: title };
}

/** 2026/1/11 の形（JST） */
export function formatShortDate(dateString: string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).formatToParts(new Date(dateString));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}

/** 1 時間を超えても分で出す（66分） */
export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}分`;
}

/** 「2026/1/11・66分」。公開日も長さも無ければ空 */
export function episodeMeta(episode: {
  publishedAt: string | null;
  publishAt: string;
  duration: number;
}): string {
  const date = episode.publishedAt || episode.publishAt;
  return [date ? formatShortDate(date) : "", episode.duration > 0 ? formatMinutes(episode.duration) : ""]
    .filter(Boolean)
    .join("・");
}
