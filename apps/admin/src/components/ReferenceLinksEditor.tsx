import { useState } from "react";
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
  const [isFetching, setIsFetching] = useState(false);

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

    setIsFetching(true);
    try {
      // APIからタイトルを取得
      const { title } = await api.fetchLinkTitle(url);
      onChange([...links, { url, title: title || url }]);
      setNewUrl("");
    } catch (err) {
      // エラー時はURLをタイトルとして使用
      onChange([...links, { url, title: url }]);
      setNewUrl("");
    } finally {
      setIsFetching(false);
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

  return (
    <div className="space-y-3">
      {/* リンク一覧 */}
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((link, index) => (
            <div
              key={index}
              className="flex items-start gap-2 p-3 bg-zinc-900 border border-zinc-800 rounded-lg"
            >
              <div className="flex-1 min-w-0 space-y-2">
                <input
                  type="text"
                  value={link.title}
                  onChange={(e) => handleUpdateTitle(index, e.target.value)}
                  disabled={disabled}
                  placeholder="タイトル"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 text-sm focus:outline-none focus:border-violet-500 disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-violet-400 hover:text-violet-300 truncate"
                  >
                    {link.url}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCleanUrl(index)}
                    disabled={disabled}
                    className="shrink-0 px-2 py-1 text-xs text-zinc-400 hover:text-emerald-400 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
                    title="URLをクリーン"
                  >
                    Clean
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveLink(index)}
                disabled={disabled}
                className="p-2 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
                title="削除"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新規追加 */}
      <div className="flex gap-2">
        <input
          type="url"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isFetching}
          placeholder="URLを入力して追加..."
          className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 disabled:opacity-50 text-sm"
        />
        <button
          type="button"
          onClick={handleAddLink}
          disabled={disabled || isFetching || !newUrl.trim()}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isFetching ? (
            <>
              <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
              取得中
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              追加
            </>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-600">
          URLを入力するとページタイトルを自動取得します。タイトルは後から編集可能です。
        </p>
        {links.length > 0 && (
          <button
            type="button"
            onClick={handleCleanAllUrls}
            disabled={disabled}
            className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
          >
            全URLをクリーン
          </button>
        )}
      </div>
    </div>
  );
}
