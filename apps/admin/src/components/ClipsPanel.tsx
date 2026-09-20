import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ClipListEntry } from "../lib/api";
import { CLIP_STATUS } from "../lib/clipStatus";

/**
 * この回の切り抜き一覧。押すとビューワーへ。
 *
 * 下書きを作るのも描くのも手元の道具（imagecaster-video）。ここは並べるだけで、
 * 確かめて直すのは押した先の画面。
 */

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
            <span className={CLIP_STATUS[c.status].badgeClass}>
              {CLIP_STATUS[c.status].label}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
