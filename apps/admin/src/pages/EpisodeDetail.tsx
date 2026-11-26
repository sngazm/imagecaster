import { useState, useEffect, type ReactNode } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, EpisodeDetail as EpisodeDetailType, formatDuration, formatFileSize, uploadToR2, getAudioDuration, utcToLocalDateTimeString, localDateTimeToISOString, fetchTranscriptSegments } from "../lib/api";
import { SpeakerTracksPanel } from "../components/SpeakerTracksPanel";
import { TranscriptViewer } from "../components/TranscriptViewer";
import { ClaudeImpressionPanel } from "../components/ClaudeImpressionPanel";
import { GlossaryPanel } from "../components/GlossaryPanel";
import { ClipsPanel } from "../components/ClipsPanel";
import type { DescriptionTemplate, ReferenceLink, TranscriptSegment, PublishStatus, TranscribeStatus, UploadProgress, SpeakerTrackAssignment } from "../lib/api";
import { UploadProgressBar } from "../components/UploadProgressBar";
import { HtmlEditor, type PreviewContext } from "../components/HtmlEditor";
import { DateTimePicker } from "../components/DateTimePicker";
import { BlueskyPostEditor } from "../components/BlueskyPostEditor";
import { ReferenceLinksEditor } from "../components/ReferenceLinksEditor";
import { ReferenceLinkProposals } from "../components/ReferenceLinkProposals";
import { getWebsiteUrl, getEnvironment } from "../lib/env";

/** タイトルの入力欄を、中身の行数に合わせた高さにする */
function fitTitleHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

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

function highlightPlaceholders(html: string): string {
  return html.replace(
    /\{\{([A-Z_]+)\}\}/g,
    '<span class="placeholder-tag">{{$1}}</span>'
  );
}

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

/** 「この回について」の表の 1 行。編集中の入力欄は、見出しの下に幅いっぱいで置く */
function InfoRow({ label, stacked = false, children }: { label: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={stacked ? "py-3" : "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 py-2.5"}>
      <dt className={`text-[var(--color-text-muted)] ${stacked ? "mb-1.5" : ""}`}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** 配信先のページへのリンク。まだ無ければ「未設定」 */
function ExternalLinkValue({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-[var(--color-text-muted)]">未設定</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--color-accent)] hover:underline">
      開く ↗
    </a>
  );
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
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // 音声プレイヤーの要素。文字起こしの行をクリックしたところから再生するために貸す
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Audio upload
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  // 話者トラックの既定割り当て（番組設定から）
  const [speakerDefaults, setSpeakerDefaults] = useState<SpeakerTrackAssignment[]>([]);
  const [audioSource, setAudioSource] = useState<"file" | "url">("file");
  const [audioUploadUrl, setAudioUploadUrl] = useState("");

  // Audio replace
  const [isReplacingAudio, setIsReplacingAudio] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceSource, setReplaceSource] = useState<"file" | "url">("file");
  const [replaceUploadUrl, setReplaceUploadUrl] = useState("");

  // Episode artwork upload
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [uploadingArtwork, setUploadingArtwork] = useState(false);

  // Website URL
  const [baseWebsiteUrl, setBaseWebsiteUrl] = useState<string>("");

  // Transcript
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isRetryingTranscription, setIsRetryingTranscription] = useState(false);

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
        setTemplates(templatesData);

        // Fetch transcript segments if available
        if (data.transcriptUrl) {
          fetchTranscriptSegments(data.transcriptUrl).then(setTranscriptSegments);
        }

        // 番組設定の取得（公開サイトURL・話者トラックの既定割り当て）
        try {
          const settingsData = await api.getSettings();
          if (env === "local") {
            // ローカル環境ではダミー値を設定（getWebsiteUrlがローカルURLに変換する）
            setBaseWebsiteUrl("local");
          } else if (settingsData.websiteUrl) {
            setBaseWebsiteUrl(settingsData.websiteUrl);
          }
          setSpeakerDefaults(settingsData.transcriptRefine?.speakerDefaults ?? []);
        } catch (err) {
          console.error("設定の取得に失敗しました:", err);
          if (env === "local") {
            setBaseWebsiteUrl("local");
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

  const reloadEpisode = async () => {
    if (!id) return;
    try {
      setEpisode(await api.getEpisode(id));
    } catch (err) {
      console.error("エピソードの再読み込みに失敗しました:", err);
    }
  };

  const handleRetryTranscription = async () => {
    if (!id || !episode) return;

    try {
      setIsRetryingTranscription(true);
      setError(null);
      await api.retryTranscription(id);
      // リロードして最新の状態を取得
      const data = await api.getEpisode(id);
      setEpisode(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文字起こしリトライに失敗しました");
    } finally {
      setIsRetryingTranscription(false);
    }
  };

  const handleAudioUpload = async (fileArg?: File) => {
    const targetFile = fileArg ?? audioFile;
    if (!id || !targetFile || !episode) return;

    try {
      setIsUploading(true);
      setUploadMessage("アップロード用URLを取得中...");

      const { uploadUrl } = await api.getUploadUrl(
        id,
        targetFile.type || "audio/mpeg",
        targetFile.size
      );

      setUploadMessage("音声をアップロード中...");
      setUploadProgress({ loaded: 0, total: targetFile.size, percent: 0 });
      await uploadToR2(uploadUrl, targetFile, setUploadProgress);
      setUploadProgress(null);

      setUploadMessage("処理を完了中...");
      const duration = await getAudioDuration(targetFile);
      await api.completeUpload(id, duration, targetFile.size);

      // リロード
      const updated = await api.getEpisode(id);
      setEpisode(updated);
      setAudioFile(null);
      setUploadMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleAudioUploadFromUrl = async () => {
    if (!id || !audioUploadUrl.trim() || !episode) return;

    try {
      setIsUploading(true);
      setUploadMessage("URLから音声を取得中...");

      await api.uploadFromUrl(id, audioUploadUrl.trim());

      // リロード
      const updated = await api.getEpisode(id);
      setEpisode(updated);
      setAudioUploadUrl("");
      setUploadMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "URLからの取得に失敗しました");
    } finally {
      setIsUploading(false);
    }
  };

  const handleReplaceAudio = async () => {
    if (!id || !replaceFile || !episode) return;
    if (!confirm("音声ファイルを差し替えますか？既存の文字起こしは削除され、必要に応じて再実行されます。")) return;

    try {
      setIsUploading(true);
      setUploadMessage("アップロード用URLを取得中...");

      const { uploadUrl } = await api.getReplaceUrl(
        id,
        replaceFile.type || "audio/mpeg",
        replaceFile.size
      );

      setUploadMessage("音声をアップロード中...");
      setUploadProgress({ loaded: 0, total: replaceFile.size, percent: 0 });
      await uploadToR2(uploadUrl, replaceFile, setUploadProgress);
      setUploadProgress(null);

      setUploadMessage("処理を完了中...");
      const duration = await getAudioDuration(replaceFile);
      await api.completeReplace(id, duration, replaceFile.size);

      const updated = await api.getEpisode(id);
      setEpisode(updated);
      setReplaceFile(null);
      setReplaceUploadUrl("");
      setIsReplacingAudio(false);
      setUploadMessage("");
      setTranscriptSegments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "差し替えに失敗しました");
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleReplaceAudioFromUrl = async () => {
    if (!id || !replaceUploadUrl.trim() || !episode) return;
    if (!confirm("音声ファイルを差し替えますか？既存の文字起こしは削除され、必要に応じて再実行されます。")) return;

    try {
      setIsUploading(true);
      setUploadMessage("URLから音声を取得中...");

      await api.replaceFromUrl(id, replaceUploadUrl.trim());

      const updated = await api.getEpisode(id);
      setEpisode(updated);
      setReplaceUploadUrl("");
      setReplaceFile(null);
      setIsReplacingAudio(false);
      setUploadMessage("");
      setTranscriptSegments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "URLからの差し替えに失敗しました");
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
    <div className="max-w-6xl mx-auto px-5 md:px-6 py-4 md:py-8 pb-24 md:pb-8">
      <header className="mb-6 md:mb-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          戻る
        </Link>
        {/* スマホではタイトルの下にボタンと状態を回す。横に並べるとタイトルが半分の幅に押し込まれる */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            {isEditing ? (
              // 長いタイトルが 1 行で切れないよう、折り返して全部見せる。改行は入れさせない
              <textarea
                ref={fitTitleHeight}
                rows={1}
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value.replace(/[\r\n]+/g, " "));
                  fitTitleHeight(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                aria-label="タイトル"
                className="block w-full resize-none overflow-hidden text-lg sm:text-[26px] font-bold leading-normal bg-transparent border-b-2 border-[var(--color-ink)] focus:outline-none text-[var(--color-text-primary)]"
              />
            ) : (
              <h1 className="text-lg sm:text-[26px] font-bold leading-normal break-words text-[var(--color-text-primary)]">{episode.title}</h1>
            )}
            {isEditing && canEditSlug && (
              <div className="mt-2">
                <label className="text-xs text-[var(--color-text-muted)]">Slug:</label>
                <input
                  type="text"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="ml-2 max-w-full text-sm font-mono text-[var(--color-text-secondary)] bg-transparent border-b border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            )}
            {!isEditing && (
              <p className="text-xs text-[var(--color-text-muted)] font-mono mt-1 break-all">{episode.slug || episode.id}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {/* Webページを開く */}
            {canShowWebLink && episodeWebUrl && (
              <a
                href={episodeWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-md transition-colors whitespace-nowrap"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Webで見る
              </a>
            )}
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
              <audio ref={setAudioElement} src={audioUrl} controls className="w-full" />
              {episode.sourceAudioUrl && !episode.audioUrl && (
                <p className="text-xs text-[var(--color-text-muted)] mt-2">外部音声ファイルを参照しています</p>
              )}
              {isEditing && episode.publishStatus !== "uploading" && episode.publishStatus !== "new" && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                  {!isReplacingAudio ? (
                    <button
                      type="button"
                      onClick={() => setIsReplacingAudio(true)}
                      className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] inline-flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      音声ファイルを差し替える
                    </button>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">音声ファイルを差し替え</h3>
                        <button
                          type="button"
                          onClick={() => {
                            setIsReplacingAudio(false);
                            setReplaceFile(null);
                            setReplaceUploadUrl("");
                          }}
                          disabled={isUploading}
                          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          キャンセル
                        </button>
                      </div>
                      <div className="p-3 bg-[var(--color-warning-muted,var(--color-bg-elevated))] border border-[var(--color-border)] rounded-lg mb-3">
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          差し替え後、既存の文字起こしは削除されます。
                          {episode.skipTranscription
                            ? "（文字起こしはスキップ設定のため再実行されません）"
                            : "新しい音声に対して文字起こしが再実行されます。"}
                        </p>
                      </div>

                      {/* ソース選択 */}
                      <div className="flex gap-4 mb-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="replaceAudioSource"
                            value="file"
                            checked={replaceSource === "file"}
                            onChange={() => setReplaceSource("file")}
                            disabled={isUploading}
                            className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-base)] border-[var(--color-border)] focus:ring-[var(--color-accent)]"
                          />
                          <span className="text-sm text-[var(--color-text-primary)]">ファイルをアップロード</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="replaceAudioSource"
                            value="url"
                            checked={replaceSource === "url"}
                            onChange={() => setReplaceSource("url")}
                            disabled={isUploading}
                            className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-base)] border-[var(--color-border)] focus:ring-[var(--color-accent)]"
                          />
                          <span className="text-sm text-[var(--color-text-primary)]">URLから取得</span>
                        </label>
                      </div>

                      {replaceSource === "file" ? (
                        <>
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                            disabled={isUploading}
                            className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-secondary)] hover:file:bg-[var(--color-bg-hover)] disabled:opacity-50"
                          />
                          {replaceFile && (
                            <div className="mt-3">
                              <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                                {replaceFile.name} ({(replaceFile.size / 1024 / 1024).toFixed(1)} MB)
                              </p>
                              <button
                                type="button"
                                onClick={handleReplaceAudio}
                                disabled={isUploading}
                                className="btn btn-primary"
                              >
                                {isUploading ? uploadMessage : "差し替えを実行"}
                              </button>
                              {isUploading && uploadProgress && (
                                <div className="mt-3">
                                  <UploadProgressBar progress={uploadProgress} />
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div>
                          <input
                            type="url"
                            value={replaceUploadUrl}
                            onChange={(e) => setReplaceUploadUrl(e.target.value)}
                            placeholder="https://example.com/audio.mp3"
                            disabled={isUploading}
                            className="input"
                          />
                          <p className="text-xs text-[var(--color-text-faint)] mt-1">NextCloud共有リンクも使用可能です</p>
                          {replaceUploadUrl.trim() && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={handleReplaceAudioFromUrl}
                                disabled={isUploading}
                                className="btn btn-primary"
                              >
                                {isUploading ? uploadMessage : "差し替えを実行"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : isEditing ? (
            <div className="card p-6">
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                音声ファイル
              </h2>
              <p className="text-[var(--color-text-muted)] text-sm mb-4">音声ファイルがまだアップロードされていません。</p>

              {/* ソース選択 */}
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="audioSource"
                    value="file"
                    checked={audioSource === "file"}
                    onChange={() => setAudioSource("file")}
                    disabled={isUploading}
                    className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-base)] border-[var(--color-border)] focus:ring-[var(--color-accent)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">ファイルをアップロード</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="audioSource"
                    value="url"
                    checked={audioSource === "url"}
                    onChange={() => setAudioSource("url")}
                    disabled={isUploading}
                    className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-base)] border-[var(--color-border)] focus:ring-[var(--color-accent)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">URLから取得</span>
                </label>
              </div>

              {/* ファイル入力 */}
              {audioSource === "file" && (
                <>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      const selected = e.target.files?.[0] || null;
                      setAudioFile(selected);
                      // ファイル選択時に自動でアップロードを開始
                      if (selected) handleAudioUpload(selected);
                    }}
                    disabled={isUploading}
                    className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--color-bg-elevated)] file:text-[var(--color-text-secondary)] hover:file:bg-[var(--color-bg-hover)] disabled:opacity-50"
                  />
                  <p className="text-xs text-[var(--color-text-faint)] mt-2">ファイルを選択すると自動でアップロードを開始します</p>
                  {audioFile && (
                    <div className="mt-3">
                      <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                        {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
                      </p>
                      <button
                        onClick={() => handleAudioUpload()}
                        disabled={isUploading}
                        className="btn btn-primary"
                      >
                        {isUploading ? uploadMessage : "再アップロード"}
                      </button>
                      {isUploading && uploadProgress && (
                        <div className="mt-3">
                          <UploadProgressBar progress={uploadProgress} />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* URL入力 */}
              {audioSource === "url" && (
                <div>
                  <input
                    type="url"
                    value={audioUploadUrl}
                    onChange={(e) => setAudioUploadUrl(e.target.value)}
                    placeholder="https://example.com/audio.mp3"
                    disabled={isUploading}
                    className="input"
                  />
                  <p className="text-xs text-[var(--color-text-faint)] mt-1">NextCloud共有リンクも使用可能です</p>
                  {audioUploadUrl.trim() && (
                    <div className="mt-3">
                      <button
                        onClick={handleAudioUploadFromUrl}
                        disabled={isUploading}
                        className="btn btn-primary"
                      >
                        {isUploading ? uploadMessage : "取得"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

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
                previewContext={{
                  slug: editSlug || episode?.slug || episode?.id,
                  id: episode?.id,
                  audioUrl: episode?.audioUrl,
                  sourceAudioUrl: episode?.sourceAudioUrl,
                  transcriptUrl: episode?.transcriptUrl,
                  referenceLinks: editReferenceLinks,
                  websiteUrl: baseWebsiteUrl ? getWebsiteUrl(baseWebsiteUrl) : "",
                } satisfies PreviewContext}
              />
            ) : (
              <div
                className="bg-[var(--color-bg-elevated)] rounded-lg p-4 text-[var(--color-text-secondary)] text-sm prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: highlightPlaceholders(episode.description || "<p>説明がありません</p>") }}
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

            {/* 通読が見つけた候補。足すか見送るかは人が決める */}
            <ReferenceLinkProposals
              episodeId={episode.id}
              links={isEditing ? editReferenceLinks : episode.referenceLinks || []}
              dismissed={episode.dismissedLinkProposals || []}
              onAdd={async (link) => {
                if (isEditing) {
                  // 編集中は下書きに足す。保存ボタンで一緒に保存される
                  setEditReferenceLinks([...editReferenceLinks, link]);
                  return;
                }
                const updated = await api.updateEpisode(episode.id, {
                  referenceLinks: [...(episode.referenceLinks || []), link],
                });
                setEpisode(updated);
              }}
              onDismiss={async (url) => {
                const updated = await api.updateEpisode(episode.id, {
                  dismissedLinkProposals: [...(episode.dismissedLinkProposals || []), url],
                });
                setEpisode(updated);
              }}
            />
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
                {/* 文字起こし失敗時のエラー表示 + リトライ */}
                {episode.transcribeStatus === "failed" && (
                  <div className="space-y-3">
                    <div className="p-3 bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-lg">
                      <p className="text-sm font-medium text-[var(--color-error)]">文字起こしに失敗しました</p>
                      {episode.transcriptionErrorMessage && (
                        <p className="text-xs text-[var(--color-error)] mt-1 opacity-80">{episode.transcriptionErrorMessage}</p>
                      )}
                    </div>
                    <button
                      onClick={handleRetryTranscription}
                      disabled={isRetryingTranscription}
                      className="btn btn-primary text-sm"
                    >
                      {isRetryingTranscription ? "リトライ中..." : "文字起こしをリトライ"}
                    </button>
                  </div>
                )}
                {/* 現在の状態を表示 */}
                {episode.publishStatus !== "new" && episode.transcribeStatus !== "failed" && !episode.transcriptUrl && (
                  <p className="text-[var(--color-text-muted)] text-sm">
                    {episode.skipTranscription ? "文字起こしはスキップされました" : "文字起こしはまだありません"}
                  </p>
                )}
                {episode.transcriptUrl && transcriptSegments.length > 0 && (
                  <TranscriptViewer
                    segments={transcriptSegments}
                    sourceUrl={episode.transcriptUrl}
                    rawUrl={episode.transcriptRawUrl}
                    audio={audioElement}
                  />
                )}

                {/*
                  正解データを作る。話者分離を推測で直すのをやめ、人が示した
                  正解との差で測るために置いている。公開には影響しない
                */}
                {episode.transcriptRawUrl && (
                  <Link
                    to={`/episodes/${episode.id}/truth`}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                  >
                    正解データを作る（タイムライン編集）
                  </Link>
                )}

                {/* 話者トラック（音量で話者を判定するための素材） */}
                {!episode.skipTranscription && (
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
                      話者トラック
                    </h3>
                    <SpeakerTracksPanel
                      episode={episode}
                      defaults={speakerDefaults}
                      onUpdated={reloadEpisode}
                    />
                  </div>
                )}

                {/* この回の用語集（校正が集めたもの） */}
                {!episode.skipTranscription && (
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
                      この回の用語集
                    </h3>
                    <GlossaryPanel episodeId={episode.id} />
                  </div>
                )}

                {/* Claude の感想（公開サイトに載る） */}
                <div className="border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
                    Claude の感想
                  </h3>
                  <ClaudeImpressionPanel
                    episode={episode}
                    onUpdated={reloadEpisode}
                  />
                </div>

                <div className="border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
                    切り抜き動画
                  </h3>
                  <ClipsPanel episodeId={episode.id} />
                </div>
              </div>
            ) : (
              <>
                {episode.transcribeStatus === "failed" ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-lg">
                      <p className="text-sm font-medium text-[var(--color-error)]">文字起こしに失敗しました</p>
                      {episode.transcriptionErrorMessage && (
                        <p className="text-xs text-[var(--color-error)] mt-1 opacity-80">{episode.transcriptionErrorMessage}</p>
                      )}
                    </div>
                    <button
                      onClick={handleRetryTranscription}
                      disabled={isRetryingTranscription}
                      className="btn btn-primary text-sm"
                    >
                      {isRetryingTranscription ? "リトライ中..." : "文字起こしをリトライ"}
                    </button>
                  </div>
                ) : episode.skipTranscription ? (
                  <p className="text-[var(--color-text-muted)] text-sm">文字起こしはスキップされました</p>
                ) : transcriptSegments.length > 0 ? (
                  <TranscriptViewer
                    segments={transcriptSegments}
                    sourceUrl={episode.transcriptUrl}
                    rawUrl={episode.transcriptRawUrl}
                    audio={audioElement}
                  />
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

        {/* 右カラム: この回について。箱を並べず、1 つの表にまとめる */}
        <div className="space-y-4">
          <section className="rounded-[14px] border-[1.5px] border-[var(--color-ink)] px-4 md:px-5 py-1">
            <h2 className="sr-only">この回について</h2>
            <dl className="text-[13px] divide-y divide-[var(--color-border)]">
              <InfoRow label="再生時間">
                <span className="tabular-nums">
                  {formatDuration(episode.duration)}・{formatFileSize(episode.fileSize)}
                </span>
              </InfoRow>

              {isEditing ? (
                <InfoRow label="公開日時" stacked>
                  <DateTimePicker
                    value={editPublishAt}
                    onChange={setEditPublishAt}
                    placeholder="公開日時を選択..."
                  />
                  <p className="text-xs text-[var(--color-text-faint)] mt-1">空欄にすると下書きになります</p>
                </InfoRow>
              ) : (
                <InfoRow label={episode.publishStatus === "scheduled" ? "公開予定日" : "公開日"}>
                  <span className="tabular-nums">
                    {episode.publishStatus === "scheduled"
                      ? formatDate(episode.publishAt)
                      : formatDate(episode.publishedAt)}
                  </span>
                </InfoRow>
              )}

              <InfoRow label="作成日">
                <span className="tabular-nums">{formatDate(episode.createdAt)}</span>
              </InfoRow>

              {episode.blueskyPostedAt ? (
                <InfoRow label="Bluesky">
                  <span className="tabular-nums">投稿済み {formatDate(episode.blueskyPostedAt)}</span>
                </InfoRow>
              ) : isEditing ? (
                <InfoRow label="Bluesky" stacked>
                  <label className="flex items-center gap-2.5 min-h-[36px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editBlueskyPostEnabled}
                      onChange={(e) => setEditBlueskyPostEnabled(e.target.checked)}
                      className="w-4 h-4 accent-[var(--color-ink)]"
                    />
                    <span className="text-[var(--color-text-primary)]">公開時に投稿する</span>
                  </label>
                  {editBlueskyPostEnabled && (
                    <div className="mt-2">
                      <BlueskyPostEditor
                        value={editBlueskyPostText}
                        onChange={setEditBlueskyPostText}
                      />
                    </div>
                  )}
                </InfoRow>
              ) : episode.blueskyPostEnabled ? (
                <InfoRow label="Bluesky">
                  公開時に投稿
                  {episode.blueskyPostText && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
                      {episode.blueskyPostText}
                    </p>
                  )}
                </InfoRow>
              ) : (
                <InfoRow label="Bluesky">
                  <span className="text-[var(--color-text-muted)]">投稿しない</span>
                </InfoRow>
              )}

              {isEditing ? (
                <InfoRow label="Apple Podcasts の URL" stacked>
                  <input
                    type="url"
                    value={editApplePodcastsUrl}
                    onChange={(e) => setEditApplePodcastsUrl(e.target.value)}
                    placeholder="https://podcasts.apple.com/..."
                    className="input"
                  />
                </InfoRow>
              ) : (
                <InfoRow label="Apple">
                  <ExternalLinkValue url={episode.applePodcastsUrl} />
                </InfoRow>
              )}

              {isEditing ? (
                <InfoRow label="Spotify の URL" stacked>
                  <input
                    type="url"
                    value={editSpotifyUrl}
                    onChange={(e) => setEditSpotifyUrl(e.target.value)}
                    placeholder="https://open.spotify.com/episode/..."
                    className="input"
                  />
                  <p className="text-xs text-[var(--color-text-faint)] mt-1">
                    Apple と Spotify の URL は、空欄なら管理画面を開いたときに自動で取得します
                  </p>
                </InfoRow>
              ) : (
                <InfoRow label="Spotify">
                  <ExternalLinkValue url={episode.spotifyUrl} />
                </InfoRow>
              )}
            </dl>
          </section>

          {/* 編集・保存ボタン。スマホでは画面の下（タブの上）に固定して、長い画面でも押せるようにする */}
          <div className="action-bar fixed md:static inset-x-0 bottom-[calc(var(--bottom-tabs-height)+env(safe-area-inset-bottom))] z-30 flex md:flex-col gap-2 md:gap-3 px-4 py-2.5 md:p-0 bg-[var(--color-bg-base)] border-t-[1.5px] md:border-t-0 border-[var(--color-ink)]">
            {isEditing ? (
              ["draft", "scheduled", "published"].includes(episode.publishStatus) ? (
                <>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={isSaving}
                    className="btn btn-primary flex-1 md:w-full py-2.5 md:py-3"
                  >
                    {isSaving ? "保存中..." : (!editPublishAt || new Date(editPublishAt) <= new Date() ? "今すぐ公開" : "公開予約")}
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={isSaving}
                    className="btn btn-secondary flex-1 md:w-full py-2.5 md:py-3"
                  >
                    {isSaving ? "保存中..." : "下書き保存"}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="btn btn-secondary flex-1 md:w-full py-2.5 md:py-3"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleSave()}
                    disabled={isSaving}
                    className="btn btn-primary flex-1 md:w-full py-2.5 md:py-3"
                  >
                    {isSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="btn btn-secondary flex-1 md:w-full py-2.5 md:py-3"
                  >
                    キャンセル
                  </button>
                </>
              )
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="btn btn-primary flex-1 md:w-full py-2.5 md:py-3"
              >
                編集
              </button>
            )}
          </div>

          {/* 削除。赤い箱で目立たせない。押すと確認が出る（音声と文字起こしも消える） */}
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="self-start min-h-[44px] text-[13px] text-[var(--color-error)] hover:underline disabled:opacity-50"
          >
            {isDeleting ? "削除中..." : "このエピソードを削除…"}
          </button>
        </div>
      </div>
    </div>
  );
}
