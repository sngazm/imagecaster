import { ReviewInbox } from "../components/ReviewInbox";
import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Episode, PublishStatus, TranscribeStatus } from "../lib/api";

// PublishStatus badge configuration
const PUBLISH_STATUS_CONFIG: Record<PublishStatus, { label: string; badgeClass: string }> = {
  new: { label: "新規", badgeClass: "badge badge-default" },
  uploading: { label: "アップロード中", badgeClass: "badge badge-warning" },
  draft: { label: "下書き", badgeClass: "badge badge-default" },
  scheduled: { label: "予約済み", badgeClass: "badge badge-info" },
  published: { label: "公開済み", badgeClass: "badge badge-success" },
};

// TranscribeStatus badge configuration (shown as secondary badge)
// 詳細画面 (EpisodeDetail) と同じ表記を使う
const TRANSCRIBE_STATUS_CONFIG: Record<TranscribeStatus, { label: string; badgeClass: string }> = {
  none: { label: "文字起こし未", badgeClass: "badge badge-default" },
  pending: { label: "文字起こし待ち", badgeClass: "badge badge-default" },
  transcribing: { label: "文字起こし中", badgeClass: "badge badge-warning" },
  completed: { label: "文字起こし完了", badgeClass: "badge badge-success" },
  failed: { label: "文字起こし失敗", badgeClass: "badge badge-error" },
  skipped: { label: "スキップ済み", badgeClass: "badge badge-default" },
};

/** 2026/11/23 の形 */
function formatDay(dateString: string | null): string {
  if (!dateString) return "—";
  const d = new Date(dateString);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 11/28 6:00 の形。予約の日時に使う */
function formatSoon(dateString: string): string {
  const d = new Date(dateString);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 「#12 タイトル」の形なら、番号（12）とタイトルに分ける */
function splitTitle(title: string): { number: string | null; rest: string } {
  const match = title.match(/^[#＃]\s?(\d[\d\-.]*)\s+(.+)$/);
  return match ? { number: match[1], rest: match[2] } : { number: null, rest: title };
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
    <div className="max-w-4xl mx-auto px-5 md:px-6 py-5 md:py-8">
      <header className="mb-5 md:mb-6 flex items-center justify-between gap-4">
        <h1 className="text-lg md:text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
          エピソード
        </h1>
        {/* PC は上のナビに同じボタンがある */}
        <div className="md:hidden">
          <Link to="/new" className="btn btn-primary text-sm">
            新規
          </Link>
        </div>
      </header>

      <ReviewInbox />

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
        <div>
          <div className="rule-heading flex items-baseline justify-between">
            <span>すべて {episodes.length}</span>
          </div>
          {currentEpisodes.map((ep) => {
            const publishStatus = PUBLISH_STATUS_CONFIG[ep.publishStatus];
            const transcribeStatus = TRANSCRIBE_STATUS_CONFIG[ep.transcribeStatus];
            const { number, rest } = splitTitle(ep.title);
            // 公開の状態は 1 つにまとめて出す。予約は日時、公開済みは日付を添える
            const publishLabel =
              ep.publishStatus === "scheduled" && ep.publishAt
                ? `予約 ${formatSoon(ep.publishAt)}`
                : ep.publishStatus === "published"
                  ? `公開済み・${formatDay(ep.publishAt)}`
                  : publishStatus.label;
            // 文字起こしは、済んでいる・飛ばした回では出さない。手が要るときだけ出す
            const showTranscribe = !["completed", "skipped"].includes(ep.transcribeStatus);
            return (
              <Link
                key={ep.id}
                to={`/episodes/${ep.id}`}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)] md:grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-2 md:gap-x-4 items-baseline py-3 md:py-0 md:min-h-[52px] md:items-center border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] transition-colors"
              >
                <span className="text-[13px] md:text-sm font-bold tracking-tight tabular-nums">{number ?? ""}</span>
                <span className="min-w-0 text-sm md:text-[15px] font-medium leading-relaxed md:truncate line-clamp-2 md:line-clamp-none">
                  {rest}
                </span>
                <span className="col-start-2 md:col-start-3 mt-1 md:mt-0 flex flex-wrap items-center gap-x-4">
                  {showTranscribe && (
                    <span className={transcribeStatus.badgeClass}>{transcribeStatus.label}</span>
                  )}
                  <span className={publishStatus.badgeClass}>{publishLabel}</span>
                </span>
              </Link>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-5">
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
                          ? "font-bold text-[var(--color-text-primary)] underline underline-offset-4 decoration-2"
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
