import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type {
  EpisodeDetail,
  RawSegment,
  TruthRange,
  TruthSegment,
} from "../lib/api";

/**
 * 正解データ作成エディタ。
 *
 * 話者分離のロジックを推測で積み上げるのをやめるために作った。人が「これが
 * 正解」を一度示せば、あとはそれとの差で測れる。直した結果は
 * `transcript.truth.json` に入り、公開しているものには一切触らない。
 *
 * 見た目は DAW に寄せている。横が時間、縦が話者。誰がいつ喋ったかは音声を
 * 聞きながら直すものなので、行が縦に並ぶ形だと見比べられない。
 */

/** 拡大率の段。1 秒を何ピクセルで描くか */
const ZOOM_STEPS = [4, 8, 16, 32, 64, 128, 256];
const DEFAULT_ZOOM = 3;

/** 未割当を表す内部の値。話者名に空文字は使えないので別に持つ */
const UNASSIGNED = " unassigned";

/** トラックの高さと、話者名の欄の幅 */
const LANE_HEIGHT = 72;
const LABEL_WIDTH = 112;

/** 端をつまむ幅 */
const HANDLE_PX = 6;

/** 波形の刻み。levels.json と揃える */
const LEVEL_FRAME_SEC = 0.05;

/** 端をつまんで動かしている最中の状態 */
interface Dragging {
  index: number;
  edge: "start" | "end";
  originX: number;
  originTime: number;
}

function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

function toTruth(segments: RawSegment[]): TruthSegment[] {
  return segments
    .map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker ?? null,
    }))
    .sort((a, b) => a.start - b.start);
}

/** 話者名 → 0〜255 に丸めた音量の並び */
type Levels = Record<string, Uint8Array>;

function decodeLevels(raw: Record<string, string>): Levels {
  const out: Levels = {};

  for (const [name, encoded] of Object.entries(raw)) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    out[name] = bytes;
  }

  return out;
}

/**
 * そのトラックの波形を描く。
 *
 * 音量そのものを出す。話者判定はこの数字を見て決めているので、間違っている
 * ところを人が見るときも同じものが見えているのが早い。
 */
function Waveform({
  levels,
  duration,
  pxPerSec,
  height,
}: {
  levels: Uint8Array;
  duration: number;
  pxPerSec: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const width = Math.ceil(duration * pxPerSec);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    // 幅が広すぎるとキャンバスの上限に当たるので、実描画は間引く
    const drawWidth = Math.min(width, 16000);
    canvas.width = drawWidth * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, drawWidth, height);
    ctx.fillStyle = "rgba(120, 140, 170, 0.45)";

    const secPerPx = duration / drawWidth;

    for (let x = 0; x < drawWidth; x++) {
      const from = Math.floor((x * secPerPx) / LEVEL_FRAME_SEC);
      const to = Math.max(from + 1, Math.floor(((x + 1) * secPerPx) / LEVEL_FRAME_SEC));

      let peak = 0;
      for (let i = from; i < to && i < levels.length; i++) {
        if (levels[i] > peak) peak = levels[i];
      }

      if (peak === 0) continue;

      const h = (peak / 255) * height;
      ctx.fillRect(x, (height - h) / 2, 1, h);
    }
  }, [levels, duration, width, height]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full"
      style={{ width }}
    />
  );
}

export function TranscriptTruth() {
  const { id } = useParams<{ id: string }>();

  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [segments, setSegments] = useState<TruthSegment[]>([]);
  const [levels, setLevels] = useState<Levels>({});
  const [source, setSource] = useState<"truth" | "raw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [selected, setSelected] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  /**
   * いま作業している範囲。
   *
   * 76 分を一度に直すのは無理なので、区間を決めて少しずつ確かめる。確かめた
   * 範囲は保存し、採点する側はそこだけを見る。範囲を記録しないと、まだ見て
   * いない箇所の食い違いを間違いとして数えてしまう。
   */
  const [range, setRange] = useState<TruthRange | null>(null);
  const [verified, setVerified] = useState<TruthRange[]>([]);
  const [loop, setLoop] = useState(true);
  const [selecting, setSelecting] = useState<number | null>(null);

  /**
   * 取り消し用の履歴。
   *
   * 話者を変える・分割する・端を動かすは、間違えたときに戻せないと怖くて
   * 触れない。正解を作る作業は試しながら進むものなので、戻せることが要る。
   */
  const history = useRef<TruthSegment[][]>([]);
  const [canUndo, setCanUndo] = useState(false);

  /**
   * 音声要素は state で持つ。
   *
   * ref にしていたら再生位置のバーが動かなかった。読み込み中は早期 return で
   * <audio> がまだ描かれておらず、イベントを繋ぐ処理が「要素が無い」状態で
   * 走って何もしないまま終わっていた。state なら要素が付いた時点で走る。
   */
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pxPerSec = ZOOM_STEPS[zoom];

  // ---- 読み込み ----

  useEffect(() => {
    if (!id) return;
    let alive = true;

    (async () => {
      try {
        const detail = await api.getEpisode(id);
        if (!alive) return;
        setEpisode(detail);

        const truth = await api.getTruth(id);
        if (!alive) return;

        if (truth.exists && truth.segments.length > 0) {
          setSegments(toTruth(truth.segments));
          setSource("truth");
          setVerified(truth.ranges ?? []);
        } else if (detail.transcriptRawUrl) {
          // 正解がまだ無いので、Whisper の生出力から始める
          const response = await fetch(detail.transcriptRawUrl);
          if (!response.ok) throw new Error(`生データを読めません（HTTP ${response.status}）`);

          const raw = (await response.json()) as { segments?: RawSegment[] };
          if (!alive) return;

          setSegments(toTruth(raw.segments ?? []));
          setSource("raw");
        } else {
          setError("生データがありません。文字起こしを先に走らせてください");
        }

        // 波形。無くても編集はできるので、失敗しても黙って進む
        if (detail.levelsUrl) {
          try {
            const response = await fetch(detail.levelsUrl);
            if (response.ok) {
              const data = (await response.json()) as {
                tracks?: Record<string, string>;
              };
              if (alive && data.tracks) setLevels(decodeLevels(data.tracks));
            }
          } catch {
            // 波形が出ないだけ
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  // ---- トラック（話者）の一覧 ----

  const lanes = useMemo(() => {
    // その回の出演者を先に並べる。喋っていない人のトラックも出したいので、
    // 割り当て設定を優先し、文字起こしに出てくる名前を足す
    const assigned = (episode?.speakerTracks ?? [])
      .map((t) => t.label)
      .filter((label): label is string => Boolean(label));

    const seen = new Set(assigned);
    for (const segment of segments) {
      const name = segment.speaker;
      if (name && !seen.has(name)) {
        seen.add(name);
        assigned.push(name);
      }
    }

    return [...assigned, UNASSIGNED];
  }, [episode, segments]);

  const duration = useMemo(() => {
    const last = segments.reduce((max, s) => Math.max(max, s.end), 0);
    return Math.max(last, episode?.duration ?? 0, 60);
  }, [segments, episode]);

  const trackWidth = duration * pxPerSec;

  /** 確かめ済みの合計。どこまで進んだかを出すのに使う */
  const verifiedSec = useMemo(
    () => verified.reduce((sum, r) => sum + (r.end - r.start), 0),
    [verified]
  );

  // ---- 編集 ----

  const remember = useCallback((current: TruthSegment[]) => {
    history.current.push(current);
    // 際限なく貯めない。50 手も戻れば足りる
    if (history.current.length > 50) history.current.shift();
    setCanUndo(true);
  }, []);

  const update = useCallback(
    (next: TruthSegment[]) => {
      setSegments((current) => {
        remember(current);
        return [...next].sort((a, b) => a.start - b.start);
      });
      setDirty(true);
    },
    [remember]
  );

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;

    setSegments(previous);
    setSelected(null);
    setDirty(true);
    setCanUndo(history.current.length > 0);
  }, []);

  const moveToLane = useCallback(
    (index: number, lane: string) => {
      const next = [...segments];
      next[index] = { ...next[index], speaker: lane === UNASSIGNED ? null : lane };
      update(next);
    },
    [segments, update]
  );

  /**
   * 発言を時刻で二つに割る。
   *
   * 単語の途中で切れた境界を直したり、二人分が一つに入っているのを分けたりする。
   * 本文は前半に残す。どこで切れるかは聞いて決めるものなので、機械的に分けない。
   */
  const splitAt = useCallback(
    (at: number) => {
      const index = segments.findIndex((s) => at > s.start + 0.02 && at < s.end - 0.02);

      if (index < 0) {
        setError("その位置に発言がありません");
        return;
      }

      const segment = segments[index];
      const next = [...segments];
      next.splice(
        index,
        1,
        { ...segment, end: at },
        { ...segment, start: at, text: "" }
      );
      update(next);
      setSelected(index);
      setError(null);
    },
    [segments, update]
  );

  /** 再生位置に新しい発言を足す。落ちていた発話を書き起こすのに使う */
  const addAtPlayhead = useCallback(
    (lane: string) => {
      const next = [
        ...segments,
        {
          start: playhead,
          end: Math.min(playhead + 2, duration),
          text: "",
          speaker: lane === UNASSIGNED ? null : lane,
        },
      ];
      update(next);
      setSelected(next.findIndex((s) => s.start === playhead));
    },
    [segments, playhead, duration, update]
  );

  const remove = useCallback(
    (index: number) => {
      update(segments.filter((_, i) => i !== index));
      setSelected(null);
    },
    [segments, update]
  );

  const setEdge = useCallback(
    (index: number, edge: "start" | "end", at: number) => {
      const next = [...segments];
      const segment = { ...next[index] };

      if (edge === "start") {
        segment.start = Math.max(0, Math.min(at, segment.end - 0.1));
      } else {
        segment.end = Math.max(segment.start + 0.1, Math.min(at, duration));
      }

      next[index] = segment;
      // 並べ替えるとつまんでいる index が変わってしまうので、ここでは並べない
      setSegments(next);
      setDirty(true);
    },
    [segments, duration]
  );

  // ---- 端をつまんで伸び縮み ----

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const delta = (e.clientX - dragging.originX) / pxPerSec;
      setEdge(dragging.index, dragging.edge, dragging.originTime + delta);
    };

    const onUp = () => {
      setDragging(null);
      // 動かし終わってから並べ直す
      setSegments((current) => [...current].sort((a, b) => a.start - b.start));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, pxPerSec, setEdge]);

  // ---- 保存 ----

  const save = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    setError(null);

    try {
      // いま見ていた範囲を確かめ済みに加える
      const next = range ? [...verified, range] : verified;
      const result = await api.saveTruth(id, segments, next);

      setVerified(result.ranges);
      setSource("truth");
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [id, segments, range, verified]);

  // ---- 音声 ----

  const seek = useCallback(
    (at: number) => {
      setPlayhead(at);
      if (audio) audio.currentTime = at;
    },
    [audio]
  );

  const togglePlay = useCallback(() => {
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [audio]);

  /** 選んでいる発言だけを聞く。誰が喋っているかを確かめる基本の操作 */
  const playSelected = useCallback(() => {
    if (selected === null) return;
    const segment = segments[selected];
    if (!audio) return;

    audio.currentTime = segment.start;
    void audio.play();

    const stop = () => {
      if (audio.currentTime >= segment.end) {
        audio.pause();
        audio.removeEventListener("timeupdate", stop);
      }
    };
    audio.addEventListener("timeupdate", stop);
  }, [audio, segments, selected]);

  useEffect(() => {
    if (!audio) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onSeeked = () => setPlayhead(audio.currentTime);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [audio]);

  /**
   * 再生中は毎フレーム位置を読む。
   *
   * timeupdate は 1 秒に 4 回しか来ないので、バーがカクついて位置が読めない。
   */
  useEffect(() => {
    if (!audio || !playing) return;

    let frame = 0;
    const tick = () => {
      setPlayhead(audio.currentTime);

      // 範囲を決めているときは、その中を繰り返す
      if (loop && range && audio.currentTime >= range.end) {
        audio.currentTime = range.start;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audio, playing, loop, range]);

  // 再生位置が画面から出たら追いかける
  useEffect(() => {
    if (!playing) return;
    const box = scrollRef.current;
    if (!box) return;

    const x = LABEL_WIDTH + playhead * pxPerSec;
    if (x < box.scrollLeft + LABEL_WIDTH || x > box.scrollLeft + box.clientWidth - 80) {
      box.scrollLeft = x - box.clientWidth / 3;
    }
  }, [playhead, playing, pxPerSec]);

  // ---- 手元の操作 ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 取り消しは本文を書いている最中でも効かせる。ブラウザの取り消しは
      // その入力欄の中だけなので、こちらが受けると被る。入力欄では譲る
      const target = e.target as KeyboardEvent["target"] & HTMLElement;
      const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !inField) {
        e.preventDefault();
        undo();
        return;
      }

      if (inField) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        splitAt(playhead);
        return;
      }

      if (e.key === "Enter" && selected !== null) {
        e.preventDefault();
        playSelected();
        return;
      }

      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && selected !== null) {
        e.preventDefault();
        const current = segments[selected].speaker ?? UNASSIGNED;
        const at = lanes.indexOf(current);
        const to = e.key === "ArrowUp" ? at - 1 : at + 1;
        if (to >= 0 && to < lanes.length) moveToLane(selected, lanes[to]);
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        seek(Math.max(0, playhead + (e.key === "ArrowLeft" ? -step : step)));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    lanes,
    moveToLane,
    playSelected,
    playhead,
    seek,
    segments,
    selected,
    splitAt,
    togglePlay,
    undo,
  ]);

  useEffect(() => {
    if (!dirty) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- 描画 ----

  if (loading) {
    return <div className="p-8 text-[var(--color-text-muted)]">読み込んでいます...</div>;
  }

  if (!episode) {
    return (
      <div className="p-8">
        <p className="text-[var(--color-error)]">{error ?? "エピソードが見つかりません"}</p>
        <Link to="/" className="text-[var(--color-accent)]">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  const laneLabel = (lane: string) => (lane === UNASSIGNED ? "未割当" : lane);
  const selectedSegment = selected !== null ? segments[selected] : null;

  /** 目盛りの間隔。拡大率に応じて粗くする */
  const tick = pxPerSec >= 128 ? 1 : pxPerSec >= 32 ? 5 : pxPerSec >= 8 ? 30 : 60;

  return (
    <div className="flex h-screen flex-col select-none">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            to={`/episodes/${id}`}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            ← {episode.title}
          </Link>

          <span className="text-xs text-[var(--color-text-muted)]">
            {segments.length} 発言 / {lanes.length - 1} 人
            {source === "raw" && "・生データから開始"}
            {verifiedSec > 0 &&
              `・確かめ済み ${Math.round(verifiedSec / 60)}分（${Math.round(
                (verifiedSec / duration) * 100
              )}%）`}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={togglePlay} className="btn btn-secondary text-xs">
              {playing ? "停止" : "再生"}
            </button>
            <span className="w-20 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
              {formatTime(playhead)}
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
              disabled={zoom === 0}
              className="btn btn-secondary text-xs"
            >
              −
            </button>
            <span className="w-16 text-center text-xs text-[var(--color-text-muted)]">
              {pxPerSec}px/s
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
              disabled={zoom === ZOOM_STEPS.length - 1}
              className="btn btn-secondary text-xs"
            >
              ＋
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="取り消し（⌘Z）"
              className="btn btn-secondary text-xs"
            >
              取り消し
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || (!dirty && !range)}
              className="btn btn-primary text-xs"
            >
              {saving ? "保存中..." : range ? "この範囲を正解にする" : dirty ? "正解を保存" : "保存済み"}
            </button>
          </div>
        </div>

        {/* 作業する範囲。76 分を一度に直すのは無理なので、少しずつ確かめる */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-text-muted)]">範囲</span>

          {range ? (
            <>
              <span className="font-mono tabular-nums">
                {formatTime(range.start)} – {formatTime(range.end)}（
                {Math.round(range.end - range.start)}秒）
              </span>
              <button
                type="button"
                onClick={() => seek(range.start)}
                className="btn btn-secondary text-xs"
              >
                頭から
              </button>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={loop}
                  onChange={(e) => setLoop(e.target.checked)}
                />
                繰り返す
              </label>
              <button
                type="button"
                onClick={() => setRange(null)}
                className="btn btn-secondary text-xs"
              >
                範囲を外す
              </button>
            </>
          ) : (
            <>
              <span className="text-[var(--color-text-muted)]">
                目盛りを横にドラッグして選ぶ / または
              </span>
              {[1, 3, 5].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() =>
                    setRange({
                      start: playhead,
                      end: Math.min(playhead + minutes * 60, duration),
                    })
                  }
                  className="btn btn-secondary text-xs"
                >
                  ここから{minutes}分
                </button>
              ))}
            </>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-[var(--color-error)]">{error}</p>}

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          クリックで再生位置を置く / <kbd>Space</kbd> 再生 / <kbd>Enter</kbd> 選んだ発言だけ聞く
          / <kbd>↑↓</kbd> 話者を変える / <kbd>S</kbd> 再生位置で分割 / <kbd>←→</kbd> 0.1 秒（Shift で 1 秒）
          / <kbd>⌘Z</kbd> 取り消し / 発言の端をつまんで伸び縮み / 本文は下の欄にそのまま書ける
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="relative" style={{ width: LABEL_WIDTH + trackWidth + 80 }}>
          {/* 時間の目盛り */}
          <div className="sticky top-0 z-20 flex h-6 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-base)]"
              style={{ width: LABEL_WIDTH }}
            />
            <div
              className="relative cursor-ew-resize"
              style={{ width: trackWidth }}
              onPointerDown={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const at = Math.max(0, (e.clientX - box.left) / pxPerSec);

                // 目盛りはドラッグで範囲を選ぶ。ただの click なら再生位置
                setSelecting(at);
                seek(at);
              }}
              onPointerMove={(e) => {
                if (selecting === null) return;
                const box = e.currentTarget.getBoundingClientRect();
                const at = Math.max(0, (e.clientX - box.left) / pxPerSec);

                if (Math.abs(at - selecting) > 0.3) {
                  setRange({
                    start: Math.min(selecting, at),
                    end: Math.max(selecting, at),
                  });
                }
              }}
              onPointerUp={() => setSelecting(null)}
            >
              {Array.from({ length: Math.floor(duration / tick) + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-full border-l border-[var(--color-border)] pl-1 font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]"
                  style={{ left: i * tick * pxPerSec }}
                >
                  {formatTime(i * tick)}
                </span>
              ))}
            </div>
          </div>

          {/* 話者ごとのトラック */}
          {lanes.map((lane) => (
            <div
              key={lane}
              className="flex border-b border-[var(--color-border)]"
              style={{ height: LANE_HEIGHT }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1 border-r border-[var(--color-border)] bg-[var(--color-bg-base)] px-2"
                style={{ width: LABEL_WIDTH }}
              >
                <span className="truncate text-xs font-medium">{laneLabel(lane)}</span>
                <button
                  type="button"
                  onClick={() => addAtPlayhead(lane)}
                  title="再生位置に発言を足す"
                  className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                >
                  ＋
                </button>
              </div>

              <div
                className="relative cursor-text"
                style={{ width: trackWidth }}
                onPointerDown={(e) => {
                  if (dragging) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  seek(Math.max(0, (e.clientX - box.left) / pxPerSec));
                }}
              >
                {levels[lane] && (
                  <Waveform
                    levels={levels[lane]}
                    duration={duration}
                    pxPerSec={pxPerSec}
                    height={LANE_HEIGHT}
                  />
                )}

                {segments.map((segment, index) => {
                  if ((segment.speaker ?? UNASSIGNED) !== lane) return null;

                  const isSelected = selected === index;
                  const width = Math.max(3, (segment.end - segment.start) * pxPerSec);

                  return (
                    <div
                      key={index}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const box = e.currentTarget.getBoundingClientRect();
                        setSelected(index);
                        // クリックした位置に再生位置を置く。先頭に飛ばすと
                        // 「再生位置で分割」がその発言の中で使えない
                        seek(segment.start + (e.clientX - box.left) / pxPerSec);
                      }}
                      title={segment.text}
                      className={`absolute top-1 overflow-hidden rounded border text-[10px] leading-tight transition-colors ${
                        isSelected
                          ? "z-10 border-[var(--color-accent)] bg-[var(--color-accent)]/30 ring-1 ring-[var(--color-accent)]"
                          : segment.speaker
                            ? "border-[var(--color-border)] bg-[var(--color-bg-elevated)]/90 hover:border-[var(--color-accent)]"
                            : "border-dashed border-[var(--color-error)] bg-[var(--color-error)]/15"
                      }`}
                      style={{
                        left: segment.start * pxPerSec,
                        width,
                        height: LANE_HEIGHT - 10,
                      }}
                    >
                      {/* 端をつまんで伸び縮みさせる */}
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelected(index);
                          remember(segments);
                          setDragging({
                            index,
                            edge: "start",
                            originX: e.clientX,
                            originTime: segment.start,
                          });
                        }}
                        className="absolute inset-y-0 left-0 z-20 cursor-ew-resize bg-[var(--color-accent)]/0 hover:bg-[var(--color-accent)]/60"
                        style={{ width: HANDLE_PX }}
                      />
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelected(index);
                          remember(segments);
                          setDragging({
                            index,
                            edge: "end",
                            originX: e.clientX,
                            originTime: segment.end,
                          });
                        }}
                        className="absolute inset-y-0 right-0 z-20 cursor-ew-resize bg-[var(--color-accent)]/0 hover:bg-[var(--color-accent)]/60"
                        style={{ width: HANDLE_PX }}
                      />

                      {/* 本文。折り返さない。狭いところで 1 文字ずつ折れると読めない */}
                      <span
                        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap px-2"
                        style={{ paddingLeft: HANDLE_PX + 2, paddingRight: HANDLE_PX + 2 }}
                      >
                        {segment.text || <span className="opacity-50">（空）</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 確かめ済みの範囲。どこまで進んだかが見えるように */}
          {verified.map((done, i) => (
            <div
              key={i}
              className="pointer-events-none absolute top-6 bottom-0 z-0 bg-[var(--color-success)]/10"
              style={{
                left: LABEL_WIDTH + done.start * pxPerSec,
                width: (done.end - done.start) * pxPerSec,
              }}
            />
          ))}

          {/* いま作業している範囲。外は暗くする */}
          {range && (
            <>
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 bg-[var(--color-bg-base)]/70"
                style={{ left: LABEL_WIDTH, width: range.start * pxPerSec }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 bg-[var(--color-bg-base)]/70"
                style={{
                  left: LABEL_WIDTH + range.end * pxPerSec,
                  width: Math.max(0, (duration - range.end) * pxPerSec),
                }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 border-x-2 border-[var(--color-accent)]"
                style={{
                  left: LABEL_WIDTH + range.start * pxPerSec,
                  width: (range.end - range.start) * pxPerSec,
                }}
              />
            </>
          )}

          {/* 再生位置 */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-[var(--color-error)]"
            style={{ left: LABEL_WIDTH + playhead * pxPerSec }}
          >
            <span className="absolute -top-0.5 -left-1 h-2 w-2 rotate-45 bg-[var(--color-error)]" />
          </div>
        </div>
      </div>

      {selectedSegment && (
        <footer className="shrink-0 border-t border-[var(--color-border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
              {formatTime(selectedSegment.start)} – {formatTime(selectedSegment.end)}
            </span>

            <select
              value={selectedSegment.speaker ?? UNASSIGNED}
              onChange={(e) => moveToLane(selected!, e.target.value)}
              className="input text-xs"
            >
              {lanes.map((lane) => (
                <option key={lane} value={lane}>
                  {laneLabel(lane)}
                </option>
              ))}
            </select>

            <button type="button" onClick={playSelected} className="btn btn-secondary text-xs">
              ここだけ聞く
            </button>
            <button
              type="button"
              onClick={() => splitAt(playhead)}
              className="btn btn-secondary text-xs"
            >
              再生位置で分割
            </button>

            <button
              type="button"
              onClick={() => remove(selected!)}
              className="btn btn-secondary ml-auto text-xs text-[var(--color-error)]"
            >
              削除
            </button>
          </div>

          {/*
            常に書ける状態にしておく。ダブルクリックしないと書けないと、
            直したいと思ってから手が止まる。正解を作る作業は「聞いて、直す」の
            繰り返しなので、間に操作を挟まない
          */}
          <textarea
            key={selected}
            value={selectedSegment.text}
            onChange={(e) => {
              const next = [...segments];
              next[selected!] = { ...next[selected!], text: e.target.value };
              // 1 文字ごとに履歴へ積むと取り消しが使いものにならない。
              // 本文の取り消しは入力欄自身のものに任せる
              setSegments(next);
              setDirty(true);
            }}
            rows={2}
            placeholder="ここに本文を書く"
            className="input mt-2 w-full text-sm leading-relaxed"
          />
        </footer>
      )}

      {episode.audioUrl && (
        <audio ref={setAudio} src={episode.audioUrl} preload="metadata" />
      )}
    </div>
  );
}
