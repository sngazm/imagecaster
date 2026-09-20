import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ReviewCard } from "../lib/api";
import { formatClock } from "../components/TranscriptViewer";

/**
 * 確認カード
 *
 * 機械が「怪しいが決められない」とした行を、その区間の音を聞きながら 1 枚ずつ決める。
 * 右へ払えば候補にする、左へ払えばそのまま。1 枚 10 秒で済むことを目指している。
 *
 * カードの入れ替わりは、消してから出すのではなく位置を動かして見せる。上の 1 枚が
 * 横へ抜け、下で待っていた 1 枚がそのまま上がってくる。不透明度は一切触らない。
 * そのために下の 2 枚も常に描いておき、key を保って要素を使い回す。
 */

/** どれだけ払ったら決めたことにするか（px） */
const SWIPE_THRESHOLD = 110;
/** 抜けていく動きの長さ（ms）。CSS の transition と揃える */
const LEAVE_MS = 240;
/** 行の少し前から聞かせる。頭が切れると聞き取れない */
const LEAD_IN_SEC = 1.5;
const TAIL_SEC = 1.0;

type Direction = "left" | "right" | "down";

interface Decided {
  card: ReviewCard;
  action: "keep" | "fix";
}

/** 2 つの文の、変わっている部分を取り出す */
function diffParts(a: string, b: string) {
  const max = Math.min(a.length, b.length);

  let head = 0;
  while (head < max && a[head] === b[head]) head++;

  let tail = 0;
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  return {
    prefix: a.slice(0, head),
    removed: a.slice(head, a.length - tail),
    added: b.slice(head, b.length - tail),
    suffix: a.slice(a.length - tail),
  };
}

function LineWithDiff({ current, candidate }: { current: string; candidate: string | null }) {
  if (!candidate || candidate === current) {
    return <>{current}</>;
  }

  const { prefix, removed, added, suffix } = diffParts(current, candidate);

  return (
    <>
      {prefix}
      {removed && (
        <del className="rounded bg-[var(--color-error-muted)] px-0.5 text-[var(--color-error)] decoration-1">
          {removed}
        </del>
      )}
      {added && (
        <ins className="rounded bg-[var(--color-success-muted)] px-0.5 text-[var(--color-success)] no-underline">
          {added}
        </ins>
      )}
      {suffix}
    </>
  );
}

function transformFor(position: "top" | "under", drag: number, leaving: Direction | null): string {
  if (leaving === "left") return "translate(-130%, 0) rotate(-12deg)";
  if (leaving === "right") return "translate(130%, 0) rotate(12deg)";
  if (leaving === "down") return "translate(0, 130%)";
  if (position === "under") return "translate(0, 12px) scale(0.96)";
  return `translate(${drag}px, 0) rotate(${drag / 24}deg)`;
}

export function ReviewCards() {
  const { id = "" } = useParams();

  const [title, setTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [deck, setDeck] = useState<ReviewCard[]>([]);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<Decided[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [choice, setChoice] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; direction: Direction } | null>(null);
  /** 取り消しで戻ってくるカード。抜けた側から入ってくるよう、最初の 1 コマだけ外に置く */
  const [entering, setEntering] = useState<{ id: string; direction: Direction } | null>(null);
  const [busy, setBusy] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  const top = deck[0] ?? null;
  const candidate = top ? (top.candidates[choice] ?? null) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getReviewCards(id);
      setTitle(data.title);
      setAudioUrl(data.audioUrl);
      setDeck(data.cards);
      setTotal(data.cards.length);
      setHistory([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const play = useCallback((card: ReviewCard | null) => {
    const audio = audioRef.current;
    const range = card?.current ?? card;
    if (!audio || !range) return;

    stopAtRef.current = range.end + TAIL_SEC;
    audio.currentTime = Math.max(0, range.start - LEAD_IN_SEC);
    // 最初の 1 枚は、操作する前だとブラウザに止められる。再生ボタンを押せば鳴る
    void audio.play().catch(() => undefined);
  }, []);

  // 上の 1 枚が替わったら、その区間を鳴らす
  const topId = top?.id;
  useEffect(() => {
    setChoice(0);
    setEditing(false);
    setDrag(0);
    if (topId) play(deck.find((c) => c.id === topId) ?? null);
    // deck 全体に反応すると、並べ替えのたびに鳴り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId, play]);

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && stopAtRef.current !== null && audio.currentTime >= stopAtRef.current) {
      audio.pause();
      stopAtRef.current = null;
    }
  };

  /** 上の 1 枚を抜いて、決めた結果を送る */
  const decide = useCallback(
    async (action: "keep" | "fix", text?: string) => {
      if (!top || busy || leaving) return;
      if (action === "fix" && !text) return;

      setBusy(true);
      setError(null);
      setLeaving({ id: top.id, direction: action === "fix" ? "right" : "left" });

      try {
        const [result] = await Promise.all([
          api.resolveReviewCard(id, top.id, { action, text, expected: top.current?.text }),
          new Promise((resolve) => setTimeout(resolve, LEAVE_MS)),
        ]);

        setHistory((h) => [...h, { card: top, action: result.action }]);
        setDeck((d) => d.filter((c) => c.id !== top.id));
      } catch (e) {
        // 送れなかったら、カードは元の位置へ戻る
        setError(e instanceof Error ? e.message : "保存できませんでした");
      } finally {
        setLeaving(null);
        setBusy(false);
      }
    },
    [top, busy, leaving, id]
  );

  /** あとで決める。いちばん下へ回す */
  const skip = useCallback(() => {
    if (!top || busy || leaving || deck.length < 2) return;

    setLeaving({ id: top.id, direction: "down" });
    setTimeout(() => {
      setDeck((d) => [...d.slice(1), d[0]]);
      setLeaving(null);
    }, LEAVE_MS);
  }, [top, busy, leaving, deck.length]);

  /** 直前の判断を取り消す。直していたら、入れた修正も外れる */
  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || busy || leaving) return;

    setBusy(true);
    setError(null);

    try {
      await api.undoReviewCard(id, last.card.id);

      const direction: Direction = last.action === "fix" ? "right" : "left";
      setEntering({ id: last.card.id, direction });
      setHistory((h) => h.slice(0, -1));
      setDeck((d) => [last.card, ...d]);
      // 外に置いた 1 コマを描かせてから、定位置へ動かす
      requestAnimationFrame(() => requestAnimationFrame(() => setEntering(null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消せませんでした");
    } finally {
      setBusy(false);
    }
  }, [history, busy, leaving, id]);

  const startEditing = useCallback(() => {
    if (!top?.current) return;
    setDraft(candidate ?? top.current.text);
    setEditing(true);
  }, [top, candidate]);

  // キーボード
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) {
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void decide("fix", draft.trim());
        return;
      }

      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;

      if (e.key === "ArrowLeft") void decide("keep");
      else if (e.key === "ArrowRight" && candidate) void decide("fix", candidate);
      else if (e.key === "ArrowUp" || e.key === "e") {
        e.preventDefault();
        startEditing();
      } else if (e.key === "ArrowDown" || e.key === "s") skip();
      else if (e.key === " ") {
        e.preventDefault();
        play(top);
      } else if (e.key === "z") void undo();
      else if (/^[1-9]$/.test(e.key) && top && Number(e.key) <= top.candidates.length) {
        setChoice(Number(e.key) - 1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, draft, decide, candidate, startEditing, skip, play, top, undo]);

  // 払う操作
  const onPointerDown = (e: React.PointerEvent) => {
    if (editing || busy || (e.target as HTMLElement).closest("button, textarea, a")) return;
    dragStartRef.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStartRef.current === null) return;
    setDrag(e.clientX - dragStartRef.current);
  };

  const onPointerUp = () => {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    setDragging(false);

    if (drag > SWIPE_THRESHOLD && candidate) void decide("fix", candidate);
    else if (drag < -SWIPE_THRESHOLD) void decide("keep");
    setDrag(0);
  };

  if (loading) {
    return <div className="p-6 text-sm text-[var(--color-text-muted)]">読み込み中…</div>;
  }

  const decidedCount = history.length;

  return (
    <div className="mx-auto max-w-xl p-4">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <Link to={`/episodes/${id}`} className="truncate text-[var(--color-accent)]">
          ← {title}
        </Link>
        <span className="ml-auto shrink-0 tabular-nums text-[var(--color-text-muted)]">
          {decidedCount} / {total}
        </span>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={onTimeUpdate} />
      )}

      {error && (
        <div className="mb-3 rounded border border-[var(--color-error)] bg-[var(--color-error-muted)] p-2 text-sm text-[var(--color-error)]">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            読み込み直す
          </button>
        </div>
      )}

      {deck.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="mb-2 font-medium">
            {total === 0 ? "確認する箇所はありません" : "全部見ました"}
          </p>
          {decidedCount > 0 && (
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              直した分は、5 分以内に公開サイトへ反映されます。
            </p>
          )}
          <div className="flex justify-center gap-2">
            {decidedCount > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => void undo()}>
                ひとつ戻る
              </button>
            )}
            <Link to={`/episodes/${id}`} className="btn btn-primary">
              エピソードへ戻る
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 重ねて描く。下の 2 枚は同じ位置で待っていて、上が抜けるとそのまま上がってくる */}
          <div className="grid touch-pan-y select-none" style={{ perspective: 1000 }}>
            {deck
              .slice(0, 3)
              .map((card, depth) => {
                const isTop = depth === 0;
                const isLeaving = leaving?.id === card.id;
                const isEntering = entering?.id === card.id;
                // 上が抜けている間、2 枚目はもう上の位置へ動き始める
                const position = isTop || (depth === 1 && leaving) ? "top" : "under";

                return (
                  <div
                    key={card.id}
                    aria-hidden={!isTop}
                    className="card col-start-1 row-start-1 p-4"
                    style={{
                      zIndex: 3 - depth,
                      transform: transformFor(
                        position,
                        isTop ? drag : 0,
                        isLeaving ? leaving.direction : isEntering ? entering.direction : null
                      ),
                      transition:
                        (isTop && dragging) || isEntering
                          ? "none"
                          : `transform ${LEAVE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
                      pointerEvents: isTop ? "auto" : "none",
                      background: "var(--color-bg-elevated)",
                    }}
                    onPointerDown={isTop ? onPointerDown : undefined}
                    onPointerMove={isTop ? onPointerMove : undefined}
                    onPointerUp={isTop ? onPointerUp : undefined}
                    onPointerCancel={isTop ? onPointerUp : undefined}
                  >
                    <CardBody
                      card={card}
                      candidate={isTop ? candidate : (card.candidates[0] ?? null)}
                      choice={isTop ? choice : 0}
                      onChoose={setChoice}
                      editing={isTop && editing}
                      draft={draft}
                      onDraft={setDraft}
                      onReplay={() => play(card)}
                      swipe={isTop ? drag : 0}
                    />
                  </div>
                );
              })
              // 奥から描く。手前の 1 枚が最後に来るように
              .reverse()}
          </div>

          {editing ? (
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setEditing(false)}>
                やめる <kbd className="ml-1 text-xs opacity-60">Esc</kbd>
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                disabled={busy || !draft.trim() || draft.trim() === top?.current?.text}
                onClick={() => void decide("fix", draft.trim())}
              >
                これで直す <kbd className="ml-1 text-xs opacity-60">⌘↵</kbd>
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {/* スマホの幅でも 1 行に収まる長さにする。折り返すと押す場所の高さが揃わない */}
              <button type="button" className="btn btn-secondary whitespace-nowrap px-2" disabled={busy} onClick={() => void decide("keep")}>
                ← そのまま
              </button>
              <button type="button" className="btn btn-secondary whitespace-nowrap px-2" disabled={busy} onClick={startEditing}>
                ↑ 直す
              </button>
              <button
                type="button"
                className="btn btn-primary whitespace-nowrap px-2"
                disabled={busy || !candidate}
                onClick={() => candidate && void decide("fix", candidate)}
              >
                候補に →
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <button type="button" className="underline disabled:no-underline disabled:opacity-40" disabled={history.length === 0 || busy} onClick={() => void undo()}>
              ひとつ戻る（Z）
            </button>
            <span>Space でもう一度聞く</span>
            <button type="button" className="underline disabled:no-underline disabled:opacity-40" disabled={deck.length < 2 || busy} onClick={skip}>
              あとで（S）
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CardBody({
  card,
  candidate,
  choice,
  onChoose,
  editing,
  draft,
  onDraft,
  onReplay,
  swipe,
}: {
  card: ReviewCard;
  candidate: string | null;
  choice: number;
  onChoose: (index: number) => void;
  editing: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onReplay: () => void;
  swipe: number;
}) {
  const current = card.current;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="tabular-nums">{formatClock(current?.start ?? card.start)}</span>
        {current?.speaker && <span>{current.speaker}</span>}
        {card.reopened && <span className="badge badge-warning">取り直しで戻ってきました</span>}
        {/* 払っている向きで、何が起きるかを見せる */}
        {swipe > 40 && candidate && <span className="badge badge-success ml-auto">候補にする</span>}
        {swipe < -40 && <span className="badge badge-default ml-auto">そのまま</span>}
        <button type="button" className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={onReplay}>
          ▶ 聞く
        </button>
      </div>

      {card.before.length > 0 && (
        <p className="text-sm leading-relaxed text-[var(--color-text-faint)]">{card.before.join(" ")}</p>
      )}

      {editing ? (
        <textarea
          className="input min-h-28 w-full text-base leading-relaxed"
          value={draft}
          autoFocus
          onChange={(e) => onDraft(e.target.value)}
        />
      ) : (
        <p className="text-lg leading-relaxed">
          {current ? (
            <LineWithDiff current={current.text} candidate={candidate} />
          ) : (
            <span className="text-[var(--color-text-muted)]">この時刻の行が見つかりません</span>
          )}
        </p>
      )}

      {card.after.length > 0 && (
        <p className="text-sm leading-relaxed text-[var(--color-text-faint)]">{card.after.join(" ")}</p>
      )}

      {card.candidates.length > 1 && !editing && (
        <div className="flex flex-wrap gap-1">
          {card.candidates.map((text, index) => (
            <button
              key={text}
              type="button"
              className={`badge ${index === choice ? "badge-accent" : "badge-default"}`}
              onClick={() => onChoose(index)}
            >
              {index + 1}. {current ? diffParts(current.text, text).added || "（削る）" : text}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] pt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
        {card.reopened && card.resolution && (
          <p className="mb-1 text-[var(--color-warning)]">
            前は{card.resolution.action === "fix" ? "こう直しました" : "この形で正しいと確認しました"}
            ：「{card.resolution.text}」
          </p>
        )}
        <p>{card.reason || "機械が引っかかった行です"}</p>
        {card.whisper && <p className="mt-1">校正前の音声認識：「{card.whisper}」</p>}
      </div>
    </div>
  );
}
