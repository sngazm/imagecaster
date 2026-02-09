import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export interface ReferenceLink {
  url: string;
  title: string;
}

interface ReferenceLinksEditorProps {
  links: ReferenceLink[];
  onChange: (links: ReferenceLink[]) => void;
  disabled?: boolean;
}

/**
 * URLをクリーンにする（トラッキングパラメータを削除）
 */
function cleanUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Amazon用のクリーニング
    if (urlObj.hostname.includes("amazon.")) {
      // ASINを抽出
      const dpMatch = urlObj.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
      const gpMatch = urlObj.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      const asin = dpMatch?.[1] || gpMatch?.[1];

      if (asin) {
        // シンプルなURLを返す
        return `https://${urlObj.hostname}/dp/${asin}`;
      }
    }

    // 一般的なトラッキングパラメータを削除
    const trackingParams = [
      // UTMパラメータ
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
      // 広告系
      "fbclid", "gclid", "gclsrc", "msclkid", "dclid", "twclid",
      // メール系
      "mc_cid", "mc_eid",
      // アフィリエイト系
      "ref", "ref_", "tag",
      // その他
      "si", "feature", "pp", "_ga", "_gl", "igshid", "s", "t", "trk", "linkCode"
    ];

    for (const param of trackingParams) {
      urlObj.searchParams.delete(param);
    }

    // 不要なハッシュを削除（一部サイトで使われるトラッキング用ハッシュ）
    if (urlObj.hash && urlObj.hash.includes("=")) {
      urlObj.hash = "";
    }

    return urlObj.toString();
  } catch {
    return url;
  }
}

export function ReferenceLinksEditor({
  links,
  onChange,
  disabled = false,
}: ReferenceLinksEditorProps) {
  const [newUrl, setNewUrl] = useState("");
  // タイトル取得中のURLを追跡
  const [fetchingUrls, setFetchingUrls] = useState<Set<string>>(new Set());
  // 最新のlinksを参照するためのref
  const linksRef = useRef(links);
  // URL編集中のインデックス
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // 編集中のURL
  const [editingUrl, setEditingUrl] = useState("");
  // ドラッグ中のインデックス
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // ドロップ先のインデックス
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // linksが変わったらrefを更新
  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  const handleAddLink = async () => {
    if (!newUrl.trim()) return;

    // URLの正規化
    let url = newUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    // 重複チェック
    if (links.some((link) => link.url === url)) {
      setNewUrl("");
      return;
    }

    // 即座にリンクを追加（タイトルは空）
    onChange([...links, { url, title: "" }]);
    setNewUrl("");

    // タイトル取得
    await fetchTitleForUrl(url);
  };

  const fetchTitleForUrl = async (url: string) => {
    // タイトル取得中としてマーク
    setFetchingUrls((prev) => new Set(prev).add(url));

    try {
      // APIからタイトルを取得
      const { title } = await api.fetchLinkTitle(url);
      // 最新のlinksを使ってタイトルを更新
      onChange(
        linksRef.current.map((link) =>
          link.url === url ? { ...link, title: title || url } : link
        )
      );
    } catch {
      // エラー時はURLをタイトルとして使用
      onChange(
        linksRef.current.map((link) =>
          link.url === url && !link.title ? { ...link, title: url } : link
        )
      );
    } finally {
      setFetchingUrls((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddLink();
    }
  };

  const handleUpdateTitle = (index: number, title: string) => {
    const updated = [...links];
    updated[index] = { ...updated[index], title };
    onChange(updated);
  };

  const handleCleanUrl = (index: number) => {
    const updated = [...links];
    updated[index] = { ...updated[index], url: cleanUrl(updated[index].url) };
    onChange(updated);
  };

  const handleCleanAllUrls = () => {
    const updated = links.map((link) => ({
      ...link,
      url: cleanUrl(link.url),
    }));
    onChange(updated);
  };

  const handleRemoveLink = (index: number) => {
    onChange(links.filter((_, i) => i !== index));
  };

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // ドラッグ中の見た目を半透明にする
    if (e.currentTarget instanceof HTMLElement) {
      requestAnimationFrame(() => {
        (e.target as HTMLElement).style.opacity = "0.4";
      });
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = "";
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = [...links];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, moved);
    onChange(updated);
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, links, onChange]);

  const handleStartEditUrl = (index: number) => {
    setEditingIndex(index);
    setEditingUrl(links[index].url);
  };

  const handleCancelEditUrl = () => {
    setEditingIndex(null);
    setEditingUrl("");
  };

  const handleUpdateUrl = async (index: number) => {
    if (!editingUrl.trim()) return;

    // URLの正規化
    let url = editingUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    const oldUrl = links[index].url;

    // 同じURLの場合は何もしない
    if (url === oldUrl) {
      setEditingIndex(null);
      setEditingUrl("");
      return;
    }

    // 重複チェック（自分以外）
    if (links.some((link, i) => i !== index && link.url === url)) {
      return;
    }

    // URLを更新（タイトルは空にして再取得）
    const updated = [...links];
    updated[index] = { url, title: "" };
    onChange(updated);

    setEditingIndex(null);
    setEditingUrl("");

    // タイトルを再取得
    await fetchTitleForUrl(url);
  };

  const handleEditUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUpdateUrl(index);
    } else if (e.key === "Escape") {
      handleCancelEditUrl();
    }
  };

  return (
    <div className="space-y-3">
      {/* リンク一覧 */}
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((link, index) => {
            const isFetching = fetchingUrls.has(link.url);
            const isEditingThisUrl = editingIndex === index;
            const isDragOver = dragOverIndex === index && dragIndex !== index;
            return (
              <div
                key={`${index}-${link.url}`}
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                className={`flex items-start gap-2 p-3 bg-[var(--color-bg-elevated)] border rounded-lg transition-colors ${
                  isDragOver
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "border-[var(--color-border)]"
                }`}
              >
                {/* ドラッグハンドル */}
                <div
                  className={`shrink-0 pt-2 ${disabled ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing"} text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors`}
                  title="ドラッグで並び替え"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="9" cy="5" r="1.5" />
                    <circle cx="15" cy="5" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="19" r="1.5" />
                    <circle cx="15" cy="19" r="1.5" />
                  </svg>
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={link.title}
                      onChange={(e) => handleUpdateTitle(index, e.target.value)}
                      disabled={disabled || isFetching}
                      placeholder={isFetching ? "タイトル取得中..." : "タイトル"}
                      className="w-full px-3 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] text-sm focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
                    />
                    {isFetching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingThisUrl ? (
                      <>
                        <input
                          type="url"
                          value={editingUrl}
                          onChange={(e) => setEditingUrl(e.target.value)}
                          onKeyDown={(e) => handleEditUrlKeyDown(e, index)}
                          disabled={disabled}
                          autoFocus
                          className="flex-1 px-2 py-1 bg-[var(--color-bg-base)] border border-[var(--color-accent)] rounded text-[var(--color-text-primary)] text-xs focus:outline-none"
                          placeholder="URLを入力..."
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateUrl(index)}
                          disabled={disabled || !editingUrl.trim()}
                          className="shrink-0 px-2 py-1 text-xs text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors disabled:opacity-50"
                          title="URLを更新"
                        >
                          更新
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditUrl}
                          disabled={disabled}
                          className="shrink-0 px-2 py-1 text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] rounded transition-colors disabled:opacity-50"
                          title="キャンセル"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] truncate"
                        >
                          {link.url}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleStartEditUrl(index)}
                          disabled={disabled || isFetching}
                          className="shrink-0 px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] rounded transition-colors disabled:opacity-50"
                          title="URLを編集"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCleanUrl(index)}
                          disabled={disabled}
                          className="shrink-0 px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-success)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] rounded transition-colors disabled:opacity-50"
                          title="URLをクリーン"
                        >
                          Clean
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveLink(index)}
                  disabled={disabled}
                  className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors disabled:opacity-50"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 新規追加 */}
      <div className="flex gap-2">
        <input
          type="url"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="URLを入力して追加..."
          className="flex-1 px-4 py-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50 text-sm"
        />
        <button
          type="button"
          onClick={handleAddLink}
          disabled={disabled || !newUrl.trim()}
          className="px-4 py-2 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          追加
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-faint)]">
          URLを入力するとページタイトルを自動取得します。タイトルは後から編集可能です。
        </p>
        {links.length > 0 && (
          <button
            type="button"
            onClick={handleCleanAllUrls}
            disabled={disabled}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-success)] transition-colors disabled:opacity-50"
          >
            全URLをクリーン
          </button>
        )}
      </div>
    </div>
  );
}
