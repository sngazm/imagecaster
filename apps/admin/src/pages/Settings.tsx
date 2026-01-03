import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import { api, uploadToR2 } from "../lib/api";
import type { PodcastSettings, DescriptionTemplate, ExportManifest } from "../lib/api";
import { HtmlEditor } from "../components/HtmlEditor";

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
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-zinc-700 border-t-violet-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          to="/"
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">設定</h1>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 rounded-lg">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("general")}
          className={`px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "general"
              ? "text-violet-400 border-b-2 border-violet-400"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          基本設定
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "templates"
              ? "text-violet-400 border-b-2 border-violet-400"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          テンプレート
        </button>
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "import"
              ? "text-violet-400 border-b-2 border-violet-400"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          RSSインポート
        </button>
        <button
          onClick={() => setActiveTab("backup")}
          className={`px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "backup"
              ? "text-violet-400 border-b-2 border-violet-400"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          バックアップ
        </button>
        <button
          onClick={() => setActiveTab("danger")}
          className={`px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === "danger"
              ? "text-red-400 border-b-2 border-red-400"
              : "text-zinc-400 hover:text-red-400"
          }`}
        >
          危険な操作
        </button>
      </div>

      {/* General Settings */}
      {activeTab === "general" && settings && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Artwork */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">アートワーク</h2>
            <div className="flex items-start gap-6">
              <div className="w-32 h-32 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                {(artworkPreview || settings.artworkUrl) ? (
                  <img
                    src={artworkPreview || settings.artworkUrl}
                    alt="Podcast artwork"
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
                  onChange={handleArtworkSelect}
                  className="hidden"
                  id="artwork-upload"
                />
                <label
                  htmlFor="artwork-upload"
                  className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg cursor-pointer text-sm font-medium transition-colors"
                >
                  画像を選択
                </label>
                {artworkFile && (
                  <div className="mt-3">
                    <p className="text-sm text-zinc-400 mb-2">
                      {artworkFile.name} ({(artworkFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                    <button
                      type="button"
                      onClick={handleArtworkUpload}
                      disabled={uploadingArtwork}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {uploadingArtwork ? "アップロード中..." : "アップロード"}
                    </button>
                  </div>
                )}
                <p className="text-xs text-zinc-500 mt-2">
                  推奨: 3000x3000px、JPEGまたはPNG、最大5MB
                </p>
              </div>
            </div>
          </div>

          {/* OGP Image */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">OGP画像</h2>
            <p className="text-sm text-zinc-400 mb-4">
              SNSでシェアされた時に表示される画像です。
            </p>
            <div className="flex items-start gap-6">
              <div className="w-48 h-24 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                {(ogImagePreview || settings.ogImageUrl) ? (
                  <img
                    src={ogImagePreview || settings.ogImageUrl}
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
                  id="og-image-upload"
                />
                <label
                  htmlFor="og-image-upload"
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

          {/* Basic Info */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold mb-4">基本情報</h2>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                番組名
              </label>
              <input
                type="text"
                value={settings.title}
                onChange={(e) =>
                  setSettings({ ...settings, title: e.target.value })
                }
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                説明
              </label>
              <textarea
                value={settings.description}
                onChange={(e) =>
                  setSettings({ ...settings, description: e.target.value })
                }
                rows={4}
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  著者
                </label>
                <input
                  type="text"
                  value={settings.author}
                  onChange={(e) =>
                    setSettings({ ...settings, author: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) =>
                    setSettings({ ...settings, email: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  言語
                </label>
                <select
                  value={settings.language}
                  onChange={(e) =>
                    setSettings({ ...settings, language: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  カテゴリ
                </label>
                <select
                  value={settings.category}
                  onChange={(e) =>
                    setSettings({ ...settings, category: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
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
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                ウェブサイトURL
              </label>
              <input
                type="url"
                value={settings.websiteUrl}
                onChange={(e) =>
                  setSettings({ ...settings, websiteUrl: e.target.value })
                }
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="explicit"
                checked={settings.explicit}
                onChange={(e) =>
                  setSettings({ ...settings, explicit: e.target.checked })
                }
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-violet-600 focus:ring-violet-500"
              />
              <label htmlFor="explicit" className="text-sm text-zinc-300">
                成人向けコンテンツを含む
              </label>
            </div>
          </div>

          {/* Apple Podcasts Integration */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold mb-4">Apple Podcasts 連携</h2>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                Apple Podcasts ID
              </label>
              <input
                type="text"
                value={settings.applePodcastsId || ""}
                onChange={(e) =>
                  setSettings({ ...settings, applePodcastsId: e.target.value || null })
                }
                placeholder="1234567890"
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-colors"
              />
              <p className="text-xs text-zinc-500 mt-2">
                Apple Podcasts のURLに含まれる ID を入力してください。<br />
                例: https://podcasts.apple.com/jp/podcast/id<strong>1234567890</strong><br />
                設定すると、Cron で定期的にエピソードごとの Apple Podcasts リンクを取得します。
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </form>
      )}

      {/* Templates */}
      {activeTab === "templates" && (
        <div className="space-y-6">
          {/* Template list */}
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4"
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
                      className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
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
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingTemplate(null)}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{template.name}</h3>
                        {template.isDefault && (
                          <span className="px-2 py-0.5 bg-violet-500/20 text-violet-400 rounded text-xs font-medium">
                            デフォルト
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-500 mt-1 line-clamp-2">
                        {template.content.replace(/<[^>]*>/g, "").slice(0, 100)}...
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!template.isDefault && (
                        <button
                          onClick={() => handleSetDefaultTemplate(template.id)}
                          className="p-2 text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 rounded-lg transition-colors"
                          title="デフォルトに設定"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setEditingTemplate(template)}
                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template.id)}
                        className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
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
              <div className="text-center py-8 text-zinc-500">
                テンプレートがありません
              </div>
            )}
          </div>

          {/* New template form */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">新規テンプレート</h3>
            <div className="space-y-4">
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
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
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                テンプレートを作成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RSS Import */}
      {activeTab === "import" && (
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">RSSフィードからインポート</h2>
            <p className="text-sm text-zinc-400 mb-4">
              既存のポッドキャストのRSSフィードURLを入力してエピソードをインポートします。
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="url"
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              />
              <button
                onClick={handlePreviewRss}
                disabled={importing || !rssUrl.trim()}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium disabled:opacity-50"
              >
                {importing ? "読み込み中..." : "プレビュー"}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={importAudio}
                onChange={(e) => setImportAudio(e.target.checked)}
                className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-violet-600 focus:ring-violet-500"
              />
              <span>オーディオファイルをコピーする（R2にダウンロード保存）</span>
            </label>
            {!importAudio && (
              <p className="text-xs text-zinc-500 mt-1 ml-6">
                チェックしない場合、音声は外部URLへの参照として保存されます
              </p>
            )}

            <label className="flex items-center gap-2 text-sm text-zinc-400 mt-3">
              <input
                type="checkbox"
                checked={importPodcastSettings}
                onChange={(e) => setImportPodcastSettings(e.target.checked)}
                className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-violet-600 focus:ring-violet-500"
              />
              <span>Podcast設定を上書きする</span>
            </label>
            <p className="text-xs text-zinc-500 mt-1 ml-6">
              チェックすると、RSSフィードの番組情報で現在の設定を上書きします
            </p>
          </div>

          {/* Preview */}
          {importPreview && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{importPreview.podcast.title}</h3>
                  <p className="text-sm text-zinc-400">{importPreview.podcast.author}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-2">
                    <span className="px-3 py-1 bg-violet-500/20 text-violet-400 rounded-full text-sm">
                      新規 {importPreview.newEpisodeCount}件
                    </span>
                    {importPreview.episodeCount - importPreview.newEpisodeCount > 0 && (
                      <span className="px-3 py-1 bg-zinc-700/50 text-zinc-400 rounded-full text-sm">
                        済 {importPreview.episodeCount - importPreview.newEpisodeCount}件
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">
                    新規分: {(importPreview.totalFileSize / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              </div>

              <p className="text-sm text-zinc-500 mb-4 line-clamp-2">
                {importPreview.podcast.description}
              </p>

              {/* Podcast設定比較 */}
              {importPodcastSettings && (
                <div className="mb-4 p-4 bg-violet-500/10 border border-violet-500/30 rounded-lg">
                  <h4 className="text-sm font-medium text-violet-400 mb-3">Podcast設定の変更内容</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-zinc-500 text-left">
                        <tr>
                          <th className="pb-2 pr-4 w-24">項目</th>
                          <th className="pb-2 pr-4">現在の設定</th>
                          <th className="pb-2">RSSフィードの値</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        <tr>
                          <td className="py-2 pr-4 text-zinc-400">番組名</td>
                          <td className="py-2 pr-4 text-zinc-500 truncate max-w-[200px]">
                            {importPreview.existingPodcast.title || <span className="text-zinc-600">未設定</span>}
                          </td>
                          <td className={`py-2 truncate max-w-[200px] ${
                            importPreview.podcast.title !== importPreview.existingPodcast.title
                              ? "text-violet-400"
                              : "text-zinc-500"
                          }`}>
                            {importPreview.podcast.title || <span className="text-zinc-600">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-zinc-400">著者</td>
                          <td className="py-2 pr-4 text-zinc-500 truncate max-w-[200px]">
                            {importPreview.existingPodcast.author || <span className="text-zinc-600">未設定</span>}
                          </td>
                          <td className={`py-2 truncate max-w-[200px] ${
                            importPreview.podcast.author !== importPreview.existingPodcast.author
                              ? "text-violet-400"
                              : "text-zinc-500"
                          }`}>
                            {importPreview.podcast.author || <span className="text-zinc-600">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-zinc-400">言語</td>
                          <td className="py-2 pr-4 text-zinc-500">
                            {importPreview.existingPodcast.language || <span className="text-zinc-600">未設定</span>}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.language !== importPreview.existingPodcast.language
                              ? "text-violet-400"
                              : "text-zinc-500"
                          }`}>
                            {importPreview.podcast.language || <span className="text-zinc-600">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-zinc-400">カテゴリ</td>
                          <td className="py-2 pr-4 text-zinc-500">
                            {importPreview.existingPodcast.category || <span className="text-zinc-600">未設定</span>}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.category !== importPreview.existingPodcast.category
                              ? "text-violet-400"
                              : "text-zinc-500"
                          }`}>
                            {importPreview.podcast.category || <span className="text-zinc-600">-</span>}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-zinc-400">アートワーク</td>
                          <td className="py-2 pr-4 text-zinc-500">
                            {importPreview.existingPodcast.artworkUrl ? (
                              <span className="text-emerald-400">設定済み</span>
                            ) : (
                              <span className="text-zinc-600">未設定</span>
                            )}
                          </td>
                          <td className={`py-2 ${
                            importPreview.podcast.artworkUrl !== importPreview.existingPodcast.artworkUrl
                              ? "text-violet-400"
                              : "text-zinc-500"
                          }`}>
                            {importPreview.podcast.artworkUrl ? (
                              <span>外部URL（上書き）</span>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-zinc-500 mt-3">
                    ※ 紫色で表示されている項目は現在の設定と異なる値です
                  </p>
                </div>
              )}

              {/* 重複警告 */}
              {importPreview.episodes.some((ep) => ep.hasConflict && !ep.alreadyImported) && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-400">
                    {importPreview.episodes.filter((ep) => ep.hasConflict && !ep.alreadyImported).length}
                    件のエピソードでslugが既存と重複しています（赤字で表示）
                  </p>
                </div>
              )}

              <div className="border-t border-zinc-800 pt-4 mb-4">
                <h4 className="text-sm font-medium mb-2">エピソード一覧</h4>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 text-left">
                      <tr>
                        <th className="pb-2 pr-4">タイトル</th>
                        <th className="pb-2 pr-4 w-32">Slug</th>
                        <th className="pb-2 pr-4 w-20 text-right">サイズ</th>
                        <th className="pb-2 w-24 text-right">公開日</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {importPreview.episodes.map((ep, i) => (
                        <tr
                          key={i}
                          className={
                            ep.alreadyImported
                              ? "text-zinc-600"
                              : ep.hasConflict
                              ? "text-red-400"
                              : ""
                          }
                        >
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              {ep.alreadyImported ? (
                                <span title="インポート済み" className="text-zinc-500">✓</span>
                              ) : ep.hasConflict ? (
                                <span title="slugが既存と重複">⚠</span>
                              ) : null}
                              <span className="line-clamp-1">{ep.title}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">
                            {ep.alreadyImported ? (
                              <span className="text-zinc-600">-</span>
                            ) : (
                              <input
                                type="text"
                                value={customSlugs[String(ep.index)] ?? ep.slug}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setCustomSlugs((prev) => {
                                    if (value === ep.slug) {
                                      // デフォルト値と同じ場合は削除
                                      const { [String(ep.index)]: _, ...rest } = prev;
                                      return rest;
                                    }
                                    return { ...prev, [String(ep.index)]: value };
                                  });
                                }}
                                className={`w-full px-2 py-1 bg-zinc-800 border rounded text-xs ${
                                  customSlugs[String(ep.index)]
                                    ? "border-violet-500"
                                    : ep.hasConflict
                                    ? "border-red-500"
                                    : "border-zinc-700"
                                }`}
                                placeholder={ep.slug}
                              />
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right text-zinc-500">
                            {ep.fileSize > 0
                              ? `${(ep.fileSize / 1024 / 1024).toFixed(1)} MB`
                              : "-"}
                          </td>
                          <td className="py-2 text-right text-zinc-500">
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
                className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50"
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
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">インポート結果</h3>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-center">
                  <div className="text-2xl font-bold text-emerald-400">
                    {importResult.imported}
                  </div>
                  <div className="text-sm text-zinc-400">インポート成功</div>
                </div>
                <div className="flex-1 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-center">
                  <div className="text-2xl font-bold text-amber-400">
                    {importResult.skipped}
                  </div>
                  <div className="text-sm text-zinc-400">スキップ</div>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {importResult.episodes.map((ep, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between text-sm py-2 px-3 rounded ${
                      ep.status === "imported"
                        ? "bg-emerald-500/5"
                        : "bg-amber-500/5"
                    }`}
                  >
                    <span>{ep.title}</span>
                    <span
                      className={
                        ep.status === "imported"
                          ? "text-emerald-400"
                          : "text-amber-400"
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
        <div className="space-y-6">
          {/* Export */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">エクスポート</h2>
            <p className="text-sm text-zinc-400 mb-4">
              全てのデータ（設定、エピソード、音声ファイル、文字起こし、画像）をZIPファイルとしてダウンロードします。
            </p>

            {exportProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-zinc-400 mb-1">
                  <span>ファイルをダウンロード中...</span>
                  <span>{exportProgress.current} / {exportProgress.total}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all duration-300"
                    style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleExportBackup}
              disabled={exporting}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {exporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  エクスポート中...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  ZIPをダウンロード
                </>
              )}
            </button>
          </div>

          {/* Import */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">インポート</h2>
            <p className="text-sm text-zinc-400 mb-4">
              エクスポートしたZIPファイルからデータを復元します。
              既存のエピソードと重複するIDは上書きされます。
            </p>

            {importProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-zinc-400 mb-1">
                  <span>{importProgress.phase}</span>
                  {importProgress.total > 0 && (
                    <span>{importProgress.current} / {importProgress.total}</span>
                  )}
                </div>
                {importProgress.total > 0 && (
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 transition-all duration-300"
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
              className={`inline-flex items-center gap-2 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium transition-colors cursor-pointer ${
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
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
        <div className="space-y-6">
          <div className="border border-red-500/50 bg-red-500/5 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-red-400 mb-4">
              全データの削除
            </h2>
            <div className="space-y-4">
              <div className="text-sm text-zinc-400 space-y-2">
                <p>
                  この操作を実行すると、R2バケット内の全てのデータが削除されます：
                </p>
                <ul className="list-disc list-inside text-zinc-500 space-y-1">
                  <li>全てのエピソード（音声ファイル、文字起こし、OG画像を含む）</li>
                  <li>Podcast設定（タイトル、説明、著者など）</li>
                  <li>アートワークとOGP画像</li>
                  <li>説明文テンプレート</li>
                  <li>RSSフィード</li>
                </ul>
                <p className="text-red-400 font-medium mt-4">
                  この操作は取り消せません。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  確認のため「削除する」と入力してください
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="削除する"
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-colors"
                />
              </div>

              <button
                onClick={handleResetAllData}
                disabled={resetting || resetConfirmText !== "削除する"}
                className="w-full py-3 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/50 hover:border-red-500 font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500/10 disabled:hover:text-red-400"
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
