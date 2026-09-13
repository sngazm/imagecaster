import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { GlossaryTerm } from "../lib/api";

interface Props {
  episodeId: string;
}

/**
 * その回の用語集
 *
 * 校正の前に文字起こしを通して読んで集めたもの。校正に渡すために作るが、
 * 番組の用語辞典の材料にもなるので残している。
 *
 * 説明は自動生成なので、読み物として出すなら人が目を通す必要がある。ここは
 * 「何が集まっているか」を見るための画面で、編集はしない。
 */
export function GlossaryPanel({ episodeId }: Props) {
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    api
      .getGlossary(episodeId)
      .then((data) => {
        if (!alive) return;
        setTerms(data.terms);
        setCollectedAt(data.collectedAt);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "読み込めませんでした");
      });

    return () => {
      alive = false;
    };
  }, [episodeId]);

  if (error) {
    return (
      <div className="card p-3 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
        <p className="text-sm text-[var(--color-error)]">{error}</p>
      </div>
    );
  }

  if (terms === null) {
    return <p className="text-sm text-[var(--color-text-muted)]">読み込み中...</p>;
  }

  if (terms.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        まだ集めていません。文字起こしの校正を回すと、この回に出てくる固有名詞が
        集まります。
      </p>
    );
  }

  // 誤認識を名指ししたものを先に見せる。直しに効くのはそちら
  const sorted = [...terms].sort(
    (a, b) =>
      Number(Boolean(b.suspects?.length)) - Number(Boolean(a.suspects?.length))
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        {terms.length} 語
        {collectedAt && ` ・ ${new Date(collectedAt).toLocaleString("ja-JP")}`}
      </p>

      <ul className="space-y-2">
        {sorted.map((term) => (
          <li
            key={term.term}
            className="text-sm border-b border-[var(--color-border)] pb-2 last:border-0"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-medium text-[var(--color-text-primary)]">
                {term.term}
              </span>
              {term.kind && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {term.kind}
                </span>
              )}
              {term.url && (
                <a
                  href={term.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  リンク
                </a>
              )}
            </div>

            {term.note && (
              <p className="text-[var(--color-text-secondary)] mt-0.5">{term.note}</p>
            )}

            {term.suspects?.map((spot) => (
              <p
                key={`${term.term}-${spot.index}`}
                className="text-xs text-[var(--color-text-muted)] mt-0.5"
              >
                本文の「{spot.text}」はこの語の誤認識の疑い
                {spot.guess && ` → ${spot.guess}`}
              </p>
            ))}
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--color-text-muted)]">
        説明は自動で書かせたものです。読み物として出すなら、目を通してから使って
        ください。
      </p>
    </div>
  );
}
