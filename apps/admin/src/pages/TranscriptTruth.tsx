import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type {
  EpisodeDetail,
  RawSegment,
  TruthBase,
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
const LANE_HEIGHT = 76;

/** 現状の出力を重ねて見せる帯の高さ */
const OUTPUT_STRIP_HEIGHT = 18;
const LABEL_WIDTH = 112;

/** 端をつまむ幅 */
const HANDLE_PX = 6;

/** 範囲の端をつまむ幅。発言より掴みやすくしておく */
const RANGE_HANDLE_PX = 10;

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
  /**
   * どちらを元に正解を作っているか。
   *
   * 既定は公開データ。生データは 2201 セグメントあって単語の途中で切れており、
   * 句読点も無いので、人が読んで直せる形になっていない。公開データは 411 で
   * 統合も句読点も済んでいる。編集の手間が 5 分の 1 になる。
   *
   * どちらで作ったかは保存しておく。採点が比べる先をこれで決める。生データ
   * 基準の正解を公開データと比べると、統合のぶん境界が systematically ずれて
   * 数字が意味を失う。
   */
  const [base, setBase] = useState<TruthBase>("published");
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

  /** 範囲の端をつまんで動かしている最中の、どちらの端か */
  const [movingEdge, setMovingEdge] = useState<"start" | "end" | null>(null);

  /**
   * 校正まで通した現状の出力。読むだけで、直せない。
   *
   * 正解は生データから作る（後処理の前なので、話者分離の誤りと後処理の誤りを
   * 切り分けられる）。ただ「いま何が公開されているか」を見ないと、直した結果が
   * どう効くのか分からない。重ねて見られるようにしておく。
   */
  const [output, setOutput] = useState<TruthSegment[]>([]);
  const [showOutput, setShowOutput] = useState(true);

  /** 現状の出力のうち、いま選んでいるもの。中身を読むためだけ */
  const [pickedOutput, setPickedOutput] = useState<number | null>(null);

  /** 本文の入力欄。選択した範囲を抜き出すのに使う */
  const textRef = useRef<HTMLTextAreaElement | null>(null);

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

        const rawUrl = detail.transcriptRawUrl;
        const publishedUrl = rawUrl?.replace(
          /transcript\.raw\.json$/,
          "transcript.json"
        );

        if (truth.exists && truth.segments.length > 0) {
          setSegments(toTruth(truth.segments));
          setVerified(truth.ranges ?? []);
          setBase(truth.base);
        } else if (publishedUrl) {
          // 正解がまだ無いので、公開されているものから始める
          const response = await fetch(publishedUrl);
          if (!response.ok) throw new Error(`公開データを読めません（HTTP ${response.status}）`);

          const data = (await response.json()) as { segments?: RawSegment[] };
          if (!alive) return;

          setSegments(toTruth(data.segments ?? []));
          setBase("published");
        } else {
          setError("文字起こしがありません。先に走らせてください");
        }

        // 重ねて見せる側。生データを出す。後処理が何をしたかが見えると、
        // 話者の誤りが分離の段か後処理の段かを目で切り分けられる
        if (rawUrl) {
          try {
            const response = await fetch(rawUrl);
            if (response.ok) {
              const data = (await response.json()) as { segments?: RawSegment[] };
              if (alive) setOutput(toTruth(data.segments ?? []));
            }
          } catch {
            // 重ねて見られないだけ
          }
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

  /**
   * いま流れている発言。再生位置より手前で、いちばん最後に始まったもの。
   *
   * 聞きながら「いまどこを読んでいるか」が見えないと、話者を直すときに耳と
   * 目が合わない。字幕のように出す。
   */
  const onAir = useMemo(() => {
    let found: TruthSegment | null = null;

    for (const segment of segments) {
      if (segment.start > playhead) break;
      found = segment;
    }

    // 終わっている発言は出さない。`!found` のときに拾い続けていたため、
    // まだ何も始まっていない冒頭で 1 件目がずっと表示されていた
    return found && found.end >= playhead ? found : null;
  }, [segments, playhead]);

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

  /**
   * 本文の選んだ部分を抜き出して、未割当のトラックに出す。
   *
   * 1 つの発言に二人分が入っているとき、間で切るだけでは足りないことがある。
   * 相手の言葉が文の途中に挟まっていると、時間では切り分けられない。文字で
   * 選んで抜き出し、あとから端を合わせて話者を決める。
   *
   * 抜き出したものは元と同じ長さで出す。正しい時刻は聞いて決めるものなので、
   * ここでは推測しない。
   */
  const extractSelection = useCallback(() => {
    if (selected === null) return;

    const field = textRef.current;
    if (!field) return;

    const from = field.selectionStart;
    const to = field.selectionEnd;

    if (from === to) {
      setError("本文の抜き出したい部分を選んでください");
      return;
    }

    const segment = segments[selected];
    const taken = segment.text.slice(from, to);
    const left = (segment.text.slice(0, from) + segment.text.slice(to)).trim();

    update([
      ...segments.filter((_, i) => i !== selected),
      { ...segment, text: left },
      { ...segment, text: taken.trim(), speaker: null },
    ]);
    setError(null);
  }, [segments, selected, update]);

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

  /**
   * 範囲の端をつまんで動かす。
   *
   * 選び直すより、いま見ている範囲を少し伸ばす・縮めるほうが多い。文の途中で
   * 切れていたら端を動かして合わせる。
   */
  useEffect(() => {
    if (!movingEdge || !range) return;

    const onMove = (e: PointerEvent) => {
      const box = scrollRef.current?.getBoundingClientRect();
      if (!box) return;

      const at = Math.max(
        0,
        Math.min(
          (e.clientX - box.left + (scrollRef.current?.scrollLeft ?? 0) - LABEL_WIDTH) /
            pxPerSec,
          duration
        )
      );

      setRange((current) => {
        if (!current) return current;

        return movingEdge === "start"
          ? { ...current, start: Math.min(at, current.end - 0.5) }
          : { ...current, end: Math.max(at, current.start + 0.5) };
      });
    };

    const onUp = () => setMovingEdge(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [movingEdge, range, pxPerSec, duration]);

  // ---- 保存 ----

  const save = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    setError(null);

    try {
      // いま見ていた範囲を確かめ済みに加える
      const next = range ? [...verified, range] : verified;
      const result = await api.saveTruth(id, segments, next, base);

      setVerified(result.ranges);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [id, segments, range, verified, base]);

  /**
   * いまの内容をファイルとして落とす。
   *
   * 保存先は R2 で公開 URL からも取れるが、URL を組むのが面倒なので手元に
   * 落とせるようにしておく。採点や別の道具に渡すときに使う。
   */
  const download = useCallback(() => {
    const payload = {
      episode: episode?.id ?? id,
      title: episode?.title ?? null,
      ranges: range ? [...verified, range] : verified,
      segments,
    };

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `transcript.truth.${episode?.id ?? id}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }, [episode, id, range, verified, segments]);

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
            {base === "published" ? "・公開データを直す" : "・生データを直す"}
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
            <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={showOutput}
                onChange={(e) => setShowOutput(e.target.checked)}
              />
              生データ
            </label>
            <button
              type="button"
              onClick={download}
              title="いまの内容を JSON で落とす"
              className="btn btn-secondary text-xs"
            >
              ↓ JSON
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
              {/* 数値でも直せるようにする。ドラッグでは秒単位まで合わせづらい */}
              <input
                type="number"
                step={0.1}
                min={0}
                max={range.end - 0.5}
                value={range.start.toFixed(1)}
                onChange={(e) =>
                  setRange({
                    ...range,
                    start: Math.max(0, Math.min(Number(e.target.value), range.end - 0.5)),
                  })
                }
                className="input w-24 font-mono text-xs tabular-nums"
              />
              <span className="text-[var(--color-text-muted)]">–</span>
              <input
                type="number"
                step={0.1}
                min={range.start + 0.5}
                max={duration}
                value={range.end.toFixed(1)}
                onChange={(e) =>
                  setRange({
                    ...range,
                    end: Math.min(
                      duration,
                      Math.max(Number(e.target.value), range.start + 0.5)
                    ),
                  })
                }
                className="input w-24 font-mono text-xs tabular-nums"
              />
              <span className="text-[var(--color-text-muted)]">
                秒（{formatTime(range.start)}–{formatTime(range.end)}・
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
            <span className="text-[var(--color-text-muted)]">
              再生位置を置いて「ここから」「ここまで」で決める
            </span>
          )}

          <button
            type="button"
            onClick={() =>
              setRange((current) => ({
                start: playhead,
                end: Math.max(current?.end ?? playhead + 60, playhead + 1),
              }))
            }
            title="再生位置を範囲の頭にする"
            className="btn btn-secondary text-xs"
          >
            ここから
          </button>
          <button
            type="button"
            onClick={() =>
              setRange((current) => ({
                start: Math.min(current?.start ?? Math.max(0, playhead - 60), playhead - 1),
                end: playhead,
              }))
            }
            title="再生位置を範囲の終わりにする"
            className="btn btn-secondary text-xs"
          >
            ここまで
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-[var(--color-error)]">{error}</p>}

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          クリックで再生位置を置く / <kbd>Space</kbd> 再生 / <kbd>Enter</kbd> 選んだ発言だけ聞く
          / <kbd>↑↓</kbd> 話者を変える / <kbd>S</kbd> 再生位置で分割 / <kbd>←→</kbd> 0.1 秒（Shift で 1 秒）
          / <kbd>⌘Z</kbd> 取り消し / 発言の端をつまんで伸び縮み / 本文を選んで「抜き出す」
          <br />
          上段が正解（編集できる）、下の薄い帯が Whisper の生出力（読むだけ）。
          本文の誤りは校正が直す担当なので、ここでは<b>誰がいつ喋ったか</b>だけ直せば足ります。
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
              className="relative cursor-pointer"
              style={{ width: trackWidth }}
              onPointerDown={(e) => {
                // 目盛りは再生位置を置くだけ。範囲は「ここから」「ここまで」で
                // 決める。ドラッグで範囲が変わると、位置を送るつもりで
                // 範囲を作ってしまう
                const box = e.currentTarget.getBoundingClientRect();
                seek(Math.max(0, (e.clientX - box.left) / pxPerSec));
              }}
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

                {/*
                  Whisper の生出力。読むだけ。後処理が何をしたかが見えるので、
                  話者の誤りが分離の段か後処理の段かを目で切り分けられる
                */}
                {showOutput &&
                  output.map((segment, index) => {
                    if ((segment.speaker ?? UNASSIGNED) !== lane) return null;

                    return (
                      <div
                        key={`out-${index}`}
                        title={segment.text}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setPickedOutput(index);
                        }}
                        className={`absolute cursor-pointer overflow-hidden whitespace-nowrap rounded-sm border px-1 text-[9px] leading-[16px] transition-colors ${
                          pickedOutput === index
                            ? "border-[var(--color-info)] bg-[var(--color-info)]/25 text-[var(--color-text-primary)]"
                            : "border-[var(--color-text-muted)]/40 bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)] hover:border-[var(--color-info)]"
                        }`}
                        style={{
                          left: segment.start * pxPerSec,
                          width: Math.max(3, (segment.end - segment.start) * pxPerSec),
                          bottom: 2,
                          height: OUTPUT_STRIP_HEIGHT,
                        }}
                      >
                        {segment.text}
                      </div>
                    );
                  })}

                {segments.map((segment, index) => {
                  if ((segment.speaker ?? UNASSIGNED) !== lane) return null;

                  const isSelected = selected === index;
                  const width = Math.max(3, (segment.end - segment.start) * pxPerSec);

                  return (
                    <div
                      key={index}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        // 選ぶだけ。再生位置は動かさない。聞きながら
                        // 選び直すとき、位置が飛ぶと聞き直しになる
                        setSelected(index);
                        setPickedOutput(null);
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
                        height: LANE_HEIGHT - OUTPUT_STRIP_HEIGHT - 8,
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

              {/* 端をつまんで動かす */}
              {(["start", "end"] as const).map((edge) => (
                <div
                  key={edge}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setMovingEdge(edge);
                  }}
                  title={edge === "start" ? "範囲の頭を動かす" : "範囲の終わりを動かす"}
                  className="absolute top-0 bottom-0 z-25 flex cursor-ew-resize items-start justify-center bg-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/60"
                  style={{
                    left: LABEL_WIDTH + range[edge] * pxPerSec - RANGE_HANDLE_PX / 2,
                    width: RANGE_HANDLE_PX,
                  }}
                >
                  <span className="mt-0.5 h-4 w-1 rounded bg-[var(--color-accent)]" />
                </div>
              ))}
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

      {/* いま流れている発言。聞きながら目で追えるように */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
            {onAir?.speaker ?? "—"}
          </span>
          <p className="min-h-[1.4em] flex-1 text-sm leading-relaxed">
            {onAir?.text || (
              <span className="text-[var(--color-text-muted)]">（無音）</span>
            )}
          </p>
        </div>

        {pickedOutput !== null && output[pickedOutput] && (
          <div className="mt-1 flex items-baseline gap-3 border-t border-[var(--color-border)] pt-1">
            <span className="shrink-0 text-[10px] text-[var(--color-info)]">
              生 {output[pickedOutput].speaker ?? "未割当"}
            </span>
            <p className="flex-1 select-text text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {output[pickedOutput].text}
            </p>
            <button
              type="button"
              onClick={() => setPickedOutput(null)}
              className="shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              ✕
            </button>
          </div>
        )}
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
              onClick={extractSelection}
              title="本文の選んだ部分を、未割当のトラックに抜き出す"
              className="btn btn-secondary text-xs"
            >
              選択部分を抜き出す
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
            ref={textRef}
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
