import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Episode } from "../lib/api";

// Status badge configuration using design tokens
const STATUS_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  draft: { label: "下書き", badgeClass: "badge badge-default" },
  uploading: { label: "アップロード中", badgeClass: "badge badge-warning" },
  processing: { label: "処理中", badgeClass: "badge badge-warning" },
  transcribing: { label: "文字起こし中", badgeClass: "badge badge-warning" },
  scheduled: { label: "予約済み", badgeClass: "badge badge-info" },
  published: { label: "公開済み", badgeClass: "badge badge-success" },
  failed: { label: "エラー", badgeClass: "badge badge-error" },
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ITEMS_PER_PAGE = 10;

export default function EpisodeList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // URLクエリパラメータからページ番号を取得
  const currentPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  // ページネーション計算
  const totalPages = Math.ceil(episodes.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEpisodes = episodes.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      // URLクエリパラメータを更新（ブラウザ履歴に追加）
      setSearchParams(page === 1 ? {} : { page: String(page) });
      // ページトップにスクロール
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const fetchEpisodes = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const data = await api.getEpisodes();
      setEpisodes(data.episodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Page Header - Clean and minimal */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          エピソード
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {episodes.length > 0 ? `${episodes.length}件のエピソード` : "エピソードを作成しましょう"}
        </p>
      </header>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[var(--color-border-strong)] border-t-[var(--color-accent)] rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">読み込み中...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-4 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && episodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-[var(--color-text-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
            エピソードがありません
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] mb-5">
            最初のエピソードを作成しましょう
          </p>
          <Link
            to="/new"
            className="btn btn-primary text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規作成
          </Link>
        </div>
      )}

      {/* Episode List */}
      {!isLoading && !error && episodes.length > 0 && (
        <div className="space-y-2">
          {currentEpisodes.map((ep) => {
            const status = STATUS_CONFIG[ep.status] || { label: ep.status, badgeClass: "badge badge-default" };
            return (
              <Link
                key={ep.id}
                to={`/episodes/${ep.id}`}
                className="card flex items-center gap-4 p-4 hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)] truncate transition-colors">
                    {ep.title}
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">
                    {ep.status === "scheduled" && ep.publishAt
                      ? `公開予定: ${formatDate(ep.publishAt)}`
                      : ep.publishAt
                        ? formatDate(ep.publishAt)
                        : "—"}
                  </p>
                </div>
                <span className={status.badgeClass}>
                  {status.label}
                </span>
                <svg className="w-4 h-4 text-[var(--color-text-faint)] group-hover:text-[var(--color-text-secondary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-6 mt-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="btn btn-ghost disabled:opacity-30"
                aria-label="前のページ"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <div className="flex items-center gap-0.5">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  const showPage =
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - currentPage) <= 1;

                  const showEllipsisBefore = page === currentPage - 2 && currentPage > 3;
                  const showEllipsisAfter = page === currentPage + 2 && currentPage < totalPages - 2;

                  if (showEllipsisBefore || showEllipsisAfter) {
                    return (
                      <span key={page} className="px-2 text-[var(--color-text-faint)] text-sm">
                        ...
                      </span>
                    );
                  }

                  if (!showPage) return null;

                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={`min-w-[32px] h-8 px-2 rounded-md text-sm font-medium transition-all ${
                        page === currentPage
                          ? "bg-[var(--color-accent)] text-white"
                          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="btn btn-ghost disabled:opacity-30"
                aria-label="次のページ"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Page Info */}
          {episodes.length > 0 && (
            <p className="text-center text-xs text-[var(--color-text-muted)] mt-3 font-mono">
              {startIndex + 1}〜{Math.min(endIndex, episodes.length)} / {episodes.length}
            </p>
          )}
        </div>
      )}

      {/* Refresh Button */}
      {!isLoading && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={fetchEpisodes}
            disabled={isLoading}
            className="btn btn-ghost text-xs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            更新
          </button>
        </div>
      )}
    </div>
  );
}
