import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Episode } from "../lib/api";

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

export default function EpisodeList() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="max-w-4xl mx-auto px-6 py-10">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">エピソード</h1>
        <div className="flex items-center gap-3">
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
          {episodes.map((ep) => {
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
                    {ep.publishAt ? formatDate(ep.publishAt) : "下書き"}
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
