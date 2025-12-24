import { useState, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, uploadToR2, getAudioDuration } from "../lib/api";

type SubmitStatus = "idle" | "creating" | "uploading" | "completing" | "done" | "error";

export default function EpisodeNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
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
      // 1. エピソード作成
      setStatus("creating");
      setMessage("エピソードを作成中...");

      const episode = await api.createEpisode({
        title: title.trim(),
        publishAt: new Date().toISOString(),
        skipTranscription: true,
      });

      // 2. Presigned URL 取得
      setStatus("uploading");
      setMessage("音声をアップロード中...");

      const { uploadUrl } = await api.getUploadUrl(
        episode.id,
        file.type || "audio/mpeg",
        file.size
      );

      // 3. R2 にアップロード
      await uploadToR2(uploadUrl, file);

      // 4. 完了通知
      setStatus("completing");
      setMessage("処理を完了中...");

      const duration = await getAudioDuration(file);
      await api.completeUpload(episode.id, duration, file.size);

      // 完了
      setStatus("done");
      setMessage(`エピソード "${title}" を登録しました`);

      // 2秒後に一覧へ遷移
      setTimeout(() => {
        navigate("/");
      }, 2000);

    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  const isSubmitting = status === "creating" || status === "uploading" || status === "completing";

  return (
    <div className="container">
      <header className="page-header">
        <h1>新規エピソード登録</h1>
        <Link to="/" className="button secondary">
          一覧に戻る
        </Link>
      </header>

      <section className="section">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">タイトル</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="エピソードのタイトル"
              disabled={isSubmitting || status === "done"}
            />
          </div>

          <div className="form-group">
            <label htmlFor="audio">音声ファイル</label>
            <input
              type="file"
              id="audio"
              accept="audio/*"
              onChange={handleFileChange}
              disabled={isSubmitting || status === "done"}
            />
          </div>

          <button type="submit" className="button primary" disabled={isSubmitting || status === "done"}>
            {isSubmitting ? "処理中..." : "登録"}
          </button>
        </form>

        {(status === "creating" || status === "uploading" || status === "completing") && (
          <div className="progress">{message}</div>
        )}

        {status === "done" && (
          <div className="success">
            {message}
            <br />
            <small>一覧ページへ移動します...</small>
          </div>
        )}

        {status === "error" && <div className="error">{message}</div>}
      </section>
    </div>
  );
}
