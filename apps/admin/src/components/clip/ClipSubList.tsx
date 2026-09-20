import { useRef } from "react";
import type { ClipDraft, ClipDraftSub } from "../../lib/api";
import type { GlyphTable } from "../../lib/clipGlyphs";
import type { Edge, SpanGroup, SubProblem } from "../../lib/clipEdits";
import {
  gapAfter,
  insertAfter,
  isEdited,
  mergeWithPrevious,
  nudgeEdge,
  removeInserted,
  setGroupGap,
  spanGroups,
  splitSub,
  stepEdge,
  toRows,
  toggleGroup,
} from "../../lib/clipEdits";

/**
 * 字幕を、AI が選んだまとまりごとに、鳴らす順で並べる。文字はその場で直す。改行が
 * そのまま画面の行になる。
 *
 * まとまりの端もここで動かす。伸ばした先にどの字幕が入ってくるのかを、押す前に
 * ボタンの上で見せる。繋いだあとの帯の上ではそれが見えない。
 */

interface Props {
  draft: ClipDraft;
  table: GlyphTable;
  problems: SubProblem[];
  currentId: string | null;
  disabled: boolean;
  onChange: (draft: ClipDraft) => void;
  /** 字幕の頭へ飛ぶ。時刻は元の音声の上の秒 */
  onSeekSource: (t: number) => void;
}

const NUDGE = 0.02;

const firstChar = (s: ClipDraftSub) => (s.chars.length ? s.chars[0] : s.start);

export function ClipSubList({ draft, table, problems, currentId, disabled, onChange, onSeekSource }: Props) {
  const patch = (id: string, change: Partial<ClipDraftSub>) =>
    onChange({ ...draft, subs: draft.subs.map((s) => (s.id === id ? { ...s, ...change } : s)) });
  const apply = (next: ClipDraft | null) => next && onChange(next);

  return (
    <div className="space-y-4">
      {spanGroups(draft).map((group) => {
        const subs = draft.subs.filter((s) =>
          group.spans.some((sp) => firstChar(s) >= sp.start && firstChar(s) < sp.end)
        );
        return (
          <section key={group.id} className="card" style={{ opacity: group.off ? 0.45 : 1 }}>
            <GroupHeader
              draft={draft}
              group={group}
              disabled={disabled}
              onToggle={() => apply(toggleGroup(draft, group.id))}
              onGap={(gap) => apply(setGroupGap(draft, group.id, gap))}
            />
            {!group.off && !disabled && (
              <EdgeControls draft={draft} group={group} edge="head" onChange={onChange} />
            )}
            <div className="divide-y divide-[var(--color-border)]">
              {subs.map((sub) => {
                const i = draft.subs.indexOf(sub);
                return (
                  <SubRow
                    key={sub.id}
                    sub={sub}
                    table={table}
                    color={table.metrics.speakers[sub.speaker] ?? table.metrics.unknownSpeaker}
                    current={sub.id === currentId}
                    problems={problems.filter((p) => p.subId === sub.id)}
                    disabled={disabled || group.off}
                    canMerge={i > 0 && sub.of !== "" && draft.subs[i - 1].of !== "" && subs.includes(draft.subs[i - 1])}
                    canInsert={gapAfter(draft, sub.id) !== null}
                    onSeek={() => onSeekSource(firstChar(sub))}
                    onText={(text) => patch(sub.id, { rows: toRows(text) })}
                    onSkip={() => patch(sub.id, { skip: !sub.skip })}
                    onRevert={() => patch(sub.id, { rows: [sub.of] })}
                    onSplit={(at) => apply(splitSub(draft, sub.id, at))}
                    onMerge={() => apply(mergeWithPrevious(draft, sub.id))}
                    onInsert={() => apply(insertAfter(draft, sub.id, sub.speaker))}
                    onRemove={() => apply(removeInserted(draft, sub.id))}
                  />
                );
              })}
            </div>
            {!group.off && !disabled && (
              <EdgeControls draft={draft} group={group} edge="tail" onChange={onChange} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function GroupHeader({
  draft,
  group,
  disabled,
  onToggle,
  onGap,
}: {
  draft: ClipDraft;
  group: SpanGroup;
  disabled: boolean;
  onToggle: () => void;
  onGap: (gap: number | null) => void;
}) {
  const active = group.spans.filter((s) => !s.off);
  const last = active[active.length - 1] ?? group.spans[group.spans.length - 1];
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-secondary">
      <span className="min-w-0 flex-1">{group.note ?? "（メモなし）"}</span>
      {!group.off && (
        <label className="flex items-center gap-1 whitespace-nowrap" title="このまとまりのあとに挟む間（秒）">
          あとの間
          <input
            type="number"
            className="input w-16 py-0.5 text-xs"
            step={0.05}
            min={0}
            max={5}
            disabled={disabled}
            value={last.gap ?? draft.gap}
            onChange={(e) => onGap(e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>
      )}
      {!disabled && (
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onToggle}>
          {group.off ? "戻す" : "外す"}
        </button>
      )}
    </div>
  );
}

/** まとまりの端。字幕 1 枚ぶん伸び縮みさせ、そのうえで少し寄せる */
function EdgeControls({
  draft,
  group,
  edge,
  onChange,
}: {
  draft: ClipDraft;
  group: SpanGroup;
  edge: Edge;
  onChange: (d: ClipDraft) => void;
}) {
  const grown = stepEdge(draft, group.id, edge, true);
  const shrunk = stepEdge(draft, group.id, edge, false);
  const earlier = nudgeEdge(draft, group.id, edge, -NUDGE);
  const later = nudgeEdge(draft, group.id, edge, NUDGE);

  // 伸ばすと入ってくる字幕。押す前に見せる
  const active = group.spans.filter((s) => !s.off);
  const span = edge === "head" ? active[0] : active[active.length - 1];
  const incoming =
    grown &&
    (edge === "head"
      ? [...draft.subs].reverse().find((s) => firstChar(s) < span.start)
      : draft.subs.find((s) => firstChar(s) > span.end));

  const tool = "btn btn-ghost px-2 py-1 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1 bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs text-secondary">
      <span className="w-6 shrink-0">{edge === "head" ? "頭" : "尻"}</span>
      <button type="button" className={`${tool} min-w-0 max-w-full truncate`} disabled={!grown} onClick={() => grown && onChange(grown)}>
        {edge === "head" ? "↑ 前の枚を入れる" : "↓ 次の枚を入れる"}
        {incoming && <span className="ml-1 opacity-70">「{incoming.rows.join("") || incoming.of}」</span>}
      </button>
      <button type="button" className={tool} disabled={!shrunk} onClick={() => shrunk && onChange(shrunk)}>
        {edge === "head" ? "頭の枚を外す" : "尻の枚を外す"}
      </button>
      <span className="ml-auto flex items-center gap-1" title="端を 0.02 秒ずつ寄せる。隣の字幕の読み上げには食い込めない">
        <button type="button" className={tool} disabled={!earlier} onClick={() => earlier && onChange(earlier)}>
          −
        </button>
        <span className="tabular-nums">{(edge === "head" ? span.start : span.end).toFixed(2)}</span>
        <button type="button" className={tool} disabled={!later} onClick={() => later && onChange(later)}>
          ＋
        </button>
      </span>
    </div>
  );
}

interface RowProps {
  sub: ClipDraftSub;
  table: GlyphTable;
  color: number[];
  current: boolean;
  problems: SubProblem[];
  disabled: boolean;
  canMerge: boolean;
  canInsert: boolean;
  onSeek: () => void;
  onText: (text: string) => void;
  onSkip: () => void;
  onRevert: () => void;
  onSplit: (at: number) => void;
  onMerge: () => void;
  onInsert: () => void;
  onRemove: () => void;
}

function SubRow(p: RowProps) {
  const { sub, table } = p;
  const area = useRef<HTMLTextAreaElement>(null);
  const edited = sub.of !== "" && isEdited(sub);
  const maxEm = table.metrics.maxEm;

  /** カーソルの位置を、改行を除いた文字の上での位置（コードポイント）に直す */
  const caret = () => {
    const el = area.current;
    if (!el) return 0;
    return [...el.value.slice(0, el.selectionStart).replace(/\n/g, "")].length;
  };

  const tool = "btn btn-ghost px-2 py-1 text-xs";

  return (
    <div
      className="p-3 transition-opacity"
      style={{
        borderLeft: `3px solid ${p.current ? `rgb(${p.color.join(",")})` : "transparent"}`,
      }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={p.onSeek}
          className="w-10 shrink-0 pt-1.5 text-left text-xs tabular-nums text-secondary hover:underline"
        >
          {formatTime(sub.start)}
        </button>

        <div className="min-w-0 flex-1">
          <textarea
            ref={area}
            className={`input w-full resize-none text-sm ${sub.skip ? "line-through opacity-50" : ""}`}
            rows={Math.max(1, sub.rows.length)}
            value={sub.rows.join("\n")}
            disabled={p.disabled || sub.skip}
            onChange={(e) => p.onText(e.target.value)}
          />

          {/* 行ごとの幅。上限に対してどこまで来ているかを、打ちながら見られるようにする */}
          {!sub.skip && (
            <div className="mt-1 space-y-0.5">
              {sub.rows.map((row, i) => {
                const em = table.rowEm(row);
                const over = em > maxEm;
                return (
                  <div key={i} className="h-1 w-full overflow-hidden rounded bg-[var(--color-bg-hover)]">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.min(100, (em / maxEm) * 100)}%`,
                        background: over ? "var(--color-error)" : "var(--color-text-secondary)",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
            <span style={{ color: `rgb(${p.color.join(",")})` }}>{sub.speaker || "（話者不明）"}</span>
            {sub.of === "" && <span>足した字幕</span>}
            {edited && (
              <span>
                元の文字: {sub.of}
                {!p.disabled && (
                  <button type="button" className="ml-2 underline" onClick={p.onRevert}>
                    戻す
                  </button>
                )}
              </span>
            )}
          </div>

          {p.problems.map((pr, i) => (
            <p key={i} className="mt-1 text-xs text-error">
              {pr.message}
            </p>
          ))}
        </div>
      </div>

      {!p.disabled && (
        <div className="mt-2 flex flex-wrap gap-1 pl-13">
          <button type="button" className={tool} onClick={p.onSkip}>
            {sub.skip ? "出す" : "出さない"}
          </button>
          {sub.of !== "" && (
            <button
              type="button"
              className={tool}
              disabled={edited || sub.skip}
              title={edited ? "文字を直した枚は割れません。戻してから割ってください" : "カーソルの位置で 2 枚に割る"}
              onClick={() => p.onSplit(caret())}
            >
              ここで割る
            </button>
          )}
          <button type="button" className={tool} disabled={!p.canMerge} onClick={p.onMerge}>
            前と繋ぐ
          </button>
          <button
            type="button"
            className={tool}
            disabled={!p.canInsert}
            title={p.canInsert ? "" : "次の枚までの隙間がありません"}
            onClick={p.onInsert}
          >
            後ろに足す
          </button>
          {sub.of === "" && (
            <button type="button" className={tool} onClick={p.onRemove}>
              取り除く
            </button>
          )}
        </div>
      )}
    </div>
  );
}
