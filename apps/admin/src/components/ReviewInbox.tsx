import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/**
 * 確認待ちのカードがある回の一覧
 *
 * 機械が決められなかった箇所は、人が音声を聞けば数秒で決まるものが多い。溜まっていることに
 * 気づけるよう、エピソード一覧の上に出す。無ければ何も描かない。
 */
export function ReviewInbox() {
  const [episodes, setEpisodes] = useState<
    Array<{ episodeId: string; title: string; open: number }>
  >([]);

  useEffect(() => {
    api
      .getPendingReviewCards()
      .then((data) => setEpisodes(data.episodes.filter((e) => e.open > 0)))
      // 一覧の表示を、これの失敗で止めない
      .catch(() => undefined);
  }, []);

  if (episodes.length === 0) {
    return null;
  }

  const total = episodes.reduce((sum, e) => sum + e.open, 0);

  return (
    <section className="card mb-6 p-4">
      <h2 className="text-sm font-medium">
        音声を聞いて確かめたい箇所が {total} 件あります
      </h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        機械が決められなかった行です。1 件 10 秒ほどで決められます。
      </p>
      <ul className="mt-3 space-y-1">
        {episodes.map((e) => (
          <li key={e.episodeId}>
            <Link
              to={`/episodes/${e.episodeId}/review`}
              className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-bg-hover)]"
            >
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              <span className="badge badge-accent tabular-nums">{e.open} 件</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
