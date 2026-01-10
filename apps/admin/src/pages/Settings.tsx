import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { api, uploadToR2 } from "../lib/api";
import type { PodcastSettings, DescriptionTemplate, ExportManifest } from "../lib/api";
import { HtmlEditor } from "../components/HtmlEditor";
import { fetchApplePodcastsEpisodes, searchApplePodcastsEpisodeByTitle } from "../lib/itunes";

const CATEGORIES = [
  "Arts",
  "Business",
  "Comedy",
  "Education",
  "Fiction",
  "Government",
  "Health & Fitness",
  "History",
  "Kids & Family",
  "Leisure",
  "Music",
  "News",
  "Religion & Spirituality",
  "Science",
  "Society & Culture",
  "Sports",
  "Technology",
  "True Crime",
  "TV & Film",
];

const LANGUAGES = [
  { code: "ja", label: "日本語" },
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ko", label: "한국어" },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<"general" | "templates" | "import" | "backup" | "danger">("general");
  const [settings, setSettings] = useState<PodcastSettings | null>(null);
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Artwork upload
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [uploadingArtwork, setUploadingArtwork] = useState(false);

  // OGP image upload
  const [ogImageFile, setOgImageFile] = useState<File | null>(null);
  const [ogImagePreview, setOgImagePreview] = useState<string | null>(null);
  const [uploadingOgImage, setUploadingOgImage] = useState(false);

  // Template editing
  const [editingTemplate, setEditingTemplate] = useState<DescriptionTemplate | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");

  // RSS Import
  const [rssUrl, setRssUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importAudio, setImportAudio] = useState(false);
  const [importPodcastSettings, setImportPodcastSettings] = useState(false);
  const [importPreview, setImportPreview] = useState<Awaited<
    ReturnType<typeof api.previewRssImport>
  > | null>(null);
  const [importResult, setImportResult] = useState<Awaited<
    ReturnType<typeof api.importRss>
  > | null>(null);
  const [customSlugs, setCustomSlugs] = useState<Record<string, string>>({});

  // Danger zone
  const [resetting, setResetting] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  // Apple Podcasts URL fetch
  const [fetchingApplePodcasts, setFetchingApplePodcasts] = useState(false);
  const [applePodcastsProgress, setApplePodcastsProgress] = useState<{ current: number; total: number; found: number } | null>(null);

  // Spotify URL fetch
  const [fetchingSpotify, setFetchingSpotify] = useState(false);
  const [spotifyProgress, setSpotifyProgress] = useState<{ total: number; matched: number } | null>(null);

  // Backup
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importingBackup, setImportingBackup] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [settingsData, templatesData] = await Promise.all([
        api.getSettings(),
        api.getTemplates(),
      ]);
      setSettings(settingsData);
      setTemplates(templatesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.updateSettings(settings);
      setSuccess("設定を保存しました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleArtworkUpload() {
    if (!artworkFile) return;

    setUploadingArtwork(true);
    setError(null);

    try {
      const { uploadUrl, artworkUrl } = await api.getArtworkUploadUrl(
        artworkFile.type,
        artworkFile.size
      );

      await uploadToR2(uploadUrl, artworkFile);
      await api.completeArtworkUpload(artworkUrl);

      setSettings((prev) => (prev ? { ...prev, artworkUrl } : null));
      setArtworkFile(null);
      setArtworkPreview(null);
      setSuccess("アートワークをアップロードしました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload artwork");
    } finally {
      setUploadingArtwork(false);
    }
  }

  function handleArtworkSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setArtworkFile(file);
      setArtworkPreview(URL.createObjectURL(file));
    }
  }

  async function handleOgImageUpload() {
    if (!ogImageFile) return;

    setUploadingOgImage(true);
    setError(null);

    try {
      const { uploadUrl, ogImageUrl } = await api.getOgImageUploadUrl(
        ogImageFile.type,
        ogImageFile.size
      );

      await uploadToR2(uploadUrl, ogImageFile);
      await api.completeOgImageUpload(ogImageUrl);

      setSettings((prev) => (prev ? { ...prev, ogImageUrl } : null));
      setOgImageFile(null);
      setOgImagePreview(null);
      setSuccess("OGP画像をアップロードしました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload OGP image");
    } finally {
      setUploadingOgImage(false);
    }
  }

  function handleOgImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setOgImageFile(file);
      setOgImagePreview(URL.createObjectURL(file));
    }
  }

  async function handleCreateTemplate() {
    if (!newTemplateName.trim()) return;

    try {
      const template = await api.createTemplate({
        name: newTemplateName,
        content: newTemplateContent,
      });
      setTemplates((prev) => [...prev, template]);
      setNewTemplateName("");
      setNewTemplateContent("");
      setSuccess("テンプレートを作成しました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template");
    }
  }

  async function handleUpdateTemplate() {
    if (!editingTemplate) return;

    try {
      const updated = await api.updateTemplate(editingTemplate.id, {
        name: editingTemplate.name,
        content: editingTemplate.content,
      });
      setTemplates((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
      setEditingTemplate(null);
      setSuccess("テンプレートを更新しました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update template");
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm("このテンプレートを削除しますか？")) return;

    try {
      await api.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setSuccess("テンプレートを削除しました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    }
  }

  async function handleSetDefaultTemplate(id: string) {
    try {
      const updated = await api.updateTemplate(id, { isDefault: true });
      // 他のテンプレートのisDefaultをfalseに更新
      setTemplates((prev) =>
        prev.map((t) => ({
          ...t,
          isDefault: t.id === updated.id,
        }))
      );
      setSuccess("デフォルトテンプレートを設定しました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default template");
    }
  }

  async function handlePreviewRss() {
    if (!rssUrl.trim()) return;

    setImporting(true);
    setError(null);
    setImportPreview(null);
    setImportResult(null);
    setCustomSlugs({});

    try {
      const preview = await api.previewRssImport(rssUrl);
      setImportPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch RSS");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportRss() {
    if (!rssUrl.trim()) return;

    // 重複があるエピソードをスキップ確認
    const conflictCount = importPreview?.episodes.filter((ep) => ep.hasConflict).length ?? 0;
    if (conflictCount > 0) {
      const confirmed = window.confirm(
        `${conflictCount}件のエピソードでslugが既存と重複しています。\n重複したエピソードはサフィックス付きのslugでインポートされます。\n\n続行しますか？`
      );
      if (!confirmed) return;
    }

    setImporting(true);
    setError(null);

    try {
      const result = await api.importRss(rssUrl, importAudio, importPodcastSettings, Object.keys(customSlugs).length > 0 ? customSlugs : undefined);
      setImportResult(result);
      setImportPreview(null);
      setCustomSlugs({});
      let successMsg = `${result.imported}件のエピソードをインポートしました`;
      if (importPodcastSettings) {
        successMsg += "（Podcast設定も更新）";
      }
      setSuccess(successMsg);
      setTimeout(() => setSuccess(null), 5000);
      // 設定を再読み込み
      if (importPodcastSettings) {
        loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import RSS");
    } finally {
      setImporting(false);
    }
  }

  async function handleFetchApplePodcastsUrls() {
    if (!settings?.applePodcastsId) {
      setError("Apple Podcasts ID が設定されていません");
      return;
    }

    setFetchingApplePodcasts(true);
    setError(null);
    setApplePodcastsProgress(null);

    try {
      // iTunes Lookup API からエピソード情報を取得（最大200件、5秒間隔）
      const guidToUrl = await fetchApplePodcastsEpisodes(settings.applePodcastsId);

      // 全エピソードを取得
      const episodesResponse = await api.getEpisodes();
      const episodes = episodesResponse.episodes;

      setApplePodcastsProgress({ current: 0, total: episodes.length, found: 0 });

      let foundCount = 0;
      let updatedCount = 0;
      let searchFallbackCount = 0;

      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];

        // 既にApple Podcasts URLがある場合はスキップ
        if (ep.applePodcastsUrl) {
          foundCount++;
          setApplePodcastsProgress({ current: i + 1, total: episodes.length, found: foundCount });
          continue;
        }

        // エピソードの詳細を取得してsourceGuidを確認
        const detail = await api.getEpisode(ep.id);
        const guid = detail.sourceGuid || detail.slug;
        let applePodcastsUrl = guidToUrl.get(guid);

        // GUIDでマッチしなかった場合、タイトル検索でフォールバック（5秒間隔）
        if (!applePodcastsUrl) {
          applePodcastsUrl = await searchApplePodcastsEpisodeByTitle(
            detail.title,
            guid,
            settings.applePodcastsId
          ) ?? undefined;
          if (applePodcastsUrl) {
            searchFallbackCount++;
          }
        }

        if (applePodcastsUrl) {
          await api.updateEpisode(ep.id, { applePodcastsUrl });
          foundCount++;
          updatedCount++;
        }

        setApplePodcastsProgress({ current: i + 1, total: episodes.length, found: foundCount });
      }

      const fallbackNote = searchFallbackCount > 0 ? `（うち${searchFallbackCount}件はタイトル検索で取得）` : '';
      setSuccess(`${updatedCount}件のエピソードにApple Podcasts URLを設定しました${fallbackNote}（マッチ: ${foundCount}/${episodes.length}）`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Apple Podcasts URLs");
    } finally {
      setFetchingApplePodcasts(false);
      setApplePodcastsProgress(null);
    }
  }

  async function handleFetchSpotifyUrls() {
    if (!settings?.spotifyShowId) {
      setError("Spotify Show ID が設定されていません");
      return;
    }

    setFetchingSpotify(true);
    setError(null);
    setSpotifyProgress(null);

    try {
      const result = await api.fetchSpotifyEpisodes();

      setSpotifyProgress({ total: result.total, matched: result.matched });

      const unmatchedCount = result.total - result.matched;
      if (unmatchedCount > 0) {
        setSuccess(`${result.matched}件のエピソードにSpotify URLを設定しました（${unmatchedCount}件はマッチしませんでした）`);
      } else {
        setSuccess(`${result.matched}件のエピソードにSpotify URLを設定しました`);
      }
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Spotify URLs");
    } finally {
      setFetchingSpotify(false);
    }
  }

  async function handleResetAllData() {
    if (resetConfirmText !== "削除する") return;

    setResetting(true);
    setError(null);

    try {
      const result = await api.resetAllData();
      setSuccess(`${result.deletedCount}件のファイルを削除しました`);
      setResetConfirmText("");
      // 設定をリロード
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset data");
    } finally {
      setResetting(false);
    }
  }

  async function handleExportBackup() {
    setExporting(true);
    setExportProgress(null);
    setError(null);

    try {
      // マニフェストを取得
      const manifest = await api.getExportManifest();

      const zip = new JSZip();

      // manifest.jsonを追加
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // ファイル数をカウント
      let totalFiles = 0;
      manifest.episodes.forEach((ep) => {
        if (ep.files.audio) totalFiles++;
        if (ep.files.transcript) totalFiles++;
        if (ep.files.ogImage) totalFiles++;
      });
      if (manifest.assets.artwork) totalFiles++;
      if (manifest.assets.ogImage) totalFiles++;

      let downloadedFiles = 0;
      setExportProgress({ current: 0, total: totalFiles });

      // エピソードファイルをダウンロードしてzipに追加
      for (const ep of manifest.episodes) {
        if (ep.files.audio) {
          const response = await fetch(ep.files.audio.url);
          const blob = await response.blob();
          zip.file(ep.files.audio.key, blob);
          downloadedFiles++;
          setExportProgress({ current: downloadedFiles, total: totalFiles });
        }
        if (ep.files.transcript) {
          const response = await fetch(ep.files.transcript.url);
          const blob = await response.blob();
          zip.file(ep.files.transcript.key, blob);
          downloadedFiles++;
          setExportProgress({ current: downloadedFiles, total: totalFiles });
        }
        if (ep.files.ogImage) {
          const response = await fetch(ep.files.ogImage.url);
          const blob = await response.blob();
          zip.file(ep.files.ogImage.key, blob);
          downloadedFiles++;
          setExportProgress({ current: downloadedFiles, total: totalFiles });
        }
      }

      // アセットをダウンロードしてzipに追加
      if (manifest.assets.artwork) {
        const response = await fetch(manifest.assets.artwork.url);
        const blob = await response.blob();
        zip.file(manifest.assets.artwork.key, blob);
        downloadedFiles++;
        setExportProgress({ current: downloadedFiles, total: totalFiles });
      }
      if (manifest.assets.ogImage) {
        const response = await fetch(manifest.assets.ogImage.url);
        const blob = await response.blob();
        zip.file(manifest.assets.ogImage.key, blob);
        downloadedFiles++;
        setExportProgress({ current: downloadedFiles, total: totalFiles });
      }

      // zipファイルを生成してダウンロード
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `podcast-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess("バックアップをエクスポートしました");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export backup");
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  async function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingBackup(true);
    setImportProgress({ current: 0, total: 0, phase: "zipファイルを読み込み中..." });
    setError(null);

    try {
      // zipを展開
      const zip = await JSZip.loadAsync(file);

      // manifest.jsonを読み込み
      const manifestFile = zip.file("manifest.json");
      if (!manifestFile) {
        throw new Error("manifest.jsonが見つかりません");
      }
      const manifestText = await manifestFile.async("text");
      const manifest: ExportManifest = JSON.parse(manifestText);

      setImportProgress({ current: 0, total: 0, phase: "インポートを準備中..." });

      // インポートリクエストを構築
      const importRequest = {
        podcast: manifest.podcast,
        templates: manifest.templates,
        episodes: manifest.episodes.map((ep) => ({
          meta: ep.meta,
          hasAudio: !!ep.files.audio,
          hasTranscript: !!ep.files.transcript,
          hasOgImage: !!ep.files.ogImage,
        })),
        hasArtwork: !!manifest.assets.artwork,
        hasOgImage: !!manifest.assets.ogImage,
      };

      // インポート開始 - アップロードURLを取得
      const importResult = await api.importBackup(importRequest);

      // ファイル数をカウント
      let totalFiles = 0;
      importResult.uploadUrls.episodes.forEach((ep) => {
        if (ep.audio) totalFiles++;
        if (ep.transcript) totalFiles++;
        if (ep.ogImage) totalFiles++;
      });
      if (importResult.uploadUrls.assets.artwork) totalFiles++;
      if (importResult.uploadUrls.assets.ogImage) totalFiles++;

      let uploadedFiles = 0;
      setImportProgress({ current: 0, total: totalFiles, phase: "ファイルをアップロード中..." });

      // エピソードファイルをアップロード
      for (const epUrl of importResult.uploadUrls.episodes) {
        const epData = manifest.episodes.find((e) => e.meta.id === epUrl.id);
        if (!epData) continue;

        if (epUrl.audio && epData.files.audio) {
          const fileData = zip.file(epData.files.audio.key);
          if (fileData) {
            const blob = await fileData.async("blob");
            await fetch(epUrl.audio, {
              method: "PUT",
              body: blob,
              headers: { "Content-Type": "audio/mpeg" },
            });
            uploadedFiles++;
            setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "ファイルをアップロード中..." });
          }
        }
        if (epUrl.transcript && epData.files.transcript) {
          const fileData = zip.file(epData.files.transcript.key);
          if (fileData) {
            const blob = await fileData.async("blob");
            await fetch(epUrl.transcript, {
              method: "PUT",
              body: blob,
              headers: { "Content-Type": "text/vtt" },
            });
            uploadedFiles++;
            setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "ファイルをアップロード中..." });
          }
        }
        if (epUrl.ogImage && epData.files.ogImage) {
          const fileData = zip.file(epData.files.ogImage.key);
          if (fileData) {
            const blob = await fileData.async("blob");
            await fetch(epUrl.ogImage, {
              method: "PUT",
              body: blob,
              headers: { "Content-Type": "image/jpeg" },
            });
            uploadedFiles++;
            setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "ファイルをアップロード中..." });
          }
        }
      }

      // アセットをアップロード
      if (importResult.uploadUrls.assets.artwork && manifest.assets.artwork) {
        const fileData = zip.file(manifest.assets.artwork.key);
        if (fileData) {
          const blob = await fileData.async("blob");
          await fetch(importResult.uploadUrls.assets.artwork, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/jpeg" },
          });
          uploadedFiles++;
          setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "ファイルをアップロード中..." });
        }
      }
      if (importResult.uploadUrls.assets.ogImage && manifest.assets.ogImage) {
        const fileData = zip.file(manifest.assets.ogImage.key);
        if (fileData) {
          const blob = await fileData.async("blob");
          await fetch(importResult.uploadUrls.assets.ogImage, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/jpeg" },
          });
          uploadedFiles++;
          setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "ファイルをアップロード中..." });
        }
      }

      setImportProgress({ current: uploadedFiles, total: totalFiles, phase: "インポートを完了中..." });

      // インポート完了処理
      await api.completeBackupImport({
        episodes: manifest.episodes.map((ep) => ({
          id: ep.meta.id,
          hasAudio: !!ep.files.audio,
          hasTranscript: !!ep.files.transcript,
          hasOgImage: !!ep.files.ogImage,
          status: ep.meta.status as "draft" | "scheduled" | "published",
        })),
        hasArtwork: !!manifest.assets.artwork,
        hasOgImage: !!manifest.assets.ogImage,
      });

      setSuccess(`${manifest.episodes.length}件のエピソードをインポートしました`);
      setTimeout(() => setSuccess(null), 5000);

      // データをリロード
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import backup");
    } finally {
      setImportingBackup(false);
      setImportProgress(null);
      // ファイル入力をリセット
      if (backupFileInputRef.current) {
        backupFileInputRef.current.value = "";
      }
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[var(--color-border-strong)] border-t-[var(--color-accent)] rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          設定
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Podcastの基本設定を管理
        </p>
      </header>

      {/* Alerts */}
      {error && (
        <div className="card mb-6 p-4 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}
      {success && (
        <div className="card mb-6 p-4 border-[var(--color-success)]! bg-[var(--color-success-muted)]">
          <p className="text-sm text-[var(--color-success)]">{success}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "general"
              ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          基本設定
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "templates"
              ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          テンプレート
        </button>
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "import"
              ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          RSSインポート
        </button>
        <button
          onClick={() => setActiveTab("backup")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "backup"
              ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          バックアップ
        </button>
        <button
          onClick={() => setActiveTab("danger")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "danger"
              ? "text-[var(--color-error)] border-b-2 border-[var(--color-error)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
          }`}
        >
          危険な操作
        </button>
      </div>

      {/* General Settings */}
      {activeTab === "general" && settings && (
        <form onSubmit={handleSaveSettings} className="space-y-4">
          {/* Artwork */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">アートワーク</h2>
            <div className="flex items-start gap-5">
              <div className="w-28 h-28 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-hidden shrink-0">
                {(artworkPreview || settings.artworkUrl) ? (
                  <img
                    src={artworkPreview || settings.artworkUrl}
                    alt="Podcast artwork"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-faint)]">
                    <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
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
                  id="artwork-upload"
                />
                <label
                  htmlFor="artwork-upload"
                  className="btn btn-secondary text-sm cursor-pointer"
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
                      className="btn btn-primary text-sm"
                    >
                      {uploadingArtwork ? "アップロード中..." : "アップロード"}
                    </button>
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  推奨: 3000x3000px、JPEGまたはPNG、最大5MB
                </p>
              </div>
            </div>
          </div>

          {/* OGP Image */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">OGP画像</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              SNSでシェアされた時に表示される画像です。
            </p>
            <div className="flex items-start gap-5">
              <div className="w-44 h-24 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-hidden shrink-0">
                {(ogImagePreview || settings.ogImageUrl) ? (
                  <img
                    src={ogImagePreview || settings.ogImageUrl}
                    alt="OGP image"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-faint)]">
                    <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
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
                  id="og-image-upload"
                />
                <label
                  htmlFor="og-image-upload"
                  className="btn btn-secondary text-sm cursor-pointer"
                >
                  画像を選択
                </label>
                {ogImageFile && (
                  <div className="mt-3">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                      {ogImageFile.name} ({(ogImageFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                    <button
                      type="button"
                      onClick={handleOgImageUpload}
                      disabled={uploadingOgImage}
                      className="btn btn-primary text-sm"
                    >
                      {uploadingOgImage ? "アップロード中..." : "アップロード"}
                    </button>
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  推奨: 1200x630px、JPEGまたはPNG、最大5MB
                </p>
              </div>
            </div>
          </div>

          {/* Basic Info */}
          <div className="card p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">基本情報</h2>

            <div>
              <label className="label">番組名</label>
              <input
                type="text"
                value={settings.title}
                onChange={(e) =>
                  setSettings({ ...settings, title: e.target.value })
                }
                className="input"
              />
            </div>

            <div>
              <label className="label">説明</label>
              <textarea
                value={settings.description}
                onChange={(e) =>
                  setSettings({ ...settings, description: e.target.value })
                }
                rows={4}
                className="input resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">著者</label>
                <input
                  type="text"
                  value={settings.author}
                  onChange={(e) =>
                    setSettings({ ...settings, author: e.target.value })
                  }
                  className="input"
                />
              </div>
              <div>
                <label className="label">メールアドレス</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) =>
                    setSettings({ ...settings, email: e.target.value })
                  }
                  className="input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">言語</label>
                <select
                  value={settings.language}
                  onChange={(e) =>
                    setSettings({ ...settings, language: e.target.value })
                  }
                  className="input"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">カテゴリ</label>
                <select
                  value={settings.category}
                  onChange={(e) =>
                    setSettings({ ...settings, category: e.target.value })
                  }
                  className="input"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">ウェブサイトURL</label>
              <input
                type="url"
                value={settings.websiteUrl}
                onChange={(e) =>
                  setSettings({ ...settings, websiteUrl: e.target.value })
                }
                className="input"
              />
            </div>

            <div className="border-t border-[var(--color-border)] pt-4 mt-4">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">購読リンク</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                ポッドキャストプラットフォームのURLを設定すると、公開サイトに購読ボタンが表示されます。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Apple Podcasts URL</label>
                  <input
                    type="url"
                    value={settings.applePodcastsUrl || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, applePodcastsUrl: e.target.value || undefined })
                    }
                    placeholder="https://podcasts.apple.com/..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Spotify URL</label>
                  <input
                    type="url"
                    value={settings.spotifyUrl || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, spotifyUrl: e.target.value || undefined })
                    }
                    placeholder="https://open.spotify.com/show/..."
                    className="input"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="explicit"
                checked={settings.explicit}
                onChange={(e) =>
                  setSettings({ ...settings, explicit: e.target.checked })
                }
                className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <label htmlFor="explicit" className="text-sm text-[var(--color-text-secondary)]">
                成人向けコンテンツを含む
              </label>
            </div>
          </div>

          {/* Apple Podcasts Integration */}
          <div className="card p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">Apple Podcasts 連携</h2>

            <div>
              <label className="label">Apple Podcasts ID</label>
              <input
                type="text"
                value={settings.applePodcastsId || ""}
                onChange={(e) =>
                  setSettings({ ...settings, applePodcastsId: e.target.value || null })
                }
                placeholder="1234567890"
                className="input"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Apple Podcasts のURLに含まれる ID を入力してください。<br />
                例: https://podcasts.apple.com/jp/podcast/id<strong>1234567890</strong>
              </p>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">エピソードURLの一括取得</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                iTunes API からエピソードごとの Apple Podcasts リンクを取得し、各エピソードに設定します。
              </p>

              {applePodcastsProgress && (
                <div className="mb-3">
                  <div className="flex justify-between text-sm text-[var(--color-text-secondary)] mb-1">
                    <span>処理中... (マッチ: {applePodcastsProgress.found}件)</span>
                    <span>{applePodcastsProgress.current} / {applePodcastsProgress.total}</span>
                  </div>
                  <div className="h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-300"
                      style={{ width: `${(applePodcastsProgress.current / applePodcastsProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleFetchApplePodcastsUrls}
                disabled={fetchingApplePodcasts || !settings.applePodcastsId}
                className="btn btn-secondary text-sm"
              >
                {fetchingApplePodcasts ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    取得中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Apple Podcasts URLを一括取得
                  </>
                )}
              </button>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.applePodcastsAutoFetch ?? false}
                  onChange={(e) =>
                    setSettings({ ...settings, applePodcastsAutoFetch: e.target.checked })
                  }
                  disabled={!settings.applePodcastsId}
                  className="mt-0.5 w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] focus:ring-offset-0 disabled:opacity-50"
                />
                <div>
                  <span className={`block text-sm font-medium ${settings.applePodcastsId ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                    管理画面起動時に自動取得
                  </span>
                  <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                    公開から1日以上経ったエピソードのApple Podcasts URLを自動取得します
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Spotify Integration */}
          <div className="card p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">Spotify 連携</h2>

            <div>
              <label className="label">Spotify Show ID</label>
              <input
                type="text"
                value={settings.spotifyShowId || ""}
                onChange={(e) =>
                  setSettings({ ...settings, spotifyShowId: e.target.value || null })
                }
                placeholder="1234abcd5678efgh"
                className="input"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Spotify のURLに含まれる Show ID を入力してください。<br />
                例: https://open.spotify.com/show/<strong>1234abcd5678efgh</strong>
              </p>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">エピソードURLの一括取得</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                Spotify API からエピソードごとの Spotify リンクを取得し、各エピソードに設定します。<br />
                タイトルでマッチングを行います。
              </p>

              {spotifyProgress && (
                <div className="mb-3 p-3 bg-[var(--color-bg-elevated)] rounded-lg">
                  <div className="text-sm text-[var(--color-text-secondary)]">
                    マッチ: {spotifyProgress.matched} / {spotifyProgress.total} 件
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleFetchSpotifyUrls}
                disabled={fetchingSpotify || !settings.spotifyShowId}
                className="btn btn-secondary text-sm"
              >
                {fetchingSpotify ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    取得中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Spotify URLを一括取得
                  </>
                )}
              </button>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.spotifyAutoFetch ?? false}
                  onChange={(e) =>
                    setSettings({ ...settings, spotifyAutoFetch: e.target.checked })
                  }
                  disabled={!settings.spotifyShowId}
                  className="mt-0.5 w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] focus:ring-offset-0 disabled:opacity-50"
                />
                <div>
                  <span className={`block text-sm font-medium ${settings.spotifyShowId ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                    管理画面起動時に自動取得
                  </span>
                  <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                    公開から1日以上経ったエピソードのSpotify URLを自動取得します
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </form>
      )}

      {/* Templates */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          {/* Template list */}
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="card p-4"
              >
                {editingTemplate?.id === template.id ? (
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          name: e.target.value,
                        })
                      }
                      className="input"
                      placeholder="テンプレート名"
                    />
                    <HtmlEditor
                      value={editingTemplate.content}
                      onChange={(html) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          content: html,
                        })
                      }
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleUpdateTemplate}
                        className="btn btn-primary text-sm"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingTemplate(null)}
                        className="btn btn-secondary text-sm"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{template.name}</h3>
                        {template.isDefault && (
                          <span className="badge badge-accent">デフォルト</span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">
                        {template.content.replace(/<[^>]*>/g, "").slice(0, 100)}...
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {!template.isDefault && (
                        <button
                          onClick={() => handleSetDefaultTemplate(template.id)}
                          className="btn btn-ghost p-2"
                          title="デフォルトに設定"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setEditingTemplate(template)}
                        className="btn btn-ghost p-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template.id)}
                        className="btn btn-ghost p-2 hover:text-[var(--color-error)]"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {templates.length === 0 && (
              <div className="text-center py-8 text-[var(--color-text-muted)]">
                テンプレートがありません
              </div>
            )}
          </div>

          {/* New template form */}
          <div className="card p-5">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">新規テンプレート</h3>
            <div className="space-y-4">
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="input"
                placeholder="テンプレート名"
              />
              <HtmlEditor
                value={newTemplateContent}
                onChange={setNewTemplateContent}
                placeholder="テンプレート内容を入力..."
              />
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplateName.trim()}
                className="btn btn-primary text-sm"
              >
                テンプレートを作成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RSS Import */}
      {activeTab === "import" && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">RSSフィードからインポート</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              既存のポッドキャストのRSSフィードURLを入力してエピソードをインポートします。
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="url"
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                className="input flex-1"
              />
              <button
                onClick={handlePreviewRss}
                disabled={importing || !rssUrl.trim()}
                className="btn btn-secondary text-sm"
              >
                {importing ? "読み込み中..." : "プレビュー"}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={importAudio}
                onChange={(e) => setImportAudio(e.target.checked)}
                className="w-4 h-4 rounded bg-[var(--color-bg-elevated)] border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <span>オーディオファイルをコピーする（R2にダウンロード保存）</span>
            </label>
            {!importAudio && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1 ml-6">
                チェックしない場合、音声は外部URLへの参照として保存されます
              </p>
            )}

            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] mt-3">
              <input
                type="checkbox"
                checked={importPodcastSettings}
                onChange={(e) => setImportPodcastSettings(e.target.checked)}
                className="w-4 h-4 rounded bg-[var(--color-bg-elevated)] border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <span>Podcast設定を上書きする</span>
            </label>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 ml-6">
              チェックすると、RSSフィードの番組情報で現在の設定を上書きします
            </p>
          </div>

          {/* Preview */}
          {importPreview && (
            <div className="card p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{importPreview.podcast.title}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">{importPreview.podcast.author}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-2">
                    <span className="badge badge-accent">
                      新規 {importPreview.newEpisodeCount}件
                    </span>
                    {importPreview.episodeCount - importPreview.newEpisodeCount > 0 && (
                      <span className="badge badge-default">
                        済 {importPreview.episodeCount - importPreview.newEpisodeCount}件
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    新規分: {(importPreview.totalFileSize / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              </div>

              <p className="text-sm text-[var(--color-text-muted)] mb-4 line-clamp-2">
                {importPreview.podcast.description}
              </p>

              {/* Podcast設定比較 */}
              {importPodcastSettings && (
                <div className="mb-4 p-4 bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-lg">
                  <h4 className="text-sm font-medium text-[var(--color-accent)] mb-3">Podcast設定の変更内容</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[var(--color-text-muted)] text-left">
                        <tr>
                          <th className="pb-2 pr-4 w-24">項目</th>
                          <th className="pb-2 pr-4">現在の設定</th>
                          <th className="pb-2">RSSフィードの値</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        <tr>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">番組名</td>
                          <td className="py-2 pr-4 text-[var(--color-text-muted)] truncate max-w-50">
                            {importPreview.existingPodcast.title || <span className="text-[var(--color-text-faint)]">未設定</span>}
                          </td>
                          <td className={`py-2 truncate max-w-50 ${
                            importPreview.podcast.title !== importPreview.existingPodcast.title
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-text-muted)]"
                          }`}>
                            {importPreview.podcast.title || <span className="text-[var(--color-text-faint)]">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">著者</td>
                          <td className="py-2 pr-4 text-[var(--color-text-muted)] truncate max-w-50">
                            {importPreview.existingPodcast.author || <span className="text-[var(--color-text-faint)]">未設定</span>}
                          </td>
                          <td className={`py-2 truncate max-w-50 ${
                            importPreview.podcast.author !== importPreview.existingPodcast.author
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-text-muted)]"
                          }`}>
                            {importPreview.podcast.author || <span className="text-[var(--color-text-faint)]">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">言語</td>
                          <td className="py-2 pr-4 text-[var(--color-text-muted)]">
                            {importPreview.existingPodcast.language || <span className="text-[var(--color-text-faint)]">未設定</span>}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.language !== importPreview.existingPodcast.language
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-text-muted)]"
                          }`}>
                            {importPreview.podcast.language || <span className="text-[var(--color-text-faint)]">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">カテゴリ</td>
                          <td className="py-2 pr-4 text-[var(--color-text-muted)]">
                            {importPreview.existingPodcast.category || <span className="text-[var(--color-text-faint)]">未設定</span>}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.category !== importPreview.existingPodcast.category
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-text-muted)]"
                          }`}>
                            {importPreview.podcast.category || <span className="text-[var(--color-text-faint)]">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">アートワーク</td>
                          <td className="py-2 pr-4 text-[var(--color-text-muted)]">
                            {importPreview.existingPodcast.artworkUrl ? (
                              <span className="text-[var(--color-success)]">設定済み</span>
                            ) : (
                              <span className="text-[var(--color-text-faint)]">未設定</span>
                            )}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.artworkUrl !== importPreview.existingPodcast.artworkUrl
                              ? "text-[var(--color-accent)]"
                              : "text-[var(--color-text-muted)]"
                          }`}>
                            {importPreview.podcast.artworkUrl ? (
                              <span>外部URL（上書き）</span>
                            ) : (
                              <span className="text-[var(--color-text-faint)]">-</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-3">
                    ※ 紫色で表示されている項目は現在の設定と異なる値です
                  </p>
                </div>
              )}

              {/* 重複警告 */}
              {importPreview.episodes.some((ep) => ep.hasConflict && !ep.alreadyImported) && (
                <div className="mb-4 p-3 bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 rounded-lg">
                  <p className="text-sm text-[var(--color-error)]">
                    {importPreview.episodes.filter((ep) => ep.hasConflict && !ep.alreadyImported).length}
                    件のエピソードでslugが既存と重複しています（赤字で表示）
                  </p>
                </div>
              )}

              <div className="border-t border-[var(--color-border)] pt-4 mb-4">
                <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">エピソード一覧</h4>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[var(--color-text-muted)] text-left">
                      <tr>
                        <th className="pb-2 pr-4">タイトル</th>
                        <th className="pb-2 pr-4 w-32">Slug</th>
                        <th className="pb-2 pr-4 w-20 text-right">サイズ</th>
                        <th className="pb-2 w-24 text-right">公開日</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {importPreview.episodes.map((ep, i) => (
                        <tr
                          key={i}
                          className={
                            ep.alreadyImported
                              ? "text-[var(--color-text-faint)]"
                              : ep.hasConflict
                              ? "text-[var(--color-error)]"
                              : ""
                          }
                        >
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              {ep.alreadyImported ? (
                                <span title="インポート済み" className="text-[var(--color-text-muted)]">✓</span>
                              ) : ep.hasConflict ? (
                                <span title="slugが既存と重複">⚠</span>
                              ) : null}
                              <span className="line-clamp-1">{ep.title}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">
                            {ep.alreadyImported ? (
                              <span className="text-[var(--color-text-faint)]">-</span>
                            ) : (
                              <input
                                type="text"
                                value={customSlugs[String(ep.index)] ?? ep.slug}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setCustomSlugs((prev) => {
                                    if (value === ep.slug) {
                                      const { [String(ep.index)]: _, ...rest } = prev;
                                      return rest;
                                    }
                                    return { ...prev, [String(ep.index)]: value };
                                  });
                                }}
                                className={`w-full px-2 py-1 bg-[var(--color-bg-hover)] border rounded text-xs ${
                                  customSlugs[String(ep.index)]
                                    ? "border-[var(--color-accent)]"
                                    : ep.hasConflict
                                    ? "border-[var(--color-error)]"
                                    : "border-[var(--color-border)]"
                                }`}
                                placeholder={ep.slug}
                              />
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right text-[var(--color-text-muted)]">
                            {ep.fileSize > 0
                              ? `${(ep.fileSize / 1024 / 1024).toFixed(1)} MB`
                              : "-"}
                          </td>
                          <td className="py-2 text-right text-[var(--color-text-muted)]">
                            {new Date(ep.pubDate).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={handleImportRss}
                disabled={importing || importPreview.newEpisodeCount === 0}
                className="btn btn-primary w-full"
              >
                {importing
                  ? importAudio
                    ? "インポート中（オーディオをダウンロード中...）"
                    : "インポート中..."
                  : importPreview.newEpisodeCount === 0
                  ? "インポートするエピソードがありません"
                  : `${importPreview.newEpisodeCount}件をインポート`}
              </button>
            </div>
          )}

          {/* Result */}
          {importResult && (
            <div className="card p-5">
              <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">インポート結果</h3>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 p-4 bg-[var(--color-success-muted)] border border-[var(--color-success)]/30 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[var(--color-success)]">
                    {importResult.imported}
                  </div>
                  <div className="text-sm text-[var(--color-text-secondary)]">インポート成功</div>
                </div>
                <div className="flex-1 p-4 bg-[var(--color-warning-muted)] border border-[var(--color-warning)]/30 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[var(--color-warning)]">
                    {importResult.skipped}
                  </div>
                  <div className="text-sm text-[var(--color-text-secondary)]">スキップ</div>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {importResult.episodes.map((ep, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between text-sm py-2 px-3 rounded ${
                      ep.status === "imported"
                        ? "bg-[var(--color-success-muted)]"
                        : "bg-[var(--color-warning-muted)]"
                    }`}
                  >
                    <span>{ep.title}</span>
                    <span
                      className={
                        ep.status === "imported"
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-warning)]"
                      }
                    >
                      {ep.status === "imported" ? "成功" : ep.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Backup */}
      {activeTab === "backup" && (
        <div className="space-y-4">
          {/* Export */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">エクスポート</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              全てのデータ（設定、エピソード、音声ファイル、文字起こし、画像）をZIPファイルとしてダウンロードします。
            </p>

            {exportProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-[var(--color-text-secondary)] mb-1">
                  <span>ファイルをダウンロード中...</span>
                  <span>{exportProgress.current} / {exportProgress.total}</span>
                </div>
                <div className="h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent)] transition-all duration-300"
                    style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleExportBackup}
              disabled={exporting}
              className="btn btn-primary"
            >
              {exporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  エクスポート中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  ZIPをダウンロード
                </>
              )}
            </button>
          </div>

          {/* Import */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">インポート</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              エクスポートしたZIPファイルからデータを復元します。
              既存のエピソードと重複するIDは上書きされます。
            </p>

            {importProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-[var(--color-text-secondary)] mb-1">
                  <span>{importProgress.phase}</span>
                  {importProgress.total > 0 && (
                    <span>{importProgress.current} / {importProgress.total}</span>
                  )}
                </div>
                {importProgress.total > 0 && (
                  <div className="h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <input
              ref={backupFileInputRef}
              type="file"
              accept=".zip"
              onChange={handleImportBackup}
              disabled={importingBackup}
              className="hidden"
              id="backup-import"
            />
            <label
              htmlFor="backup-import"
              className={`btn btn-secondary cursor-pointer ${
                importingBackup ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {importingBackup ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  インポート中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  ZIPファイルを選択
                </>
              )}
            </label>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {activeTab === "danger" && (
        <div className="space-y-4">
          <div className="border border-[var(--color-error)]/50 bg-[var(--color-error-muted)] rounded-lg p-5">
            <h2 className="text-base font-semibold text-[var(--color-error)] mb-4">
              全データの削除
            </h2>
            <div className="space-y-4">
              <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
                <p>
                  この操作を実行すると、R2バケット内の全てのデータが削除されます：
                </p>
                <ul className="list-disc list-inside text-[var(--color-text-muted)] space-y-1">
                  <li>全てのエピソード（音声ファイル、文字起こし、OG画像を含む）</li>
                  <li>Podcast設定（タイトル、説明、著者など）</li>
                  <li>アートワークとOGP画像</li>
                  <li>説明文テンプレート</li>
                  <li>RSSフィード</li>
                </ul>
                <p className="text-[var(--color-error)] font-medium mt-4">
                  この操作は取り消せません。
                </p>
              </div>

              <div>
                <label className="label">
                  確認のため「削除する」と入力してください
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="削除する"
                  className="input focus:border-[var(--color-error)]"
                />
              </div>

              <button
                onClick={handleResetAllData}
                disabled={resetting || resetConfirmText !== "削除する"}
                className="w-full py-2.5 bg-[var(--color-error-muted)] hover:bg-[var(--color-error)] text-[var(--color-error)] hover:text-white border border-[var(--color-error)]/50 hover:border-[var(--color-error)] font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-error-muted)] disabled:hover:text-[var(--color-error)]"
              >
                {resetting ? "削除中..." : "全データを削除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
