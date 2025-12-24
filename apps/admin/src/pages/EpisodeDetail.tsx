import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, EpisodeDetail as EpisodeDetailType, formatDuration, formatFileSize } from "../lib/api";

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

export default function EpisodeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [episode, setEpisode] = useState<EpisodeDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fetchEpisode = async () => {
      if (!id) return;
      try {
        setIsLoading(true);
        const data = await api.getEpisode(id);
        setEpisode(data);
        setEditTitle(data.title);
        setEditDescription(data.description);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エピソードの取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    };
    fetchEpisode();
  }, [id]);

  const handleSave = async () => {
    if (!id || !episode) return;
    try {
      setIsSaving(true);
      const updated = await api.updateEpisode(id, {
        title: editTitle,
        description: editDescription,
      });
      setEpisode(updated);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm("本当に削除しますか？この操作は取り消せません。")) return;
    try {
      setIsDeleting(true);
      await api.deleteEpisode(id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-zinc-700 border-t-violet-500 rounded-full animate-spin mb-4" />
          <p className="text-zinc-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !episode) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </Link>
        <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
          {error || "エピソードが見つかりません"}
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[episode.status] || { label: episode.status, color: "bg-zinc-800 text-zinc-400" };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-violet-500">#{episode.episodeNumber}</span>
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 block w-full text-2xl font-bold bg-transparent border-b-2 border-violet-500 focus:outline-none"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight mt-1">{episode.title}</h1>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 ${status.color}`}>
            {status.label}
          </span>
        </div>
      </header>

      {/* 音声プレイヤー */}
      {episode.audioUrl && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-6">
          <audio src={episode.audioUrl} controls className="w-full" />
        </div>
      )}

      {/* 詳細情報 */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">詳細情報</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-zinc-900 rounded-lg p-4">
            <div className="text-xs text-zinc-500 mb-1">再生時間</div>
            <div className="text-zinc-200 font-medium">{formatDuration(episode.duration)}</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4">
            <div className="text-xs text-zinc-500 mb-1">ファイルサイズ</div>
            <div className="text-zinc-200 font-medium">{formatFileSize(episode.fileSize)}</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4">
            <div className="text-xs text-zinc-500 mb-1">作成日</div>
            <div className="text-zinc-200 font-medium">{formatDate(episode.createdAt)}</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4">
            <div className="text-xs text-zinc-500 mb-1">公開日</div>
            <div className="text-zinc-200 font-medium">{formatDate(episode.publishedAt)}</div>
          </div>
        </div>

        {/* 説明 */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-2">説明</h3>
          {isEditing ? (
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-violet-500 resize-none"
            />
          ) : (
            <div className="bg-zinc-900 rounded-lg p-4 text-zinc-400 text-sm whitespace-pre-wrap">
              {episode.description || "説明がありません"}
            </div>
          )}
        </div>

        {/* 編集・保存ボタン */}
        <div className="flex gap-3 mt-6">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-all disabled:opacity-50"
              >
                {isSaving ? "保存中..." : "保存"}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditTitle(episode.title);
                  setEditDescription(episode.description);
                }}
                className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-lg transition-all"
              >
                キャンセル
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-lg transition-all"
            >
              編集
            </button>
          )}
        </div>
      </div>

      {/* 文字起こし */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">文字起こし</h2>
        {episode.skipTranscription ? (
          <p className="text-zinc-500 text-sm">文字起こしはスキップされました</p>
        ) : episode.transcriptUrl ? (
          <a
            href={episode.transcriptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            文字起こしを表示
          </a>
        ) : (
          <p className="text-zinc-500 text-sm">文字起こしはまだありません</p>
        )}
      </div>

      {/* 削除 */}
      <div className="border border-red-500/50 bg-red-500/5 rounded-xl p-6">
        <h2 className="text-sm font-medium text-red-400 mb-2">危険な操作</h2>
        <p className="text-zinc-500 text-sm mb-4">
          エピソードを削除すると、音声ファイルと文字起こしも削除されます。この操作は取り消せません。
        </p>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-5 py-2 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/50 hover:border-red-500 font-medium rounded-lg transition-all disabled:opacity-50"
        >
          {isDeleting ? "削除中..." : "エピソードを削除"}
        </button>
      </div>
    </div>
  );
}
