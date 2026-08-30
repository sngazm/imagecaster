import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ClipListEntry, ClipStatus } from "../lib/api";

/**
 * この回の切り抜き一覧。押すとビューワーへ。
 *
 * 作るのは手元の道具（imagecaster-video）で、ここは出来たものを並べるだけ。
 */

const STATUS: Record<ClipStatus, { label: string; badgeClass: string }> = {
  draft: { label: "確認待ち", badgeClass: "badge badge-default" },
  approved: { label: "OK", badgeClass: "badge badge-success" },
  rejected: { label: "ボツ", badgeClass: "badge badge-error" },
};

export function ClipsPanel({ episodeId }: { episodeId: string }) {
  const [clips, setClips] = useState<ClipListEntry[] | null>(null);

  useEffect(() => {
    api
      .getClips(episodeId)
      .then((r) => setClips(r.clips))
      // まだ 1 本も無い回のほうが多い。黙って空にする
      .catch(() => setClips([]));
  }, [episodeId]);

  if (clips === null) {
    return <p className="text-sm text-[var(--color-text-secondary)]">読み込み中…</p>;
  }

  if (clips.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        まだありません。文字起こしが終わると、手元の道具が作りにきます。
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {clips.map((c) => (
        <li key={c.id}>
          <Link
            to={`/episodes/${episodeId}/clips/${c.id}`}
            className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 hover:bg-[var(--color-bg-hover)]"
          >
            <span className="flex-1 text-sm">{c.label}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              v{c.latest}
            </span>
            <span className={STATUS[c.status].badgeClass}>
              {STATUS[c.status].label}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
