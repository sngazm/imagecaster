import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePodcast } from "../contexts/PodcastContext";
import { podcastsApi } from "../lib/api";

export default function PodcastList() {
  const navigate = useNavigate();
  const { podcasts, refreshPodcasts, selectPodcast } = usePodcast();
  const [isCreating, setIsCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || !newTitle.trim()) return;

    try {
      setCreating(true);
      setError(null);
      await podcastsApi.create({ id: newId.trim(), title: newTitle.trim() });
      await refreshPodcasts();
      selectPodcast(newId.trim());
      setNewId("");
      setNewTitle("");
      setIsCreating(false);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？この操作は取り消せません。`)) return;

    try {
      setDeleting(id);
      setError(null);
      await podcastsApi.delete(id);
      await refreshPodcasts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <header className="mb-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">ポッドキャスト管理</h1>
          <button
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規作成
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-lg">
          {error}
        </div>
      )}

      {isCreating && (
        <div className="mb-6 bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">新規ポッドキャスト</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                ID（slug）
              </label>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-podcast"
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors font-mono"
              />
              <p className="text-xs text-zinc-500 mt-1">URLやファイルパスに使用されます（小文字英数字とハイフンのみ）</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                タイトル
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="マイポッドキャスト"
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !newId.trim() || !newTitle.trim()}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50"
              >
                {creating ? "作成中..." : "作成"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewId("");
                  setNewTitle("");
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {podcasts.map((podcast) => (
          <div
            key={podcast.id}
            className="flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-zinc-200 truncate">{podcast.title}</h3>
              <p className="text-sm text-zinc-500 font-mono">{podcast.id}</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => {
                  selectPodcast(podcast.id);
                  navigate("/");
                }}
                className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                選択
              </button>
              <button
                onClick={() => handleDelete(podcast.id, podcast.title)}
                disabled={deleting === podcast.id}
                className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {podcasts.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <p className="mb-4">ポッドキャストがありません</p>
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors"
            >
              最初のポッドキャストを作成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
