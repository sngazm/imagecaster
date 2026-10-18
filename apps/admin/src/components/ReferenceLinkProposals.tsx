import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { GlossaryTerm } from "../lib/api";
import type { ReferenceLink } from "./ReferenceLinksEditor";

interface Props {
  episodeId: string;
  /** いまの参考リンク。ここにある URL やタイトルの語は候補に出さない */
  links: ReferenceLink[];
  /** 見送った URL。次に開いたときにまた出さない */
  dismissed: string[];
  onAdd: (link: ReferenceLink) => Promise<void> | void;
  onDismiss: (url: string) => Promise<void> | void;
}

/**
 * URL の見た目の違い（スキーム・末尾のスラッシュ・大文字小文字）を無視して比べる
 */
function plainUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * 語がタイトルに含まれているか。「Tyrell FX」と「FX - 製品情報 - Tyrell Bike」のように
 * 語順が違っても、語ごとに全部あれば同じものとみなす（transcriber 側の判定と同じ）
 */
function titleMentions(term: string, title: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = title.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/**
 * 参考リンクの候補
 *
 * 校正の前の通読が集めた用語集（glossary.json）のうち、「一般名詞ではなく説明が要る」と
 * 判断され、Web で綴りと URL を確かめられた語を並べる。完了通知のメールに載るものと同じ。
 *
 * 自動では足さない。参考リンクは読む人に見せるものなので、人が「足す」か「見送る」かを
 * 決める。足すときはページのタイトルを取って参考リンクに入れる（取れなければ語をタイトルに
 * する）。見送った URL はエピソードに控え、次に開いたときには出さない。
 */
export function ReferenceLinkProposals({ episodeId, links, dismissed, onAdd, onDismiss }: Props) {
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    api
      .getGlossary(episodeId)
      .then((data) => {
        if (alive) setTerms(data.terms);
      })
      .catch(() => {
        // 用語集が無いだけなら、候補も無いだけ。画面を赤くするほどのことではない
        if (alive) setTerms([]);
      });

    return () => {
      alive = false;
    };
  }, [episodeId]);

  if (!terms) return null;

  const knownUrls = new Set(links.map((l) => plainUrl(l.url)));
  const gone = new Set(dismissed.map(plainUrl));

  const proposals = terms.filter((t) => {
    if (!t.notable || !t.url) return false;
    const key = plainUrl(t.url);
    if (knownUrls.has(key) || gone.has(key)) return false;
    return !links.some((l) => titleMentions(t.term, l.title || ""));
  });

  if (proposals.length === 0) return null;

  const add = async (term: GlossaryTerm) => {
    if (!term.url) return;
    setBusy(term.url);
    setError(null);

    let title = term.term;
    try {
      const fetched = await api.fetchLinkTitle(term.url);
      if (fetched.title?.trim()) title = fetched.title.trim();
    } catch {
      // タイトルが取れなくても語で足せる
    }

    try {
      await onAdd({ url: term.url, title });
    } catch (err) {
      setError(err instanceof Error ? err.message : "足せませんでした");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (term: GlossaryTerm) => {
    if (!term.url) return;
    setBusy(term.url);
    setError(null);
    try {
      await onDismiss(term.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "見送れませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className="text-xs text-[var(--color-text-muted)] mb-2">
        候補 {proposals.length} 件（文字起こしの通読が見つけた語。足すか見送るかを選ぶ）
      </p>

      {error && <p className="text-xs text-[var(--color-error)] mb-2">{error}</p>}

      <ul className="space-y-2">
        {proposals.map((term) => {
          const working = busy === term.url;
          return (
            <li
              key={term.url}
              className="flex items-start justify-between gap-3 text-sm bg-[var(--color-bg-elevated)] rounded-lg p-3"
            >
              <div className="min-w-0">
                <div className="text-[var(--color-text-primary)]">
                  {term.term}
                  {term.note && (
                    <span className="text-[var(--color-text-muted)]">（{term.note}）</span>
                  )}
                </div>
                <a
                  href={term.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] break-all"
                >
                  {term.url}
                </a>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-primary text-sm"
                  disabled={busy !== null}
                  onClick={() => add(term)}
                >
                  {working ? "…" : "足す"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  disabled={busy !== null}
                  onClick={() => dismiss(term)}
                >
                  見送る
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
