import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/**
 * 確認待ちのカードがある回の案内
 *
 * 機械が決められなかった箇所は、人が音声を聞けば数秒で決まるものが多い。溜まっていることに
 * 気づけるよう、エピソード一覧の上に出す。無ければ何も描かない。
 *
 * 1 行の案内にする。押すと最初の回のカードが開く。回が複数あるときは、
 * どの回に何件あるかを添え、それぞれも押せる。
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

  /** 「#293 タイトル」から番号だけ取る。無ければタイトルの頭 */
  const shortName = (title: string) => title.match(/^[#＃]\s?\d[\d\-.]*/)?.[0] ?? title.slice(0, 12);

  return (
    <section className="mb-6 md:mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-[1.5px] border-[var(--color-ink)] px-4 py-3 md:px-5 md:py-4">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand-teal)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="text-sm md:text-[15px] font-bold">音声を聞いて確かめたい箇所が {total} 件あります</h2>
          <p className="text-xs md:text-[13px] text-[var(--color-text-muted)] flex flex-wrap gap-x-3">
            {episodes.map((e) => (
              <Link
                key={e.episodeId}
                to={`/episodes/${e.episodeId}/review`}
                className="hover:text-[var(--color-accent)] tabular-nums"
                title={e.title}
              >
                {shortName(e.title)}：{e.open} 件
              </Link>
            ))}
          </p>
        </div>
      </div>
      <Link
        to={`/episodes/${episodes[0].episodeId}/review`}
        className="flex items-center min-h-[44px] text-sm font-bold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] whitespace-nowrap"
      >
        確認する →
      </Link>
    </section>
  );
}
