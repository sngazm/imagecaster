import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, Episode } from "../lib/api";
import { BuildStatus } from "../components/BuildStatus";
import { fetchApplePodcastsEpisodes } from "../lib/itunes";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "下書き", color: "bg-zinc-800 text-zinc-400" },
  uploading: { label: "アップロード中", color: "bg-amber-500/10 text-amber-500" },
  processing: { label: "処理中", color: "bg-amber-500/10 text-amber-500" },
  transcribing: { label: "文字起こし中", color: "bg-amber-500/10 text-amber-500" },
  scheduled: { label: "予約済み", color: "bg-blue-500/10 text-blue-500" },
  published: { label: "公開済み", color: "bg-emerald-500/10 text-emerald-500" },
  failed: { label: "エラー", color: "bg-red-500/10 text-red-500" },
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
  const [autoFetchStatus, setAutoFetchStatus] = useState<string | null>(null);
  const autoFetchRan = useRef(false);

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

  // Apple Podcasts URL 自動取得
  useEffect(() => {
    if (autoFetchRan.current || isLoading || episodes.length === 0) return;
    autoFetchRan.current = true;

    const autoFetch = async () => {
      try {
        const settings = await api.getSettings();

        // 自動取得が無効または ID が未設定
        if (!settings.applePodcastsAutoFetch || !settings.applePodcastsId) {
          return;
        }

        // 公開から1日以上経過 & applePodcastsUrl が未設定のエピソードを抽出
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const targetEpisodes = episodes.filter((ep) => {
          if (ep.status !== "published" || ep.applePodcastsUrl) return false;
          const publishedAt = ep.publishedAt ? new Date(ep.publishedAt).getTime() : 0;
          return publishedAt > 0 && publishedAt < oneDayAgo;
        });

        if (targetEpisodes.length === 0) return;

        setAutoFetchStatus(`Apple Podcasts URL を確認中... (${targetEpisodes.length}件)`);

        // iTunes API からエピソード情報を取得
        const episodeMap = await fetchApplePodcastsEpisodes(settings.applePodcastsId);

        let foundCount = 0;
        for (const ep of targetEpisodes) {
          const guid = ep.sourceGuid || ep.slug || ep.id;
          const applePodcastsUrl = episodeMap.get(guid);

          if (applePodcastsUrl) {
            await api.updateEpisode(ep.id, { applePodcastsUrl });
            foundCount++;
          }
        }

        if (foundCount > 0) {
          setAutoFetchStatus(`${foundCount}件のApple Podcasts URLを設定しました`);
          // エピソード一覧を再取得
          await fetchEpisodes();
          setTimeout(() => setAutoFetchStatus(null), 3000);
        } else {
          setAutoFetchStatus(null);
        }
      } catch (err) {
        console.error("Auto-fetch Apple Podcasts failed:", err);
        setAutoFetchStatus(null);
      }
    };

    autoFetch();
  }, [isLoading, episodes]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 pt-14">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">エピソード</h1>
        <div className="flex items-center gap-3">
          <BuildStatus />
          <Link
            to="/settings"
            className="p-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            title="設定"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
          <Link
            to="/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-violet-500/25 hover:-translate-y-0.5"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規登録
          </Link>
        </div>
      </header>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-zinc-700 border-t-violet-500 rounded-full animate-spin mb-4" />
          <p className="text-zinc-500">読み込み中...</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {autoFetchStatus && (
        <div className="mb-4 p-3 bg-pink-500/10 border border-pink-500/30 rounded-lg text-pink-400 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.001 2C6.477 2 2 6.477 2 12c0 4.544 3.047 8.368 7.197 9.58-.07-.51-.13-1.29.025-1.845.14-.495.9-3.17.9-3.17s-.23-.46-.23-1.14c0-1.066.62-1.863 1.39-1.863.656 0 .972.493.972 1.084 0 .66-.42 1.647-.637 2.562-.18.764.383 1.388 1.136 1.388 1.364 0 2.413-1.438 2.413-3.516 0-1.838-1.32-3.123-3.206-3.123-2.182 0-3.464 1.637-3.464 3.33 0 .66.254 1.367.572 1.75.063.077.072.144.053.222-.058.243-.188.764-.214.87-.034.141-.11.17-.256.103-.956-.445-1.553-1.842-1.553-2.965 0-2.413 1.753-4.63 5.055-4.63 2.654 0 4.717 1.89 4.717 4.416 0 2.636-1.662 4.76-3.968 4.76-.775 0-1.503-.403-1.752-.878l-.477 1.818c-.173.664-.639 1.496-.951 2.004A9.97 9.97 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
          </svg>
          {autoFetchStatus}
        </div>
      )}

      {!isLoading && !error && episodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-zinc-300 mb-2">エピソードがありません</h3>
          <p className="text-zinc-500 mb-6">最初のエピソードを登録しましょう</p>
          <Link
            to="/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-all"
          >
            新規登録
          </Link>
        </div>
      )}

      {!isLoading && !error && episodes.length > 0 && (
        <div className="space-y-3">
          {currentEpisodes.map((ep) => {
            const status = STATUS_CONFIG[ep.status] || { label: ep.status, color: "bg-zinc-800 text-zinc-400" };
            return (
              <Link
                key={ep.id}
                to={`/episodes/${ep.id}`}
                className="flex items-center gap-4 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:bg-zinc-900 hover:border-violet-500/50 transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                    {ep.title}
                  </h3>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    {ep.status === "scheduled" && ep.publishAt
                      ? `公開予定: ${formatDate(ep.publishAt)}`
                      : ep.publishAt
                        ? formatDate(ep.publishAt)
                        : "下書き"}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
                  {status.label}
                </span>
                <svg className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            );
          })}

          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-6 mt-4 border-t border-zinc-800">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                aria-label="前のページ"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  // 表示するページボタンを制限（現在ページ周辺のみ）
                  const showPage =
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - currentPage) <= 1;

                  const showEllipsisBefore = page === currentPage - 2 && currentPage > 3;
                  const showEllipsisAfter = page === currentPage + 2 && currentPage < totalPages - 2;

                  if (showEllipsisBefore || showEllipsisAfter) {
                    return (
                      <span key={page} className="px-2 text-zinc-600">
                        ...
                      </span>
                    );
                  }

                  if (!showPage) return null;

                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={`min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-all ${
                        page === currentPage
                          ? "bg-violet-600 text-white"
                          : "text-zinc-400 hover:text-white hover:bg-zinc-800"
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
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                aria-label="次のページ"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* ページ情報 */}
          {episodes.length > 0 && (
            <p className="text-center text-sm text-zinc-500 mt-4">
              {episodes.length}件中 {startIndex + 1}〜{Math.min(endIndex, episodes.length)}件を表示
            </p>
          )}
        </div>
      )}

      {!isLoading && (
        <button
          onClick={fetchEpisodes}
          disabled={isLoading}
          className="mt-6 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ↻ 更新
        </button>
      )}
    </div>
  );
}
