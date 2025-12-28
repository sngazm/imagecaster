import { useState, useEffect, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, uploadToR2, getAudioDuration } from "../lib/api";
import type { DescriptionTemplate } from "../lib/api";
import { HtmlEditor } from "../components/HtmlEditor";

type Status = "idle" | "creating" | "uploading" | "completing" | "done" | "error";
type AudioSource = "file" | "url";

export default function EpisodeNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [audioSource, setAudioSource] = useState<AudioSource>("file");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [skipTranscription, setSkipTranscription] = useState(true);
  const [publishAt, setPublishAt] = useState<string>("");
  const [blueskyPostText, setBlueskyPostText] = useState("");
  const [blueskyPostEnabled, setBlueskyPostEnabled] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(console.error);
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handleSubmit = async (e: FormEvent, isDraft: boolean = false) => {
    e.preventDefault();

    if (!title.trim()) {
      setStatus("error");
      setMessage("タイトルを入力してください");
      return;
    }

    try {
      setStatus("creating");
      setMessage("エピソードを作成中...");

      const episode = await api.createEpisode({
        title: title.trim(),
        slug: slug.trim() || undefined,
        description: description.trim(),
        publishAt: isDraft ? null : (publishAt || new Date().toISOString()),
        skipTranscription,
        blueskyPostText: blueskyPostText.trim() || null,
        blueskyPostEnabled,
      });

      // 音声ソースに応じてアップロード
      if (audioSource === "file" && file) {
        setStatus("uploading");
        setMessage("音声をアップロード中...");

        const { uploadUrl } = await api.getUploadUrl(
          episode.id,
          file.type || "audio/mpeg",
          file.size
        );

        await uploadToR2(uploadUrl, file);

        setStatus("completing");
        setMessage("処理を完了中...");

        const duration = await getAudioDuration(file);
        await api.completeUpload(episode.id, duration, file.size);
      } else if (audioSource === "url" && audioUrl.trim()) {
        setStatus("uploading");
        setMessage("URLから音声を取得中...");

        await api.uploadFromUrl(episode.id, audioUrl.trim());
      }

      setStatus("done");
      setMessage(isDraft
        ? `エピソード "${title}" を下書き保存しました`
        : `エピソード "${title}" を登録しました`
      );

      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  const applyTemplate = (template: DescriptionTemplate) => {
    setDescription(template.content);
    setShowTemplates(false);
  };

  const isSubmitting = status === "creating" || status === "uploading" || status === "completing";

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
        <h1 className="text-2xl font-bold tracking-tight">新規エピソード</h1>
      </header>

      <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-6">
          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-zinc-400 mb-2">
              タイトル
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="エピソードのタイトル"
              disabled={isSubmitting || status === "done"}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-50"
            />
          </div>

          {/* Slug and Episode Number */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-zinc-400 mb-2">
                Slug（任意）
              </label>
              <input
                type="text"
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-episode"
                disabled={isSubmitting || status === "done"}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-50 font-mono text-sm"
              />
              <p className="text-xs text-zinc-600 mt-1">URLに使用されます。空欄で自動生成</p>
            </div>
          </div>

          {/* Description with template selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-zinc-400">
                説明（任意）
              </label>
              {templates.length > 0 && (
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
            <HtmlEditor
              value={description}
              onChange={setDescription}
              placeholder="エピソードの説明を入力..."
            />
          </div>

          {/* Audio source */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              音声ソース（任意）
            </label>

            {/* Source type selector */}
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="audioSource"
                  value="file"
                  checked={audioSource === "file"}
                  onChange={() => setAudioSource("file")}
                  disabled={isSubmitting || status === "done"}
                  className="w-4 h-4 text-violet-600 bg-zinc-900 border-zinc-700 focus:ring-violet-500"
                />
                <span className="text-sm text-zinc-300">ファイルをアップロード</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="audioSource"
                  value="url"
                  checked={audioSource === "url"}
                  onChange={() => setAudioSource("url")}
                  disabled={isSubmitting || status === "done"}
                  className="w-4 h-4 text-violet-600 bg-zinc-900 border-zinc-700 focus:ring-violet-500"
                />
                <span className="text-sm text-zinc-300">URLから取得</span>
              </label>
            </div>

            {/* File input */}
            {audioSource === "file" && (
              <div className="relative">
                <input
                  type="file"
                  id="audio"
                  accept="audio/*"
                  onChange={handleFileChange}
                  disabled={isSubmitting || status === "done"}
                  className="w-full px-4 py-4 bg-zinc-900 border-2 border-dashed border-zinc-700 rounded-lg text-zinc-400 file:hidden cursor-pointer hover:border-violet-500 focus:outline-none focus:border-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {file && (
                  <div className="mt-2 text-sm text-zinc-500">
                    {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            )}

            {/* URL input */}
            {audioSource === "url" && (
              <div>
                <input
                  type="url"
                  id="audioUrl"
                  value={audioUrl}
                  onChange={(e) => setAudioUrl(e.target.value)}
                  placeholder="https://example.com/audio.mp3"
                  disabled={isSubmitting || status === "done"}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-50"
                />
                <p className="text-xs text-zinc-600 mt-1">NextCloud共有リンクも使用可能です</p>
              </div>
            )}

            <p className="text-xs text-zinc-600 mt-1">後からアップロードすることもできます</p>
          </div>

          {/* Publish At */}
          <div>
            <label htmlFor="publishAt" className="block text-sm font-medium text-zinc-400 mb-2">
              公開日時（任意）
            </label>
            <input
              type="datetime-local"
              id="publishAt"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              disabled={isSubmitting || status === "done"}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-50"
            />
            <p className="text-xs text-zinc-600 mt-1">空欄で即時公開（下書き保存の場合は無視）</p>
          </div>

          {/* Skip transcription */}
          <label className="flex items-start gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700 transition-colors">
            <input
              type="checkbox"
              checked={skipTranscription}
              onChange={(e) => setSkipTranscription(e.target.checked)}
              disabled={isSubmitting || status === "done"}
              className="mt-0.5 w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-violet-600 focus:ring-violet-500 focus:ring-offset-0"
            />
            <div>
              <span className="block text-sm font-medium text-zinc-200">
                文字起こしをスキップ
              </span>
              <span className="block text-xs text-zinc-500 mt-1">
                スキップすると音声アップロード後すぐに公開予約状態になります
              </span>
            </div>
          </label>
        </div>

        {/* Bluesky Auto-Post */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <h3 className="text-sm font-medium text-zinc-200">Bluesky 自動投稿</h3>
          </div>

          <label className="flex items-start gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700 transition-colors">
            <input
              type="checkbox"
              checked={blueskyPostEnabled}
              onChange={(e) => setBlueskyPostEnabled(e.target.checked)}
              disabled={isSubmitting || status === "done"}
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

          {blueskyPostEnabled && (
            <div>
              <label htmlFor="blueskyPostText" className="block text-sm font-medium text-zinc-400 mb-2">
                投稿テキスト
              </label>
              <textarea
                id="blueskyPostText"
                value={blueskyPostText}
                onChange={(e) => setBlueskyPostText(e.target.value)}
                placeholder={"🎙️ 新エピソード公開！\n{{TITLE}}\n\n詳しくはこちら👇\n{{EPISODE_URL}}"}
                rows={5}
                disabled={isSubmitting || status === "done"}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all disabled:opacity-50 font-mono text-sm"
              />
              <p className="text-xs text-zinc-500 mt-2">
                使用可能なプレースホルダ: <code className="text-sky-400">{"{{TITLE}}"}</code> <code className="text-sky-400">{"{{EPISODE_URL}}"}</code> <code className="text-sky-400">{"{{AUDIO_URL}}"}</code>
              </p>
            </div>
          )}
        </div>

        {/* Status messages */}
        {status !== "idle" && status !== "done" && status !== "error" && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/50 rounded-lg text-blue-400">
            <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            {message}
          </div>
        )}

        {status === "done" && (
          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/50 rounded-lg text-emerald-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {message}
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {message}
          </div>
        )}

        {/* Submit buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            disabled={isSubmitting || status === "done"}
            className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-white font-medium rounded-lg transition-all disabled:cursor-not-allowed"
          >
            下書き保存
          </button>
          <button
            type="submit"
            disabled={isSubmitting || status === "done"}
            className="flex-1 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-violet-500/25 disabled:shadow-none disabled:cursor-not-allowed"
          >
            {isSubmitting ? "処理中..." : "公開予約"}
          </button>
        </div>
      </form>
    </div>
  );
}
