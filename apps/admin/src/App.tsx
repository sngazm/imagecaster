import { useState, useEffect, FormEvent, ChangeEvent } from "react";
import { api, uploadToR2, getAudioDuration, Episode } from "./lib/api";

type SubmitStatus = "idle" | "creating" | "uploading" | "completing" | "done" | "error";

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  uploading: "アップロード中",
  processing: "処理中",
  transcribing: "文字起こし中",
  scheduled: "予約済み",
  published: "公開済み",
  failed: "エラー",
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [message, setMessage] = useState("");

  // エピソード一覧を取得
  const fetchEpisodes = async () => {
    try {
      setListError(null);
      const data = await api.getEpisodes();
      setEpisodes(data.episodes);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !file) {
      setSubmitStatus("error");
      setMessage("タイトルと音声ファイルを入力してください");
      return;
    }

    try {
      // 1. エピソード作成
      setSubmitStatus("creating");
      setMessage("エピソードを作成中...");

      const episode = await api.createEpisode({
        title: title.trim(),
        publishAt: new Date().toISOString(),
        skipTranscription: true,
      });

      // 2. Presigned URL 取得
      setSubmitStatus("uploading");
      setMessage("音声をアップロード中...");

      const { uploadUrl } = await api.getUploadUrl(
        episode.id,
        file.type || "audio/mpeg",
        file.size
      );

      // 3. R2 にアップロード
      await uploadToR2(uploadUrl, file);

      // 4. 完了通知
      setSubmitStatus("completing");
      setMessage("処理を完了中...");

      const duration = await getAudioDuration(file);
      await api.completeUpload(episode.id, duration, file.size);

      // 完了
      setSubmitStatus("done");
      setMessage(`エピソード "${title}" を登録しました (${episode.id})`);

      // フォームリセット
      setTitle("");
      setFile(null);
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (fileInput) fileInput.value = "";

      // 一覧を更新
      fetchEpisodes();

    } catch (err) {
      setSubmitStatus("error");
      setMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  const isSubmitting = submitStatus === "creating" || submitStatus === "uploading" || submitStatus === "completing";

  return (
    <div className="container">
      <h1>Podcast 管理</h1>

      {/* 登録フォーム */}
      <section className="section">
        <h2>新規エピソード登録</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">タイトル</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="エピソードのタイトル"
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="audio">音声ファイル</label>
            <input
              type="file"
              id="audio"
              accept="audio/*"
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
          </div>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "処理中..." : "登録"}
          </button>
        </form>

        {(submitStatus === "creating" || submitStatus === "uploading" || submitStatus === "completing") && (
          <div className="progress">{message}</div>
        )}

        {submitStatus === "done" && <div className="success">{message}</div>}

        {submitStatus === "error" && <div className="error">{message}</div>}
      </section>

      {/* エピソード一覧 */}
      <section className="section">
        <h2>エピソード一覧</h2>

        {isLoading && <div className="loading">読み込み中...</div>}

        {listError && <div className="error">{listError}</div>}

        {!isLoading && !listError && episodes.length === 0 && (
          <div className="empty">エピソードがありません</div>
        )}

        {!isLoading && !listError && episodes.length > 0 && (
          <table className="episode-table">
            <thead>
              <tr>
                <th>#</th>
                <th>タイトル</th>
                <th>ステータス</th>
                <th>公開日時</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => (
                <tr key={ep.id}>
                  <td>{ep.episodeNumber}</td>
                  <td>{ep.title}</td>
                  <td>
                    <span className={`status status-${ep.status}`}>
                      {STATUS_LABELS[ep.status] || ep.status}
                    </span>
                  </td>
                  <td>{formatDate(ep.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          className="refresh-button"
          onClick={fetchEpisodes}
          disabled={isLoading}
        >
          更新
        </button>
      </section>
    </div>
  );
}
