import { useState, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, uploadToR2, getAudioDuration } from "../lib/api";

type Status = "idle" | "creating" | "uploading" | "completing" | "done" | "error";

export default function EpisodeNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [skipTranscription, setSkipTranscription] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !file) {
      setStatus("error");
      setMessage("タイトルと音声ファイルを入力してください");
      return;
    }

    try {
      setStatus("creating");
      setMessage("エピソードを作成中...");

      const episode = await api.createEpisode({
        title: title.trim(),
        description: description.trim(),
        publishAt: new Date().toISOString(),
        skipTranscription,
      });

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

      setStatus("done");
      setMessage(`エピソード "${title}" を登録しました`);

      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-6">
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

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-zinc-400 mb-2">
              説明（任意）
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="エピソードの説明"
              rows={4}
              disabled={isSubmitting || status === "done"}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all resize-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="audio" className="block text-sm font-medium text-zinc-400 mb-2">
              音声ファイル
            </label>
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
          </div>

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
                スキップすると即座に公開予約状態になります
              </span>
            </div>
          </label>
        </div>

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

        <button
          type="submit"
          disabled={isSubmitting || status === "done"}
          className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-violet-500/25 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {isSubmitting ? "処理中..." : "登録"}
        </button>
      </form>
    </div>
  );
}
