import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, EpisodeDetail as EpisodeDetailType, formatDuration, formatFileSize, uploadToR2, getAudioDuration } from "../lib/api";
import type { DescriptionTemplate } from "../lib/api";
import { HtmlEditor } from "../components/HtmlEditor";

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
  const [editSlug, setEditSlug] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPublishAt, setEditPublishAt] = useState("");
  const [editBlueskyPostText, setEditBlueskyPostText] = useState("");
  const [editBlueskyPostEnabled, setEditBlueskyPostEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Audio upload
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  // OGP image upload
  const [ogImageFile, setOgImageFile] = useState<File | null>(null);
  const [ogImagePreview, setOgImagePreview] = useState<string | null>(null);
  const [uploadingOgImage, setUploadingOgImage] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      try {
        setIsLoading(true);
        const [data, templatesData] = await Promise.all([
          api.getEpisode(id),
          api.getTemplates(),
        ]);
        setEpisode(data);
        setEditTitle(data.title);
        setEditSlug(data.slug || data.id);
        setEditDescription(data.description);
        setEditPublishAt(data.publishAt ? data.publishAt.slice(0, 16) : "");
        setEditBlueskyPostText(data.blueskyPostText || "");
        setEditBlueskyPostEnabled(data.blueskyPostEnabled);
        setTemplates(templatesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エピソードの取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleSave = async () => {
    if (!id || !episode) return;
    try {
      setIsSaving(true);
      setError(null);

      const updateData: Parameters<typeof api.updateEpisode>[1] = {
        title: editTitle,
        description: editDescription,
        publishAt: editPublishAt ? new Date(editPublishAt).toISOString() : null,
        blueskyPostText: editBlueskyPostText.trim() || null,
        blueskyPostEnabled: editBlueskyPostEnabled,
      };

      // slugの変更はdraft状態のみ
      if (episode.status === "draft" && editSlug !== episode.slug) {
        updateData.slug = editSlug;
      }

      const updated = await api.updateEpisode(id, updateData);
      setEpisode(updated);
      setIsEditing(false);

      // slugが変わった場合はURLを更新
      if (updated.id !== id) {
        navigate(`/episodes/${updated.id}`, { replace: true });
      }
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

  const handleAudioUpload = async () => {
    if (!id || !audioFile || !episode) return;

    try {
      setIsUploading(true);
      setUploadMessage("アップロード用URLを取得中...");

      const { uploadUrl } = await api.getUploadUrl(
        id,
        audioFile.type || "audio/mpeg",
        audioFile.size
      );

      setUploadMessage("音声をアップロード中...");
      await uploadToR2(uploadUrl, audioFile);

      setUploadMessage("処理を完了中...");
      const duration = await getAudioDuration(audioFile);
      await api.completeUpload(id, duration, audioFile.size);

      // リロード
      const updated = await api.getEpisode(id);
      setEpisode(updated);
      setAudioFile(null);
      setUploadMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setIsUploading(false);
    }
  };

  const applyTemplate = (template: DescriptionTemplate) => {
    setEditDescription(template.content);
    setShowTemplates(false);
  };

  const handleOgImageUpload = async () => {
    if (!id || !ogImageFile) return;

    setUploadingOgImage(true);
    setError(null);

    try {
      const { uploadUrl, ogImageUrl } = await api.getEpisodeOgImageUploadUrl(
        id,
        ogImageFile.type,
        ogImageFile.size
      );

      await uploadToR2(uploadUrl, ogImageFile);
      await api.completeEpisodeOgImageUpload(id, ogImageUrl);

      setEpisode((prev) => (prev ? { ...prev, ogImageUrl } : null));
      setOgImageFile(null);
      setOgImagePreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OGP画像のアップロードに失敗しました");
    } finally {
      setUploadingOgImage(false);
    }
  };

  const handleOgImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOgImageFile(file);
      setOgImagePreview(URL.createObjectURL(file));
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

  if (!episode) {
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
  const audioUrl = episode.audioUrl || episode.sourceAudioUrl;
  const canEditSlug = episode.status === "draft";

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
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="block w-full text-2xl font-bold bg-transparent border-b-2 border-violet-500 focus:outline-none"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight">{episode.title}</h1>
            )}
            {isEditing && canEditSlug && (
              <div className="mt-2">
                <label className="text-xs text-zinc-500">Slug:</label>
                <input
                  type="text"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="ml-2 text-sm font-mono text-zinc-400 bg-transparent border-b border-zinc-600 focus:outline-none focus:border-violet-500"
                />
              </div>
            )}
            {!isEditing && (
              <p className="text-xs text-zinc-500 mt-1 font-mono">{episode.slug || episode.id}</p>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 ${status.color}`}>
            {status.label}
          </span>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">閉じる</button>
        </div>
      )}

      {/* 音声プレイヤー */}
      {audioUrl ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-6">
          <audio src={audioUrl} controls className="w-full" />
          {episode.sourceAudioUrl && !episode.audioUrl && (
            <p className="text-xs text-zinc-500 mt-2">外部音声ファイルを参照しています</p>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">音声ファイル</h2>
          <p className="text-zinc-500 text-sm mb-4">音声ファイルがまだアップロードされていません。</p>

          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
            disabled={isUploading}
            className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 disabled:opacity-50"
          />

          {audioFile && (
            <div className="mt-3">
              <p className="text-sm text-zinc-400 mb-2">
                {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
              </p>
              <button
                onClick={handleAudioUpload}
                disabled={isUploading}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isUploading ? uploadMessage : "アップロード"}
              </button>
            </div>
          )}
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

        {/* 公開日時 */}
        {isEditing && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-zinc-400 mb-2">公開日時</label>
            <input
              type="datetime-local"
              value={editPublishAt}
              onChange={(e) => setEditPublishAt(e.target.value)}
              className="w-full px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-violet-500"
            />
            <p className="text-xs text-zinc-600 mt-1">空欄にすると下書き状態になります</p>
          </div>
        )}

        {/* 説明 */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-zinc-400">説明</h3>
            {isEditing && templates.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  テンプレートから挿入
                </button>
                {showTemplates && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 first:rounded-t-lg last:rounded-b-lg"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {isEditing ? (
            <HtmlEditor
              value={editDescription}
              onChange={setEditDescription}
              placeholder="エピソードの説明を入力..."
            />
          ) : (
            <div
              className="bg-zinc-900 rounded-lg p-4 text-zinc-400 text-sm prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: episode.description || "<p>説明がありません</p>" }}
            />
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
                  setEditSlug(episode.slug || episode.id);
                  setEditDescription(episode.description);
                  setEditPublishAt(episode.publishAt ? episode.publishAt.slice(0, 16) : "");
                  setEditBlueskyPostText(episode.blueskyPostText || "");
                  setEditBlueskyPostEnabled(episode.blueskyPostEnabled);
                  setError(null);
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

      {/* Bluesky 自動投稿 */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          <h2 className="text-sm font-medium text-zinc-400">Bluesky 自動投稿</h2>
        </div>

        {episode.blueskyPostedAt ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            投稿済み: {formatDate(episode.blueskyPostedAt)}
          </div>
        ) : isEditing ? (
          <div className="space-y-4">
            <label className="flex items-start gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700 transition-colors">
              <input
                type="checkbox"
                checked={editBlueskyPostEnabled}
                onChange={(e) => setEditBlueskyPostEnabled(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-sky-600 focus:ring-sky-500 focus:ring-offset-0"
              />
              <div>
                <span className="block text-sm font-medium text-zinc-200">
                  公開時にBlueskyに投稿する
                </span>
                <span className="block text-xs text-zinc-500 mt-1">
                  エピソード公開時に下記のテキストを自動投稿します
                </span>
              </div>
            </label>

            {editBlueskyPostEnabled && (
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  投稿テキスト
                </label>
                <textarea
                  value={editBlueskyPostText}
                  onChange={(e) => setEditBlueskyPostText(e.target.value)}
                  placeholder={"🎙️ 新エピソード公開！\n{{TITLE}}\n\n詳しくはこちら👇\n{{EPISODE_URL}}"}
                  rows={5}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all font-mono text-sm"
                />
                <p className="text-xs text-zinc-500 mt-2">
                  使用可能なプレースホルダ: <code className="text-sky-400">{"{{TITLE}}"}</code> <code className="text-sky-400">{"{{EPISODE_URL}}"}</code> <code className="text-sky-400">{"{{AUDIO_URL}}"}</code>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            {episode.blueskyPostEnabled ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-sky-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  公開時に投稿予定
                </div>
                {episode.blueskyPostText && (
                  <div className="bg-zinc-900 rounded-lg p-4 text-zinc-400 text-sm font-mono whitespace-pre-wrap">
                    {episode.blueskyPostText}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">Bluesky投稿は無効です</p>
            )}
          </div>
        )}
      </div>

      {/* OGP画像 */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">OGP画像</h2>
        <p className="text-xs text-zinc-500 mb-4">
          SNSでこのエピソードがシェアされた時に表示される画像です。
        </p>
        <div className="flex items-start gap-6">
          <div className="w-48 h-24 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
            {(ogImagePreview || episode.ogImageUrl) ? (
              <img
                src={ogImagePreview || episode.ogImageUrl || ""}
                alt="OGP image"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1">
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleOgImageSelect}
              className="hidden"
              id="episode-og-image-upload"
            />
            <label
              htmlFor="episode-og-image-upload"
              className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg cursor-pointer text-sm font-medium transition-colors"
            >
              画像を選択
            </label>
            {ogImageFile && (
              <div className="mt-3">
                <p className="text-sm text-zinc-400 mb-2">
                  {ogImageFile.name} ({(ogImageFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
                <button
                  type="button"
                  onClick={handleOgImageUpload}
                  disabled={uploadingOgImage}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {uploadingOgImage ? "アップロード中..." : "アップロード"}
                </button>
              </div>
            )}
            <p className="text-xs text-zinc-500 mt-2">
              推奨: 1200x630px、JPEGまたはPNG、最大5MB
            </p>
          </div>
        </div>
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
