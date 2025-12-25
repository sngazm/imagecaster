import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, uploadToR2 } from "../lib/api";
import type { PodcastSettings, DescriptionTemplate } from "../lib/api";
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
  const [activeTab, setActiveTab] = useState<"general" | "templates" | "import">("general");
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

  // Template editing
  const [editingTemplate, setEditingTemplate] = useState<DescriptionTemplate | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");

  // RSS Import
  const [rssUrl, setRssUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<Awaited<
    ReturnType<typeof api.previewRssImport>
  > | null>(null);
  const [importResult, setImportResult] = useState<Awaited<
    ReturnType<typeof api.importRss>
  > | null>(null);

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

  async function handlePreviewRss() {
    if (!rssUrl.trim()) return;

    setImporting(true);
    setError(null);
    setImportPreview(null);
    setImportResult(null);

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

    setImporting(true);
    setError(null);

    try {
      const result = await api.importRss(rssUrl);
      setImportResult(result);
      setImportPreview(null);
      setSuccess(`${result.imported}件のエピソードをインポートしました`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import RSS");
    } finally {
      setImporting(false);
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
                      <h3 className="font-medium">{template.name}</h3>
                      <p className="text-sm text-zinc-500 mt-1 line-clamp-2">
                        {template.content.replace(/<[^>]*>/g, "").slice(0, 100)}...
                      </p>
                    </div>
                    <div className="flex gap-2">
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
              音声ファイルはダウンロードせず、外部URLへの参照として保存されます。
            </p>

            <div className="flex gap-2">
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
          </div>

          {/* Preview */}
          {importPreview && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{importPreview.podcast.title}</h3>
                  <p className="text-sm text-zinc-400">{importPreview.podcast.author}</p>
                </div>
                <span className="px-3 py-1 bg-violet-500/20 text-violet-400 rounded-full text-sm">
                  {importPreview.episodeCount}件
                </span>
              </div>

              <p className="text-sm text-zinc-500 mb-4 line-clamp-2">
                {importPreview.podcast.description}
              </p>

              <div className="border-t border-zinc-800 pt-4 mb-4">
                <h4 className="text-sm font-medium mb-2">エピソード一覧</h4>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {importPreview.episodes.slice(0, 20).map((ep, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm py-2 border-b border-zinc-800 last:border-0"
                    >
                      <div>
                        <span className="text-zinc-500 mr-2">#{ep.episodeNumber}</span>
                        <span>{ep.title}</span>
                      </div>
                      <span className="text-zinc-500">{new Date(ep.pubDate).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {importPreview.episodes.length > 20 && (
                    <p className="text-center text-zinc-500 py-2">
                      他 {importPreview.episodes.length - 20} 件
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={handleImportRss}
                disabled={importing}
                className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50"
              >
                {importing ? "インポート中..." : "インポートを実行"}
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
    </div>
  );
}
