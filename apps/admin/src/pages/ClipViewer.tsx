import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type {
  ClipDetail,
  ClipRequestItem,
  ClipStatus,
  ClipSubtitle,
} from "../lib/api";

/**
 * 切り抜き動画ビューワー。
 *
 * 出来たものを見て、字幕の直しを指示し、作り直させる。ここでは字幕を直接
 * 書き換えない。字幕は音のタイムスタンプに紐づいているので、文字だけ差し替えると
 * 音とずれる。指示として預け、読んで区切りを決め直すのは作り直す側の仕事。
 *
 * 仕様は docs/clip-viewer-spec.md を参照。
 */

const STATUS_CONFIG: Record<ClipStatus, { label: string; badgeClass: string }> = {
  draft: { label: "確認待ち", badgeClass: "badge badge-default" },
  approved: { label: "OK", badgeClass: "badge badge-success" },
  rejected: { label: "ボツ", badgeClass: "badge badge-error" },
};

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 指示を人が読める一行にする */
function describeItem(item: ClipRequestItem, subs: ClipSubtitle[]): string {
  const textOf = (i: number) => subs.find((s) => s.index === i)?.rows.join("") ?? `#${i}`;
  switch (item.type) {
    case "edit":
      return `「${textOf(item.index)}」→「${item.text}」`;
    case "note":
      return `「${textOf(item.index)}」に: ${item.text}`;
    case "delete":
      return `「${textOf(item.index)}」を削除`;
    case "insert":
      return `「${textOf(item.afterIndex)}」の後に「${item.text}」を追加`;
  }
}

export function ClipViewer() {
  const { id: episodeId, clipId } = useParams<{ id: string; clipId: string }>();

  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [subs, setSubs] = useState<ClipSubtitle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // まだ送っていない指示。溜めてからまとめて送る
  const [items, setItems] = useState<ClipRequestItem[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!episodeId || !clipId) return;
    setLoading(true);
    api
      .getClip(episodeId, clipId)
      .then((c) => {
        setClip(c);
        setVersion(c.latest);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [episodeId, clipId]);

  useEffect(() => {
    if (!episodeId || !clipId || version === null) return;
    api
      .getClipSubtitles(episodeId, clipId, version)
      .then(setSubs)
      // 字幕が無くても動画は見られる。ここで画面を落とさない
      .catch(() => setSubs([]));
  }, [episodeId, clipId, version]);

  const duration = clip?.clip.duration ?? 0;
  const videoUrl = clip && version !== null ? `${clip.baseUrl}/v${version}/clip.mp4` : "";

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    void v.play();
  }, []);

  const currentIndex = useMemo(
    () => subs.find((s) => now >= s.start && now <= s.end)?.index ?? null,
    [subs, now]
  );

  const addItem = (item: ClipRequestItem) => {
    setItems((prev) => [...prev, item]);
    setEditing(null);
    setDraft("");
  };

  const send = async () => {
    if (!episodeId || !clipId || version === null || items.length === 0) return;
    setSending(true);
    try {
      await api.postClipRequest(episodeId, clipId, version, items);
      setItems([]);
      const fresh = await api.getClip(episodeId, clipId);
      setClip(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "指示を送れませんでした");
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: ClipStatus) => {
    if (!episodeId || !clipId) return;
    try {
      const updated = await api.setClipStatus(episodeId, clipId, status);
      setClip((prev) => (prev ? { ...prev, status: updated.status } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "状態を変えられませんでした");
    }
  };

  if (loading) return <div className="p-6 text-secondary">読み込み中…</div>;
  if (error && !clip) return <div className="p-6 text-error">{error}</div>;
  if (!clip) return null;

  const pending = clip.requests.filter((r) => r.appliedIn === null);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/episodes/${episodeId}`} className="btn btn-ghost">
          ← エピソードへ
        </Link>
        <h1 className="flex-1 text-lg font-semibold">{clip.label}</h1>
        <span className={STATUS_CONFIG[clip.status].badgeClass}>
          {STATUS_CONFIG[clip.status].label}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
        <span>
          {clip.range[0]} 〜 {clip.range[1]}
        </span>
        <span>／ {Math.round(duration)} 秒</span>
        {clip.versions.length > 1 && (
          <label className="ml-auto flex items-center gap-2">
            版
            <select
              className="input py-1"
              value={version ?? clip.latest}
              onChange={(e) => setVersion(Number(e.target.value))}
            >
              {clip.versions.map((v) => (
                <option key={v.n} value={v.n}>
                  v{v.n}
                  {v.n === clip.latest ? "（最新）" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <video
        ref={videoRef}
        src={videoUrl}
        controls
        playsInline
        className="mb-3 w-full rounded bg-black"
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
      />

      {/* シークバーの上に字幕の区間を並べる。押すとその時刻へ飛ぶ */}
      <div className="mb-4">
        <div className="relative h-7 w-full overflow-hidden rounded bg-[var(--color-bg-hover)]">
          {subs.map((s) => {
            const left = duration ? (s.start / duration) * 100 : 0;
            const width = duration ? ((s.end - s.start) / duration) * 100 : 0;
            const removed = items.some(
              (i) => i.type === "delete" && i.index === s.index
            );
            const touched = items.some(
              (i) => "index" in i && i.index === s.index && i.type !== "delete"
            );
            return (
              <button
                key={s.index}
                type="button"
                title={s.rows.join(" ")}
                onClick={() => seek(s.start)}
                className="absolute top-0 h-full border-r border-white/40 transition-opacity hover:opacity-100"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.4)}%`,
                  background: removed
                    ? "var(--color-error)"
                    : touched
                      ? "var(--color-warning)"
                      : "var(--color-accent)",
                  opacity: s.index === currentIndex ? 1 : 0.45,
                }}
              />
            );
          })}
        </div>
        <p className="mt-1 text-xs text-secondary">
          帯 = 字幕 1 枚。押すとその場面へ飛びます
        </p>
      </div>

      {/* 字幕一覧 */}
      <div className="card mb-4 divide-y divide-[var(--color-border)]">
        {subs.length === 0 && (
          <p className="p-4 text-sm text-secondary">
            この版の字幕データがまだありません。
          </p>
        )}
        {subs.map((s) => {
          const removed = items.some(
            (i) => i.type === "delete" && i.index === s.index
          );
          return (
            <div key={s.index} className="p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => seek(s.start)}
                  className="shrink-0 text-xs text-secondary tabular-nums hover:underline"
                >
                  {formatTime(s.start)}
                </button>
                <div
                  className={`flex-1 text-sm ${removed ? "line-through opacity-50" : ""} ${
                    s.index === currentIndex ? "font-semibold" : ""
                  }`}
                >
                  {s.rows.map((r, i) => (
                    <div key={i}>{r}</div>
                  ))}
                  <span className="text-xs text-secondary">{s.speaker}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    onClick={() => {
                      setEditing(s.index);
                      setDraft("");
                    }}
                  >
                    直す
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    onClick={() => addItem({ type: "delete", index: s.index })}
                  >
                    削除
                  </button>
                </div>
              </div>

              {editing === s.index && (
                <div className="mt-2 space-y-2">
                  <textarea
                    className="input w-full text-sm"
                    rows={2}
                    autoFocus
                    placeholder="直した文字、または「区切りを前に寄せて」のような指示"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary px-3 py-1 text-xs"
                      disabled={!draft.trim()}
                      onClick={() =>
                        addItem({ type: "edit", index: s.index, text: draft.trim() })
                      }
                    >
                      この文字に直す
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary px-3 py-1 text-xs"
                      disabled={!draft.trim()}
                      onClick={() =>
                        addItem({ type: "note", index: s.index, text: draft.trim() })
                      }
                    >
                      指示として伝える
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() =>
                        addItem({
                          type: "insert",
                          afterIndex: s.index,
                          text: draft.trim(),
                        })
                      }
                      disabled={!draft.trim()}
                    >
                      この後に追加
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1 text-xs"
                      onClick={() => setEditing(null)}
                    >
                      やめる
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 溜めた指示 */}
      {items.length > 0 && (
        <div className="card mb-4 p-4">
          <h2 className="mb-2 text-sm font-semibold">送る指示（{items.length} 件）</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="flex-1">{describeItem(item, subs)}</span>
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-0 text-xs"
                  onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                >
                  取消
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending}
            onClick={send}
          >
            {sending ? "送っています…" : "作り直しを頼む"}
          </button>
          <p className="mt-2 text-xs text-secondary">
            指示を預けます。実際の作り直しは手元の道具が引き取り、v
            {(clip.latest ?? 0) + 1} として上がってきます。
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card mb-4 p-4">
          <h2 className="mb-1 text-sm font-semibold">作り直し待ち</h2>
          <p className="text-sm text-secondary">
            {pending.length} 件の指示を預かっています。手元が拾うと新しい版が増えます。
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setStatus("approved")}
          disabled={clip.status === "approved"}
        >
          OK
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setStatus("rejected")}
          disabled={clip.status === "rejected"}
        >
          ボツ
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </div>
  );
}
