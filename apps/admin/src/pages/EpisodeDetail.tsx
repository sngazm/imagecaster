import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, EpisodeDetail as EpisodeDetailType, formatDuration, formatFileSize, uploadToR2, getAudioDuration, utcToLocalDateTimeString, localDateTimeToISOString, fetchTranscriptSegments } from "../lib/api";
import type { DescriptionTemplate, ReferenceLink, TranscriptSegment, PublishStatus, TranscribeStatus } from "../lib/api";
import { HtmlEditor } from "../components/HtmlEditor";
import { DateTimePicker } from "../components/DateTimePicker";
import { BlueskyPostEditor } from "../components/BlueskyPostEditor";
import { ReferenceLinksEditor } from "../components/ReferenceLinksEditor";
import { getWebsiteUrl, getEnvironment } from "../lib/env";

// PublishStatus badge configuration
const PUBLISH_STATUS_CONFIG: Record<PublishStatus, { label: string; badgeClass: string }> = {
  new: { label: "新規", badgeClass: "badge badge-default" },
  uploading: { label: "アップロード中", badgeClass: "badge badge-warning" },
  draft: { label: "下書き", badgeClass: "badge badge-default" },
  scheduled: { label: "予約済み", badgeClass: "badge badge-info" },
  published: { label: "公開済み", badgeClass: "badge badge-success" },
};

// TranscribeStatus badge configuration
const TRANSCRIBE_STATUS_CONFIG: Record<TranscribeStatus, { label: string; badgeClass: string }> = {
  none: { label: "文字起こし未", badgeClass: "badge badge-default" },
  pending: { label: "文字起こし待ち", badgeClass: "badge badge-default" },
  transcribing: { label: "文字起こし中", badgeClass: "badge badge-warning" },
  completed: { label: "文字起こし完了", badgeClass: "badge badge-success" },
  failed: { label: "文字起こし失敗", badgeClass: "badge badge-error" },
  skipped: { label: "スキップ済み", badgeClass: "badge badge-default" },
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
  const [editReferenceLinks, setEditReferenceLinks] = useState<ReferenceLink[]>([]);
  const [editApplePodcastsUrl, setEditApplePodcastsUrl] = useState("");
  const [editSpotifyUrl, setEditSpotifyUrl] = useState("");
  const [editSkipTranscription, setEditSkipTranscription] = useState(false);
  const [editHideTranscription, setEditHideTranscription] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Audio upload
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  // Episode artwork upload
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [uploadingArtwork, setUploadingArtwork] = useState(false);

  // Website URL
  const [baseWebsiteUrl, setBaseWebsiteUrl] = useState<string>("");

  // Transcript
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      try {
        setIsLoading(true);
        const env = getEnvironment();

        // エピソードとテンプレートは必須なのでPromise.allで取得
        const [data, templatesData] = await Promise.all([
          api.getEpisode(id),
          api.getTemplates(),
        ]);

        setEpisode(data);
        setEditTitle(data.title);
        setEditSlug(data.slug || data.id);
        setEditDescription(data.description);
        setEditPublishAt(data.publishAt ? utcToLocalDateTimeString(data.publishAt) : "");
        setEditBlueskyPostText(data.blueskyPostText || "");
        setEditBlueskyPostEnabled(data.blueskyPostEnabled);
        setEditReferenceLinks(data.referenceLinks || []);
        setEditApplePodcastsUrl(data.applePodcastsUrl || "");
        setEditSpotifyUrl(data.spotifyUrl || "");
        setEditSkipTranscription(data.skipTranscription);
        setEditHideTranscription(data.hideTranscription || false);
        setTemplates(templatesData);

        // Fetch transcript segments if available
        if (data.transcriptUrl) {
          fetchTranscriptSegments(data.transcriptUrl).then(setTranscriptSegments);
        }

        // websiteUrlの取得（settingsから）
        if (env === "local") {
          // ローカル環境ではダミー値を設定（getWebsiteUrlがローカルURLに変換する）
          setBaseWebsiteUrl("local");
        } else {
          try {
            const settingsData = await api.getSettings();
            if (settingsData.websiteUrl) {
              setBaseWebsiteUrl(settingsData.websiteUrl);
            }
          } catch (err) {
            console.error("設定の取得に失敗しました:", err);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "エピソードの取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleSave = async (isDraft?: boolean) => {
    if (!id || !episode) return;
    try {
      setIsSaving(true);
      setError(null);

      // 下書き保存の場合は publishAt を null に、公開/予約の場合は日時を設定
      const canSchedule = ["draft", "scheduled", "published"].includes(episode.publishStatus);
      let publishAtValue: string | null;
      if (canSchedule && isDraft === true) {
        publishAtValue = null;
      } else if (canSchedule && isDraft === false) {
        publishAtValue = editPublishAt ? localDateTimeToISOString(editPublishAt) : new Date().toISOString();
      } else {
        publishAtValue = editPublishAt ? localDateTimeToISOString(editPublishAt) : null;
      }

      const updateData: Parameters<typeof api.updateEpisode>[1] = {
        title: editTitle,
        description: editDescription,
        publishAt: publishAtValue,
        blueskyPostText: editBlueskyPostText.trim() || null,
        blueskyPostEnabled: editBlueskyPostEnabled,
        referenceLinks: editReferenceLinks,
        applePodcastsUrl: editApplePodcastsUrl.trim() || null,
        spotifyUrl: editSpotifyUrl.trim() || null,
        hideTranscription: editHideTranscription,
      };

      // slugの変更はnew状態のみ
      if (episode.publishStatus === "new" && editSlug !== episode.slug) {
        updateData.slug = editSlug;
      }

      // skipTranscriptionの変更は文字起こしがまだない場合のみ
      if (!episode.transcriptUrl && editSkipTranscription !== episode.skipTranscription) {
        updateData.skipTranscription = editSkipTranscription;
      }

      const updated = await api.updateEpisode(id, updateData);
      setEpisode(updated);
      setEditPublishAt(updated.publishAt ? utcToLocalDateTimeString(updated.publishAt) : "");
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

  const handleArtworkUpload = async () => {
    if (!id || !artworkFile) return;

    setUploadingArtwork(true);
    setError(null);

    try {
      const { uploadUrl, artworkUrl } = await api.getEpisodeArtworkUploadUrl(
        id,
        artworkFile.type,
        artworkFile.size
      );

      await uploadToR2(uploadUrl, artworkFile);
      await api.completeEpisodeArtworkUpload(id, artworkUrl);

      setEpisode((prev) => (prev ? { ...prev, artworkUrl } : null));
      setArtworkFile(null);
      setArtworkPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アートワークのアップロードに失敗しました");
    } finally {
      setUploadingArtwork(false);
    }
  };

  const handleArtworkSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setArtworkFile(file);
      setArtworkPreview(URL.createObjectURL(file));
    }
  };

  const handleCancelEdit = () => {
    if (!episode) return;
    setIsEditing(false);
    setEditTitle(episode.title);
    setEditSlug(episode.slug || episode.id);
    setEditDescription(episode.description);
    setEditPublishAt(episode.publishAt ? utcToLocalDateTimeString(episode.publishAt) : "");
    setEditBlueskyPostText(episode.blueskyPostText || "");
    setEditBlueskyPostEnabled(episode.blueskyPostEnabled);
    setEditReferenceLinks(episode.referenceLinks || []);
    setEditApplePodcastsUrl(episode.applePodcastsUrl || "");
    setEditSpotifyUrl(episode.spotifyUrl || "");
    setEditSkipTranscription(episode.skipTranscription);
    setEditHideTranscription(episode.hideTranscription || false);
    setError(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-[var(--color-border-strong)] border-t-[var(--color-accent)] rounded-full animate-spin mb-4" />
          <p className="text-[var(--color-text-muted)]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </Link>
        <div className="p-4 bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-lg text-[var(--color-error)]">
          {error || "エピソードが見つかりません"}
        </div>
      </div>
    );
  }

  const publishStatus = PUBLISH_STATUS_CONFIG[episode.publishStatus];
  const transcribeStatus = TRANSCRIBE_STATUS_CONFIG[episode.transcribeStatus];
  const audioUrl = episode.audioUrl || episode.sourceAudioUrl;
  const canEditSlug = episode.publishStatus === "new";
  const episodeWebUrl = baseWebsiteUrl ? getWebsiteUrl(baseWebsiteUrl, episode.slug || episode.id) : null;
  const canShowWebLink = episode.publishStatus === "published" || episode.publishStatus === "scheduled";

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mb-4">
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
                className="block w-full text-2xl font-bold bg-transparent border-b-2 border-[var(--color-accent)] focus:outline-none text-[var(--color-text-primary)]"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{episode.title}</h1>
            )}
            {isEditing && canEditSlug && (
              <div className="mt-2">
                <label className="text-xs text-[var(--color-text-muted)]">Slug:</label>
                <input
                  type="text"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="ml-2 text-sm font-mono text-[var(--color-text-secondary)] bg-transparent border-b border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            )}
            {!isEditing && (
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-[var(--color-text-muted)] font-mono">{episode.slug || episode.id}</p>
                {canShowWebLink && episodeWebUrl && (
                  <a
                    href={episodeWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Webで見る
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 文字起こし状態を表示（特定の状態のみ） */}
            {(episode.transcribeStatus === "pending" ||
              episode.transcribeStatus === "transcribing" ||
              episode.transcribeStatus === "failed") && (
              <span className={transcribeStatus.badgeClass}>
                {transcribeStatus.label}
              </span>
            )}
            <span className={publishStatus.badgeClass}>
              {publishStatus.label}
            </span>
          </div>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-lg text-[var(--color-error)]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">閉じる</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左カラム: コンテンツ */}
        <div className="lg:col-span-2 space-y-6">
          {/* 音声プレイヤー */}
          {audioUrl ? (
            <div className="card p-4">
              <audio src={audioUrl} controls className="w-full" />
              {episode.sourceAudioUrl && !episode.audioUrl && (
                <p className="text-xs text-[var(--color-text-muted)] mt-2">外部音声ファイルを参照しています</p>
              )}
            </div>
          ) : (
            <div className="card p-6">
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                音声ファイル
              </h2>
              <p className="text-[var(--color-text-muted)] text-sm mb-4">音声ファイルがまだアップロードされていません。</p>

              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                disabled={isUploading}
                className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-secondary)] hover:file:bg-[var(--color-bg-hover)] disabled:opacity-50"
              />

              {audioFile && (
                <div className="mt-3">
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                    {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
                  </p>
                  <button
                    onClick={handleAudioUpload}
                    disabled={isUploading}
                    className="btn btn-primary"
                  >
                    {isUploading ? uploadMessage : "アップロード"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 詳細情報 */}
          <div className="card p-6">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              詳細情報
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4">
                <div className="text-xs text-[var(--color-text-muted)] mb-1">再生時間</div>
                <div className="text-[var(--color-text-primary)] font-medium">{formatDuration(episode.duration)}</div>
              </div>
              <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4">
                <div className="text-xs text-[var(--color-text-muted)] mb-1">ファイルサイズ</div>
                <div className="text-[var(--color-text-primary)] font-medium">{formatFileSize(episode.fileSize)}</div>
              </div>
              <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4">
                <div className="text-xs text-[var(--color-text-muted)] mb-1">作成日</div>
                <div className="text-[var(--color-text-primary)] font-medium">{formatDate(episode.createdAt)}</div>
              </div>
              <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4">
                <div className="text-xs text-[var(--color-text-muted)] mb-1">
                  {episode.publishStatus === "scheduled" ? "公開予定日" : "公開日"}
                </div>
                <div className="text-[var(--color-text-primary)] font-medium">
                  {episode.publishStatus === "scheduled"
                    ? formatDate(episode.publishAt)
                    : formatDate(episode.publishedAt)}
                </div>
              </div>
            </div>
          </div>

          {/* 説明 */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)] flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                説明
              </h2>
              {isEditing && templates.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                  >
                    テンプレートから挿入
                  </button>
                  {showTemplates && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-xl z-10">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => applyTemplate(t)}
                          className="w-full px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] first:rounded-t-lg last:rounded-b-lg"
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
                className="bg-[var(--color-bg-elevated)] rounded-lg p-4 text-[var(--color-text-secondary)] text-sm prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: episode.description || "<p>説明がありません</p>" }}
              />
            )}
          </div>

          {/* 参考リンク */}
          <div className="card p-6">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              参考リンク
            </h2>
            {isEditing ? (
              <ReferenceLinksEditor
                links={editReferenceLinks}
                onChange={setEditReferenceLinks}
              />
            ) : (
              <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4">
                {(episode.referenceLinks?.length || 0) > 0 ? (
                  <ul className="space-y-2">
                    {episode.referenceLinks?.map((link, index) => (
                      <li key={index} className="text-sm">
                        <span className="text-[var(--color-text-primary)]">{link.title}</span>
                        <br />
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                        >
                          {link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[var(--color-text-muted)] text-sm">参考リンクがありません</p>
                )}
              </div>
            )}
          </div>

          {/* 文字起こし */}
          <div className="card p-6">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              文字起こし
            </h2>
            {isEditing ? (
              <div className="space-y-4">
                {/* skipTranscription: 文字起こしがまだない場合は編集可能 */}
                {!episode.transcriptUrl && (
                  <label className="flex items-start gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-strong)] transition-colors">
                    <input
                      type="checkbox"
                      checked={editSkipTranscription}
                      onChange={(e) => setEditSkipTranscription(e.target.checked)}
                      className="mt-0.5 w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] focus:ring-offset-0"
                    />
                    <div>
                      <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                        文字起こしをスキップする
                      </span>
                      <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                        {episode.skipTranscription
                          ? "チェックを外すと文字起こしが開始されます"
                          : "チェックすると、アップロード後の自動文字起こしが実行されません"}
                      </span>
                    </div>
                  </label>
                )}
                {/* hideTranscription: 文字起こしがある場合のみ編集可能 */}
                {episode.transcriptUrl && (
                  <label className="flex items-start gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-strong)] transition-colors">
                    <input
                      type="checkbox"
                      checked={editHideTranscription}
                      onChange={(e) => setEditHideTranscription(e.target.checked)}
                      className="mt-0.5 w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] focus:ring-offset-0"
                    />
                    <div>
                      <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                        文字起こしを非表示にする
                      </span>
                      <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                        チェックすると、公開サイトで文字起こしが表示されなくなります
                      </span>
                    </div>
                  </label>
                )}
                {/* 現在の状態を表示 */}
                {episode.publishStatus !== "new" && episode.transcribeStatus !== "failed" && !episode.transcriptUrl && (
                  <p className="text-[var(--color-text-muted)] text-sm">
                    {episode.skipTranscription ? "文字起こしはスキップされました" : "文字起こしはまだありません"}
                  </p>
                )}
                {episode.transcriptUrl && (
                  <a
                    href={episode.transcriptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    文字起こしを表示
                  </a>
                )}
              </div>
            ) : (
              <>
                {episode.hideTranscription ? (
                  <p className="text-[var(--color-text-muted)] text-sm">文字起こしは非表示に設定されています</p>
                ) : episode.skipTranscription ? (
                  <p className="text-[var(--color-text-muted)] text-sm">文字起こしはスキップされました</p>
                ) : transcriptSegments.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setTranscriptOpen(!transcriptOpen)}
                      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${transcriptOpen ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      文字起こしを見る
                    </button>
                    {transcriptOpen && (
                      <div className="mt-3 max-h-96 overflow-y-auto overflow-x-hidden divide-y divide-[var(--color-border)]/50 pr-2">
                        {transcriptSegments.map((segment, idx) => (
                          <div key={idx} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                            <span className="shrink-0 pt-0.5 text-[10px] font-mono text-[var(--color-text-muted)]/70 tabular-nums opacity-60">
                              {segment.start}
                            </span>
                            <p className="text-sm leading-normal text-[var(--color-text-secondary)]">
                              {segment.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : episode.transcriptUrl ? (
                  <p className="text-[var(--color-text-muted)] text-sm">文字起こしを読み込み中...</p>
                ) : (
                  <p className="text-[var(--color-text-muted)] text-sm">文字起こしはまだありません</p>
                )}
              </>
            )}
          </div>

          {/* アートワーク */}
          <div className="card p-6">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
              </svg>
              アートワーク
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              このエピソード専用のアートワークです。未設定の場合はPodcastのアートワークが使用されます。
            </p>
            <div className="flex items-start gap-6">
              <div className="w-24 h-24 rounded-lg bg-[var(--color-bg-elevated)] overflow-hidden flex-shrink-0">
                {(artworkPreview || episode.artworkUrl) ? (
                  <img
                    src={artworkPreview || episode.artworkUrl || ""}
                    alt="Episode artwork"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-faint)]">
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
                  onChange={handleArtworkSelect}
                  className="hidden"
                  id="episode-artwork-upload"
                />
                <label
                  htmlFor="episode-artwork-upload"
                  className="btn btn-secondary inline-block cursor-pointer"
                >
                  画像を選択
                </label>
                {artworkFile && (
                  <div className="mt-3">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                      {artworkFile.name} ({(artworkFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                    <button
                      type="button"
                      onClick={handleArtworkUpload}
                      disabled={uploadingArtwork}
                      className="btn btn-primary"
                    >
                      {uploadingArtwork ? "アップロード中..." : "アップロード"}
                    </button>
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  推奨: 1400x1400px以上の正方形、JPEGまたはPNG、最大5MB
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 右カラム: 設定 */}
        <div className="space-y-6">
          {/* 公開設定 */}
          {isEditing && (
            <div className="card p-6 space-y-4">
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                公開設定
              </h2>
              <div>
                <label className="label">公開日時</label>
                <DateTimePicker
                  value={editPublishAt}
                  onChange={setEditPublishAt}
                  placeholder="公開日時を選択..."
                />
                <p className="text-xs text-[var(--color-text-faint)] mt-1">空欄にすると下書き状態になります</p>
              </div>
            </div>
          )}

          {/* Bluesky 自動投稿 */}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">Bluesky 自動投稿</h2>
            </div>

            {episode.blueskyPostedAt ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                投稿済み: {formatDate(episode.blueskyPostedAt)}
              </div>
            ) : isEditing ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-strong)] transition-colors">
                  <input
                    type="checkbox"
                    checked={editBlueskyPostEnabled}
                    onChange={(e) => setEditBlueskyPostEnabled(e.target.checked)}
                    className="mt-0.5 w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-bg-base)] text-sky-600 focus:ring-sky-500 focus:ring-offset-0"
                  />
                  <div>
                    <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                      公開時にBlueskyに投稿する
                    </span>
                    <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                      エピソード公開時に下記のテキストを自動投稿します
                    </span>
                  </div>
                </label>

                {editBlueskyPostEnabled && (
                  <div>
                    <label className="label">
                      投稿テキスト
                    </label>
                    <BlueskyPostEditor
                      value={editBlueskyPostText}
                      onChange={setEditBlueskyPostText}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                {episode.blueskyPostEnabled ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-sky-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      公開時に投稿予定
                    </div>
                    {episode.blueskyPostText && (
                      <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 text-[var(--color-text-secondary)] text-sm font-mono whitespace-pre-wrap">
                        {episode.blueskyPostText}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[var(--color-text-muted)] text-sm">Bluesky投稿は無効です</p>
                )}
              </div>
            )}
          </div>

          {/* Apple Podcasts */}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-pink-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.224 1.272 1.912 2.619 2.264 4.392.12.59.12 2.2.007 2.864a8.506 8.506 0 01-3.24 5.296c-.608.46-2.096 1.261-2.336 1.261-.088 0-.096-.091-.056-.46.072-.592.144-.715.48-.856.536-.224 1.448-.874 2.008-1.435a7.644 7.644 0 002.008-3.536c.208-.824.184-2.656-.048-3.504-.728-2.696-2.928-4.792-5.624-5.352-.784-.16-2.208-.16-3 0-2.728.56-4.984 2.76-5.672 5.528-.184.752-.184 2.584 0 3.336.456 1.832 1.64 3.512 3.192 4.512.304.2.672.408.824.472.336.144.408.264.472.856.04.36.03.464-.056.464-.056 0-.464-.176-.896-.384l-.04-.03c-2.472-1.216-4.056-3.274-4.632-6.012-.144-.706-.168-2.392-.03-3.04.36-1.74 1.048-3.1 2.192-4.304 1.648-1.737 3.768-2.656 6.128-2.656zm.134 2.81c.409.004.803.04 1.106.106 2.784.62 4.76 3.408 4.376 6.174-.152 1.114-.536 2.03-1.216 2.88-.336.43-1.152 1.15-1.296 1.15-.023 0-.048-.272-.048-.603v-.605l.416-.496c1.568-1.878 1.456-4.502-.256-6.224-.664-.67-1.432-1.064-2.424-1.246-.64-.118-.776-.118-1.448-.008-1.02.167-1.81.562-2.512 1.256-1.72 1.704-1.832 4.342-.264 6.222l.413.496v.608c0 .336-.027.608-.06.608-.03 0-.264-.16-.512-.36l-.034-.011c-.832-.664-1.568-1.842-1.872-2.997-.184-.698-.184-2.024.008-2.72.504-1.878 1.888-3.335 3.808-4.019.41-.145 1.133-.22 1.814-.211zm-.13 2.99c.31 0 .62.06.844.178.488.253.888.745 1.04 1.259.464 1.578-1.208 2.96-2.72 2.254h-.015c-.712-.331-1.096-.956-1.104-1.77 0-.733.408-1.371 1.112-1.745.224-.117.534-.176.844-.176zm-.011 4.728c.988-.004 1.706.349 1.97.97.198.464.124 1.932-.218 4.302-.232 1.656-.36 2.074-.68 2.356-.44.39-1.064.498-1.656.288h-.003c-.716-.257-.87-.605-1.164-2.644-.341-2.37-.416-3.838-.218-4.302.262-.616.974-.966 1.97-.97z"/>
              </svg>
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">Apple Podcasts</h2>
            </div>

            {isEditing ? (
              <div>
                <label className="label">
                  エピソードURL
                </label>
                <input
                  type="url"
                  value={editApplePodcastsUrl}
                  onChange={(e) => setEditApplePodcastsUrl(e.target.value)}
                  placeholder="https://podcasts.apple.com/..."
                  className="input"
                />
                <p className="text-xs text-[var(--color-text-faint)] mt-1">
                  管理画面起動時に自動取得されます
                </p>
              </div>
            ) : (
              episode.applePodcastsUrl ? (
                <a
                  href={episode.applePodcastsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-pink-500 hover:text-pink-400"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Apple Podcasts で開く
                </a>
              ) : (
                <p className="text-[var(--color-text-muted)] text-sm">未設定</p>
              )
            )}
          </div>

          {/* Spotify */}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">Spotify</h2>
            </div>

            {isEditing ? (
              <div>
                <label className="label">
                  エピソードURL
                </label>
                <input
                  type="url"
                  value={editSpotifyUrl}
                  onChange={(e) => setEditSpotifyUrl(e.target.value)}
                  placeholder="https://open.spotify.com/episode/..."
                  className="input"
                />
                <p className="text-xs text-[var(--color-text-faint)] mt-1">
                  管理画面起動時に自動取得されます
                </p>
              </div>
            ) : (
              episode.spotifyUrl ? (
                <a
                  href={episode.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-green-500 hover:text-green-400"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Spotify で開く
                </a>
              ) : (
                <p className="text-[var(--color-text-muted)] text-sm">未設定</p>
              )
            )}
          </div>

          {/* 編集・保存ボタン */}
          <div className="card p-6 space-y-3">
            {isEditing ? (
              ["draft", "scheduled", "published"].includes(episode.publishStatus) ? (
                <>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={isSaving}
                    className="btn btn-primary w-full py-3"
                  >
                    {isSaving ? "保存中..." : (editPublishAt ? "公開予約" : "今すぐ公開")}
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={isSaving}
                    className="btn btn-secondary w-full py-3"
                  >
                    {isSaving ? "保存中..." : "下書き保存"}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="btn btn-secondary w-full py-3"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleSave()}
                    disabled={isSaving}
                    className="btn btn-primary w-full py-3"
                  >
                    {isSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="btn btn-secondary w-full py-3"
                  >
                    キャンセル
                  </button>
                </>
              )
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="btn btn-secondary w-full py-3"
              >
                編集
              </button>
            )}
          </div>

          {/* 削除 */}
          <div className="border border-[var(--color-error)] bg-[var(--color-error-muted)] rounded-xl p-6">
            <h2 className="text-sm font-medium text-[var(--color-error)] mb-2">危険な操作</h2>
            <p className="text-[var(--color-text-muted)] text-sm mb-4">
              エピソードを削除すると、音声ファイルと文字起こしも削除されます。この操作は取り消せません。
            </p>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full py-2 bg-[var(--color-error-muted)] hover:bg-[var(--color-error)] text-[var(--color-error)] hover:text-white border border-[var(--color-error)] font-medium rounded-lg transition-all disabled:opacity-50"
            >
              {isDeleting ? "削除中..." : "エピソードを削除"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
