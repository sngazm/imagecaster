import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ClipDetail, ClipDraft, ClipLayoutName, ClipPostTarget } from "../lib/api";
import { GlyphTable } from "../lib/clipGlyphs";
import type { ClipMetrics } from "../lib/clipGlyphs";
import metricsJson from "../lib/clip-metrics.json";
import { draftProblems } from "../lib/clipEdits";
import { buildTimeline, placeSubs, subAt, toTau } from "../lib/clipTimeline";
import { ClipAudioPool } from "../lib/clipAudio";
import {
  CLIP_LAYOUT_LABEL,
  CLIP_LAYOUT_NAMES,
  CLIP_MANUAL_TARGETS,
  CLIP_POST_LABEL,
  CLIP_POST_MAX_ATTEMPTS,
  CLIP_POST_TARGETS,
  CLIP_STATUS,
} from "../lib/clipStatus";
import { ClipStage } from "../components/clip/ClipStage";
import { ClipTimeline } from "../components/clip/ClipTimeline";
import { ClipSubList } from "../components/clip/ClipSubList";
import { DateTimePicker } from "../components/DateTimePicker";

/**
 * 切り抜きを、動画にする前に確かめて直す。
 *
 * 切り抜きは、離れた区間を AI が選んで並べ、繋いだもの。音はエピソードの mp3 から要る
 * 範囲だけを取って、ここで本番と同じ規則で繋ぐ（clipAudio）。字幕と画像は、動画を描く側と
 * 同じ式で canvas に置く。だからここで見えたものが、縦・横・正方形のどれで描いてもそのまま出る。
 * 直したものはその場で保存し、OK を出すと手元の道具が拾って描く。
 *
 * 仕様は docs/clip-viewer-spec.md を参照。
 */

const table = new GlyphTable(metricsJson as unknown as ClipMetrics);

const SPEEDS = [1, 1.1, 1.2, 1.3, 1.5];

/** 保存を待つ時間。打っている最中に 1 字ごとに送らない */
const SAVE_DELAY_MS = 800;

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ClipViewer() {
  const { id: episodeId, clipId } = useParams<{ id: string; clipId: string }>();
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [draft, setDraft] = useState<ClipDraft | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!episodeId || !clipId) return;
    try {
      const [c, d, ep] = await Promise.all([
        api.getClip(episodeId, clipId),
        api.getClipDraft(episodeId, clipId),
        api.getEpisode(episodeId),
      ]);
      setClip(c);
      setDraft(d);
      setAudioUrl(ep.audioUrl || null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [episodeId, clipId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="p-6 text-secondary">読み込み中…</div>;
  if (error && !clip) return <div className="p-6 text-error">{error}</div>;
  if (!clip || !episodeId || !clipId) return null;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3 pr-20">
        <Link to={`/episodes/${episodeId}`} className="btn btn-ghost">
          ← エピソードへ
        </Link>
        <h1 className="flex-1 text-lg font-semibold">{clip.label}</h1>
        <span className={CLIP_STATUS[clip.status].badgeClass}>{CLIP_STATUS[clip.status].label}</span>
      </div>

      {draft && audioUrl ? (
        <Editor
          episodeId={episodeId}
          clip={clip}
          initial={draft}
          audioUrl={audioUrl}
          onClip={setClip}
          onReload={load}
        />
      ) : draft ? (
        <p className="text-sm text-error">この回の音声が見つかりません。</p>
      ) : (
        <p className="mb-4 text-sm text-secondary">
          下書きの仕組みより前に作られた切り抜きです。再生はできますが、ここでは直せません。
        </p>
      )}

      {clip.latest > 0 && <Rendered clip={clip} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EditorProps {
  episodeId: string;
  clip: ClipDetail;
  initial: ClipDraft;
  audioUrl: string;
  onClip: (clip: ClipDetail) => void;
  onReload: () => Promise<void>;
}

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

function Editor({ episodeId, clip, initial, audioUrl, onClip, onReload }: EditorProps) {
  const [draft, setDraft] = useState(initial);
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState<ClipLayoutName>("portrait");
  const [showGuides, setShowGuides] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saving = useRef(false);

  const editable = clip.status === "draft";

  // 読み込み直したら（ほかの画面の保存を取り込んだら）手元の下書きも入れ替える
  useEffect(() => {
    setDraft(initial);
    setSave("saved");
  }, [initial]);

  // --- 音 -------------------------------------------------------------------
  //
  // 時計は「繋いだあとの秒」。audio 要素が鳴らすのは繋いだ波形なので、currentTime が
  // そのままその時刻になる。速さは playbackRate で変える（ブラウザが音程を保つ）

  const timeline = useMemo(() => buildTimeline(draft), [draft]);
  const placement = useMemo(() => placeSubs(draft, timeline), [draft, timeline]);
  const live = useRef({ timeline, placement });
  live.current = { timeline, placement };

  const [pool, setPool] = useState<ClipAudioPool | null>(null);
  const [audioState, setAudioState] = useState("音声を読み込み中…");
  const [wavUrl, setWavUrl] = useState<string | null>(null);

  // pool の波形は一度だけ取る。端は pool の中でしか動かないので、取り直しは要らない
  const poolKey = JSON.stringify([draft.pool, draft.audio, audioUrl]);
  useEffect(() => {
    const abort = new AbortController();
    setPool(null);
    (async () => {
      try {
        const next = new ClipAudioPool(draftRef.current.audio, audioUrl);
        await next.load(draftRef.current.pool, abort.signal, (done, total) =>
          setAudioState(`音声を読み込み中… ${done}/${total}`)
        );
        setPool(next);
        setAudioState("");
      } catch (e) {
        if (!abort.signal.aborted) setAudioState(e instanceof Error ? e.message : "音声を読めませんでした");
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

  // 繋ぎ方が変わったら繋ぎ直す。字幕の文字を直しただけでは変わらない
  const spliceKey = JSON.stringify([draft.spans, draft.gap, draft.edgeFade]);
  useEffect(() => {
    if (!pool) return;
    const url = URL.createObjectURL(pool.splice(draftRef.current, live.current.timeline, table.metrics.timing.fade));
    setWavUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, spliceKey]);

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const seek = useCallback((tau: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, tau);
  }, []);

  const seekSource = useCallback(
    (t: number) => {
      const tau = toTau(live.current.timeline, t);
      if (tau !== null) seek(tau);
    },
    [seek]
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !wavUrl) return;
    if (!audio.paused) return audio.pause();
    if (audio.ended || audio.currentTime >= live.current.timeline.duration - 0.05) audio.currentTime = 0;
    audio.play();
  };

  // 繋ぎ直すと src が替わって頭に戻る。直したところをすぐ聞き直せるよう、位置と速さを戻す
  const resumeAt = useRef(0);
  const onLoaded = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = draftRef.current.speed;
    audio.currentTime = Math.min(resumeAt.current, Math.max(0, audio.duration - 0.05));
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = draft.speed;
  }, [draft.speed]);

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    resumeAt.current = audio.currentTime;
    const placed = subAt(live.current.placement.shown, audio.currentTime, table.metrics.timing.subHold);
    setCurrentId(placed?.sub.id ?? null);
  };

  // --- 保存 -----------------------------------------------------------------

  const change = (next: ClipDraft) => {
    setDraft(next);
    setSave("dirty");
  };

  useEffect(() => {
    if (save !== "dirty") return;
    const timer = setTimeout(async () => {
      // 前の保存が返る前に次を送ると、古い revision を添えることになり、自分の保存と
      // 食い違って弾かれる。返ってきたら revision が進んで、ここがもう一度回る
      if (saving.current) return;
      saving.current = true;
      const sending = draftRef.current;
      setSave("saving");
      try {
        const saved = await api.saveClipDraft(episodeId, clip.id, sending);
        // 送っている間にも打たれているかもしれない。中身は手元のものを残し、
        // revision だけ進める
        const edited = draftRef.current !== sending;
        setDraft((d) => ({ ...d, revision: saved.revision }));
        setSave(edited ? "dirty" : "saved");
        setSaveError(null);
      } catch (e) {
        const message = e instanceof Error ? e.message : "保存できませんでした";
        setSaveError(message);
        setSave(message.includes("ほかの画面") ? "conflict" : "error");
      } finally {
        saving.current = false;
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [save, draft, episodeId, clip.id]);

  const problems = useMemo(() => draftProblems(draft, table), [draft]);
  // 本編のあとに、サムネイルとエピソード名のカードが付く。投稿先の上限に効くのは全体の長さ
  const seconds = (timeline.duration + table.metrics.timing.endCard) / draft.speed;

  return (
    <>
      <audio
        ref={audioRef}
        src={wavUrl ?? undefined}
        preload="auto"
        onLoadedMetadata={onLoaded}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-[var(--color-border)]">
          {CLIP_LAYOUT_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setLayoutName(name)}
              className={`px-3 py-1 text-sm ${
                name === layoutName ? "bg-[var(--color-bg-active)]" : "text-secondary"
              }`}
            >
              {CLIP_LAYOUT_LABEL[name]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-sm text-secondary">
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
          ガイド線
        </label>
        <span className="ml-auto text-xs text-secondary">
          <SaveBadge state={save} />
        </span>
      </div>

      {/* 縦は画面いっぱいにすると字幕リストが見えなくなるので、幅を抑える */}
      <div className="mx-auto mb-3" style={{ maxWidth: layoutName === "portrait" ? 300 : layoutName === "square" ? 420 : undefined }}>
        <ClipStage
          draft={draft}
          timeline={timeline}
          shown={placement.shown}
          table={table}
          layoutName={layoutName}
          getTime={getTime}
          showGuides={showGuides}
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary px-4" disabled={!wavUrl} onClick={toggle}>
          {playing ? "止める" : "再生"}
        </button>
        {audioState && <span className="text-xs text-secondary">{audioState}</span>}
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-secondary">
          速さ
          <select
            className="input py-1"
            value={draft.speed}
            disabled={!editable}
            onChange={(e) => change({ ...draft, speed: Number(e.target.value) })}
          >
            {[...new Set([...SPEEDS, draft.speed])].sort().map((s) => (
              <option key={s} value={s}>
                {s} 倍
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-secondary">動画の長さ {Math.round(seconds)} 秒</span>
      </div>

      <div className="mb-4">
        <ClipTimeline
          timeline={timeline}
          shown={placement.shown}
          currentId={currentId}
          getTime={getTime}
          onSeek={seek}
        />
      </div>

      {save === "conflict" && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="flex-1 text-error">{saveError}</span>
          <button type="button" className="btn btn-secondary" onClick={onReload}>
            読み込み直す
          </button>
        </div>
      )}
      {save === "error" && <p className="mb-4 text-sm text-error">{saveError}</p>}

      <Cards
        draft={draft}
        editable={editable}
        inside={(t) => toTau(timeline, t) !== null}
        getSourceTime={() => {
          // いま鳴っているところの、元の音声での時刻。間の中なら、手前の区間の終わり
          const tau = getTime();
          const p = [...timeline.pieces].reverse().find((x) => tau >= x.tau);
          return p ? Math.min(p.span.end, p.span.start + (tau - p.tau)) : draft.spans[0].start;
        }}
        onChange={change}
        onSeek={seekSource}
      />

      <div className="mb-4">
        <ClipSubList
          draft={draft}
          table={table}
          problems={problems}
          currentId={currentId}
          disabled={!editable}
          onChange={change}
          onSeekSource={seekSource}
        />
      </div>

      <Approval
        episodeId={episodeId}
        clip={clip}
        blocked={
          save !== "saved"
            ? "保存が済んでから OK を出せます"
            : problems.length > 0
              ? `直すところが ${problems.length} 件あります`
              : null
        }
        onClip={onClip}
      />
    </>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const text: Record<SaveState, string> = {
    saved: "保存済み",
    dirty: "未保存…",
    saving: "保存中…",
    conflict: "保存できません",
    error: "保存できません",
  };
  return <span className={state === "conflict" || state === "error" ? "text-error" : ""}>{text[state]}</span>;
}

// ---------------------------------------------------------------------------

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 画面中央に出す画像。出す時刻を動かすか、外すかだけ。選び直すのは手元の仕事 */
function Cards({
  draft,
  editable,
  inside,
  getSourceTime,
  onChange,
  onSeek,
}: {
  draft: ClipDraft;
  editable: boolean;
  /** その時刻（元の音声の上の秒）が、鳴らす区間に入っているか */
  inside: (t: number) => boolean;
  getSourceTime: () => number;
  onChange: (d: ClipDraft) => void;
  onSeek: (t: number) => void;
}) {
  if (draft.cards.length === 0) return null;
  const setCards = (cards: ClipDraft["cards"]) =>
    onChange({ ...draft, cards: [...cards].sort((a, b) => a.at - b.at) });

  return (
    <div className="mb-4">
      <h2 className="label mb-2">画像</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {draft.cards.map((card, i) => {
          const outside = !inside(card.at);
          return (
            <div key={`${card.image}-${i}`} className="card w-36 shrink-0 p-2" style={{ opacity: outside ? 0.4 : 1 }}>
              <button type="button" className="block w-full" onClick={() => onSeek(card.at)}>
                <img src={card.image} alt={card.word} className="h-20 w-full rounded bg-white object-contain" />
              </button>
              <div className="mt-1 truncate text-xs">{card.word}</div>
              <div className="text-xs tabular-nums text-secondary">
                {formatTime(card.at)}
                {outside && "（区間の外）"}
              </div>
              {editable && (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost flex-1 px-1 py-0.5 text-xs"
                    title="いまの再生位置で出す"
                    onClick={() => setCards(draft.cards.map((c, j) => (j === i ? { ...c, at: getSourceTime() } : c)))}
                  >
                    ここで出す
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-1 py-0.5 text-xs"
                    onClick={() => setCards(draft.cards.filter((_, j) => j !== i))}
                  >
                    外す
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Approval({
  episodeId,
  clip,
  blocked,
  onClip,
}: {
  episodeId: string;
  clip: ClipDetail;
  blocked: string | null;
  onClip: (clip: ClipDetail) => void;
}) {
  const [publishAt, setPublishAt] = useState(toLocalInput(clip.publishAt));
  const [postText, setPostText] = useState(clip.postText);
  const [posts, setPosts] = useState(clip.posts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (status: "draft" | "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      const plan =
        status === "approved"
          ? {
              publishAt: publishAt ? new Date(publishAt).toISOString() : null,
              postText,
              posts: Object.fromEntries(
                CLIP_POST_TARGETS.map((t) => [t, { enabled: posts[t].enabled, layout: posts[t].layout }])
              ),
            }
          : undefined;
      onClip({ ...(await api.setClipStatus(episodeId, clip.id, status, plan)), baseUrl: clip.baseUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const setPost = (t: ClipPostTarget, change: Partial<{ enabled: boolean; layout: ClipLayoutName }>) =>
    setPosts((p) => ({ ...p, [t]: { ...p[t], ...change } }));

  if (clip.status === "published") {
    return <Posts episodeId={episodeId} clip={clip} onClip={onClip} />;
  }

  if (clip.status !== "draft") {
    return (
      <div className="card mb-4 space-y-3 p-4">
        <p className="text-sm">
          {clip.status === "approved" && "OK を出しました。手元の道具が拾って描きます（1 時間おきに見にきます）。"}
          {clip.status === "rendered" &&
            (clip.publishAt
              ? `描き終わりました。${new Date(clip.publishAt).toLocaleString("ja-JP")} に投稿します。`
              : "描き終わりました。投稿の予定はありません。")}
          {clip.status === "rejected" && "ボツにしました。"}
        </p>
        {clip.status === "rendered" && <Posts episodeId={episodeId} clip={clip} onClip={onClip} />}
        {error && <p className="text-sm text-error">{error}</p>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => send("draft")}>
          {clip.status === "rejected" ? "下書きに戻す" : "OK を取り消して直す"}
        </button>
      </div>
    );
  }

  return (
    <div className="card mb-4 space-y-4 p-4">
      <div>
        <label className="label mb-1 block">投稿する日時（空なら描くだけ）</label>
        <DateTimePicker value={publishAt} onChange={setPublishAt} />
      </div>
      <div>
        <label className="label mb-1 block">本文</label>
        <textarea className="input w-full text-sm" rows={3} value={postText} onChange={(e) => setPostText(e.target.value)} />
      </div>
      <div className="space-y-2">
        <span className="label block">投稿先</span>
        {CLIP_POST_TARGETS.map((t) => (
          <div key={t} className="flex items-center gap-3 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={posts[t].enabled} onChange={(e) => setPost(t, { enabled: e.target.checked })} />
              {CLIP_POST_LABEL[t]}
              {CLIP_MANUAL_TARGETS.includes(t) && <span className="text-xs text-secondary">（手で出す）</span>}
            </label>
            <select
              className="input py-1"
              value={posts[t].layout}
              disabled={!posts[t].enabled}
              onChange={(e) => setPost(t, { layout: e.target.value as ClipLayoutName })}
            >
              {CLIP_LAYOUT_NAMES.map((l) => (
                <option key={l} value={l}>
                  {CLIP_LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {(blocked || error) && <p className="text-sm text-error">{error ?? blocked}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => send("rejected")}>
          ボツ
        </button>
        <button type="button" className="btn btn-primary px-6" disabled={busy || blocked !== null} onClick={() => send("approved")}>
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * 投稿先ごとの様子。出たものは結果を、手で出すものは材料（動画と本文）を並べて、出したら
 * 印を付けてもらう。Cron が出すものは待つだけで、失敗して諦めたものだけやり直しを頼める。
 */
function Posts({
  episodeId,
  clip,
  onClip,
}: {
  episodeId: string;
  clip: ClipDetail;
  onClip: (clip: ClipDetail) => void;
}) {
  const [urls, setUrls] = useState<Partial<Record<ClipPostTarget, string>>>({});
  const [busy, setBusy] = useState<ClipPostTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const targets = CLIP_POST_TARGETS.filter((t) => clip.posts[t].enabled);
  if (targets.length === 0) return null;

  const mark = async (target: ClipPostTarget, body: Parameters<typeof api.markClipPost>[3]) => {
    setBusy(target);
    setError(null);
    try {
      onClip({ ...(await api.markClipPost(episodeId, clip.id, target, body)), baseUrl: clip.baseUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更できませんでした");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(clip.postText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasManual = targets.some((t) => CLIP_MANUAL_TARGETS.includes(t) && !clip.posts[t].postedAt);

  return (
    <div className="space-y-3">
      {hasManual && clip.postText && (
        <div className="rounded border border-[var(--color-border)] p-3 text-sm">
          <p className="whitespace-pre-wrap">{clip.postText}</p>
          <button type="button" className="btn btn-ghost mt-2 px-2 py-1 text-xs" onClick={copy}>
            {copied ? "コピーしました" : "本文をコピー"}
          </button>
        </div>
      )}

      <ul className="divide-y divide-[var(--color-border)] text-sm">
        {targets.map((t) => {
          const post = clip.posts[t];
          const manual = CLIP_MANUAL_TARGETS.includes(t);
          const gaveUp = !manual && !post.postedAt && (post.attempts ?? 0) >= CLIP_POST_MAX_ATTEMPTS;
          return (
            <li key={t} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-32 shrink-0">{CLIP_POST_LABEL[t]}</span>

              {post.postedAt ? (
                post.url ? (
                  <a href={post.url} target="_blank" rel="noreferrer" className="underline">
                    投稿を見る
                  </a>
                ) : (
                  <span className="text-secondary">出しました</span>
                )
              ) : manual ? (
                <>
                  <a
                    href={`${clip.baseUrl}/v${clip.latest}/${post.layout}.mp4`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost px-2 py-1 text-xs"
                  >
                    動画を開く（{CLIP_LAYOUT_LABEL[post.layout]}）
                  </a>
                  <input
                    // スマホでは横に並べると潰れる。下の段に回す
                    className="input order-last min-w-0 basis-full py-1 text-xs sm:order-none sm:flex-1 sm:basis-0"
                    placeholder="出した先の URL（無くてもよい）"
                    value={urls[t] ?? ""}
                    onChange={(e) => setUrls((u) => ({ ...u, [t]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary px-3 py-1 text-xs"
                    disabled={busy === t}
                    onClick={() => mark(t, { action: "done", url: urls[t]?.trim() || undefined })}
                  >
                    出した
                  </button>
                </>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 ${post.error ? "text-error" : "text-secondary"}`}>
                    {post.error
                      ? `${post.error}（${post.attempts ?? 0}/${CLIP_POST_MAX_ATTEMPTS} 回）`
                      : clip.publishAt
                        ? "時刻になったら出します"
                        : "投稿の予定がありません"}
                  </span>
                  {gaveUp && (
                    <button
                      type="button"
                      className="btn btn-secondary px-3 py-1 text-xs"
                      disabled={busy === t}
                      onClick={() => mark(t, { action: "retry" })}
                    >
                      もう一度試す
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** 描いた動画。版とレイアウトを切り替えて見る */
function Rendered({ clip }: { clip: ClipDetail }) {
  const [n, setN] = useState(clip.latest);
  const version = clip.versions.find((v) => v.n === n) ?? clip.versions[clip.versions.length - 1];
  const layouts = version?.layouts ?? [];
  const [layoutName, setLayoutName] = useState<ClipLayoutName>(layouts[0] ?? "portrait");

  useEffect(() => setN(clip.latest), [clip.latest]);
  if (!version) return null;

  // 下書きより前の版は clip.mp4 が 1 本あるだけ
  const file = layouts.length ? `${layouts.includes(layoutName) ? layoutName : layouts[0]}.mp4` : "clip.mp4";

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="label flex-1">描いた動画</h2>
        {layouts.length > 1 &&
          layouts.map((l) => (
            <button
              key={l}
              type="button"
              className={`btn btn-ghost px-2 py-1 text-xs ${l === layoutName ? "bg-[var(--color-bg-active)]" : ""}`}
              onClick={() => setLayoutName(l)}
            >
              {CLIP_LAYOUT_LABEL[l]}
            </button>
          ))}
        {clip.versions.length > 1 && (
          <select className="input py-1 text-sm" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {clip.versions.map((v) => (
              <option key={v.n} value={v.n}>
                v{v.n}
                {v.n === clip.latest ? "（最新）" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <video
        key={`${version.n}-${file}`}
        src={`${clip.baseUrl}/v${version.n}/${file}`}
        controls
        playsInline
        className="mx-auto max-h-[70vh] rounded bg-black"
      />
    </div>
  );
}
