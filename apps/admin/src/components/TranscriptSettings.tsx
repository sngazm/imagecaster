import { useState } from "react";
import { api } from "../lib/api";
import type {
  BackchannelSettings,
  CorrectionProposal,
  CorrectionRule,
  SpeakerTrackAssignment,
  TranscriptPostProcessSettings,
} from "../lib/api";

interface Props {
  value: TranscriptPostProcessSettings;
  onSaved: (settings: TranscriptPostProcessSettings) => void;
}

const DEFAULT_MERGE = {
  enabled: true,
  maxGapSec: null,
  maxDurationSec: 10,
  maxChars: 200,
};

const DEFAULT_BACKCHANNEL: BackchannelSettings = {
  enabled: true,
  units: ["うん", "はい", "そう", "ええ", "へえ", "へー", "ああ", "あー", "なるほど"],
  maxRepeat: 3,
  dropStandalone: true,
  standalonePhrases: [
    "はい", "うん", "ええ", "ああ", "あー", "うーん", "ふーん", "へー", "へえ",
    "なるほど", "そう", "そうそう", "そうですね", "そうですか", "そうなんですね",
    "確かに", "確かにね", "はいはい", "うんうん", "そうそうそう",
    "はいはいはい", "うんうんうん", "なるほどね", "そうなんだ",
  ],
};

export function TranscriptSettings({ value, onSaved }: Props) {
  const [draft, setDraft] = useState<TranscriptPostProcessSettings>({
    speakerDefaults: value.speakerDefaults ?? [],
    merge: { ...DEFAULT_MERGE, ...value.merge },
    corrections: value.corrections ?? [],
    backchannel: { ...DEFAULT_BACKCHANNEL, ...value.backchannel },
    simultaneousUntilSec: value.simultaneousUntilSec ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [proposals, setProposals] = useState<CorrectionProposal[]>(
    value.proposals ?? []
  );
  const [reviewing, setReviewing] = useState(false);

  async function decide(
    approve: CorrectionProposal[],
    reject: CorrectionProposal[]
  ): Promise<void> {
    setReviewing(true);
    setError(null);
    try {
      await api.reviewProposals(approve, reject);
      const decided = new Set([...approve, ...reject].map((p) => `${p.from}\u0000${p.to}`));
      setProposals((current) =>
        current.filter((p) => !decided.has(`${p.from}\u0000${p.to}`))
      );

      // 承認したものは辞書に入るので、画面の一覧も合わせる
      if (approve.length > 0) {
        const settings = await api.getSettings();
        if (settings.transcriptPostProcess) {
          setDraft((d) => ({
            ...d,
            corrections: settings.transcriptPostProcess!.corrections,
          }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提案の反映に失敗しました");
    } finally {
      setReviewing(false);
    }
  }

  const backchannel = draft.backchannel ?? DEFAULT_BACKCHANNEL;

  function update(patch: Partial<TranscriptPostProcessSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateSpeaker(index: number, patch: Partial<SpeakerTrackAssignment>) {
    update({
      speakerDefaults: draft.speakerDefaults.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry
      ),
    });
  }

  function updateCorrection(index: number, patch: Partial<CorrectionRule>) {
    update({
      corrections: draft.corrections.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule
      ),
    });
  }

  function addSpeaker() {
    const nextTrack =
      draft.speakerDefaults.reduce((max, entry) => Math.max(max, entry.track), 0) + 1;
    update({
      speakerDefaults: [...draft.speakerDefaults, { track: nextTrack, label: "" }],
    });
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updated = await api.updateSettings({ transcriptPostProcess: draft });
      if (updated.transcriptPostProcess) {
        setDraft(updated.transcriptPostProcess);
        onSaved(updated.transcriptPostProcess);
      }
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleReprocessAll() {
    if (
      !confirm(
        "公開済みの全エピソードの文字起こしを作り直します。\n" +
          "文字起こし自体はやり直さないので音声の再処理は発生しませんが、" +
          "件数によっては反映に時間がかかります。よろしいですか?"
      )
    ) {
      return;
    }

    setReprocessing(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.reprocessAllTranscripts();
      setMessage(
        `${result.queued} 件を再処理待ちに登録しました。順次反映されます。`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "再処理の登録に失敗しました");
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {message && (
        <div className="card p-4 border-[var(--color-success)]! bg-[var(--color-success-muted)]">
          <p className="text-sm text-[var(--color-success)]">{message}</p>
        </div>
      )}
      {error && (
        <div className="card p-4 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {/* 話者の既定割り当て */}
      <div className="card">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
          話者トラックの既定
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          話者ごとに分かれた音声トラックの zip をアップロードしたとき、どのトラックを
          誰の声として扱うかの既定値です。ゲスト回など構成が変わる場合はエピソードごとに
          上書きできます。名前を空にしたトラックは BGM
          などの非発話として話者判定から外れます。
        </p>

        <div className="space-y-2">
          {draft.speakerDefaults.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)] w-16 flex-shrink-0">
                トラック
              </span>
              <div className="w-20 flex-shrink-0">
                <input
                  type="number"
                  min={1}
                  value={entry.track}
                  onChange={(e) =>
                    updateSpeaker(index, { track: parseInt(e.target.value, 10) || 1 })
                  }
                  className="input"
                />
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={entry.label ?? ""}
                  onChange={(e) => updateSpeaker(index, { label: e.target.value })}
                  placeholder="話者名（空欄で BGM 扱い）"
                  className="input"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  update({
                    speakerDefaults: draft.speakerDefaults.filter((_, i) => i !== index),
                  })
                }
                className="btn btn-ghost text-[var(--color-error)] flex-shrink-0 whitespace-nowrap"
              >
                削除
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={addSpeaker} className="btn btn-ghost mt-3">
          トラックを追加
        </button>

        <div className="border-t border-[var(--color-border)] mt-4 pt-4">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.simultaneousUntilSec !== null}
              onChange={(e) =>
                update({ simultaneousUntilSec: e.target.checked ? 30 : null })
              }
            />
            <span className="text-sm">
              冒頭で 2 人が声を揃える箇所がある
              <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                指定した範囲の中で声が重なっている区間を「あずま・鉄塔」のような
                連名で表示します。本編の会話中は相槌のかぶりや同時に笑った箇所まで
                拾ってしまうため、範囲の外では検出しません。
              </span>
            </span>
          </label>

          {draft.simultaneousUntilSec !== null && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-[var(--color-text-secondary)]">冒頭から</span>
              <div className="w-24">
                <input
                  type="number"
                  min={1}
                  value={draft.simultaneousUntilSec}
                  onChange={(e) =>
                    update({
                      simultaneousUntilSec: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  className="input"
                />
              </div>
              <span className="text-sm text-[var(--color-text-secondary)]">秒まで</span>
            </div>
          )}
        </div>
      </div>

      {/* 校正の提案 */}
      {proposals.length > 0 && (
        <div className="card">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
            校正からの提案
            <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
              {proposals.length} 件
            </span>
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mb-4">
            文字起こしを読んだ Claude が見つけた誤りのうち、番組全体に効きそうなものです。
            <strong>承認するまで辞書には入りません。</strong>
            辞書は公開済みの全エピソードに効くので、目を通してから入れてください。
          </p>

          <ul className="space-y-2">
            {proposals.map((proposal) => (
              <li
                key={`${proposal.from}-${proposal.to}`}
                className="flex flex-wrap items-baseline gap-2 border-b border-[var(--color-border)] pb-2 last:border-0"
              >
                <span className="font-mono text-xs">{proposal.from}</span>
                <span className="text-xs text-[var(--color-text-muted)]">→</span>
                <span className="font-mono text-xs font-medium">{proposal.to}</span>

                {proposal.note && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    （{proposal.note}）
                  </span>
                )}

                <span className="text-xs text-[var(--color-text-muted)]">
                  #{proposal.episodeId}
                </span>

                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-2"
                    disabled={reviewing}
                    onClick={() => decide([proposal], [])}
                  >
                    辞書に入れる
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--color-text-muted)] hover:underline"
                    disabled={reviewing}
                    onClick={() => decide([], [proposal])}
                  >
                    見送る
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn btn-secondary mt-4 text-xs"
            disabled={reviewing}
            onClick={() => decide([], proposals)}
          >
            すべて見送る
          </button>
        </div>
      )}

      {/* 相槌 */}
      <div className="card">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
          相槌
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          実際に言っていても、文字で読むと相槌が並ぶだけになる箇所を整理します。
        </p>

        <div className="space-y-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={backchannel.dropStandalone}
              onChange={(e) =>
                update({
                  backchannel: { ...backchannel, dropStandalone: e.target.checked },
                })
              }
            />
            <span className="text-sm">
              相槌だけの行を消す
              <span className="block text-xs text-[var(--color-text-muted)] mt-0.5">
                「はい。」「なるほど。」のようにそれだけで 1 行になっているものが対象です。
                「なんか、」のように読点で終わるもの（次の発話の一部）と、
                問いかけの直後にあるもの（返事）は残します。
              </span>
            </span>
          </label>

          <div>
            <label className="label">繰り返しを抑える回数</label>
            <input
              type="number"
              min={2}
              className="input w-32"
              value={backchannel.maxRepeat}
              onChange={(e) =>
                update({
                  backchannel: {
                    ...backchannel,
                    maxRepeat: Math.max(2, parseInt(e.target.value, 10) || 2),
                  },
                })
              }
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              「うんうんうんうんうん」を、この回数で止めます。
            </p>
          </div>

          <div>
            <label className="label">消す対象の語</label>
            <textarea
              className="input font-mono text-xs"
              rows={4}
              value={backchannel.standalonePhrases.join("、")}
              onChange={(e) =>
                update({
                  backchannel: {
                    ...backchannel,
                    standalonePhrases: e.target.value
                      .split(/[、,\n]/)
                      .map((p) => p.trim())
                      .filter((p) => p !== ""),
                  },
                })
              }
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              読点区切り。ここに完全一致する行だけを消します。
            </p>
          </div>
        </div>
      </div>

      {/* セグメント統合 */}
      <div className="card">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
          セグメントの統合
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          同じ人の続きの発話がいくつにも割れて表示されるのを防ぎます。
        </p>

        <label className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={draft.merge.enabled}
            onChange={(e) =>
              update({ merge: { ...draft.merge, enabled: e.target.checked } })
            }
          />
          <span className="text-sm">同じ話者の連続したセグメントをまとめる</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">まとめる最大の長さ（秒）</label>
            <input
              type="number"
              min={1}
              value={draft.merge.maxDurationSec}
              onChange={(e) =>
                update({
                  merge: {
                    ...draft.merge,
                    maxDurationSec: parseInt(e.target.value, 10) || 1,
                  },
                })
              }
              className="input"
            />
          </div>
          <div>
            <label className="label">まとめる最大の文字数</label>
            <input
              type="number"
              min={1}
              value={draft.merge.maxChars}
              onChange={(e) =>
                update({
                  merge: { ...draft.merge, maxChars: parseInt(e.target.value, 10) || 1 },
                })
              }
              className="input"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4">
          <input
            type="checkbox"
            checked={draft.merge.maxGapSec === null}
            onChange={(e) =>
              update({
                merge: { ...draft.merge, maxGapSec: e.target.checked ? null : 2 },
              })
            }
          />
          <span className="text-sm">発話の間が空いていてもまとめる</span>
        </label>

        {draft.merge.maxGapSec !== null && (
          <div className="mt-3 max-w-32">
            <label className="label">間がこの秒数を超えたら分ける</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={draft.merge.maxGapSec}
              onChange={(e) =>
                update({
                  merge: {
                    ...draft.merge,
                    maxGapSec: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="input"
            />
          </div>
        )}
      </div>

      {/* 誤字の辞書 */}
      <div className="card">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
          誤字の置き換え
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          文字起こしがよく取り違える固有名詞をここで直します。上から順に適用されます。
          一般的な語を対象にすると意図しない箇所まで置き換わるので、
          「テトです」のように前後を含めた形にしておくと安全です。
        </p>

        <div className="space-y-2">
          {draft.corrections.map((rule, index) => (
            <div
              key={index}
              className="rounded-lg border border-[var(--color-border)] p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => updateCorrection(index, { enabled: e.target.checked })}
                  title="このルールを使う"
                />
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={rule.from}
                    onChange={(e) => updateCorrection(index, { from: e.target.value })}
                    placeholder="誤りやすい表記"
                    className="input"
                  />
                </div>
                <span className="text-[var(--color-text-muted)] flex-shrink-0">→</span>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={rule.to}
                    onChange={(e) => updateCorrection(index, { to: e.target.value })}
                    placeholder="正しい表記"
                    className="input"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      corrections: draft.corrections.filter((_, i) => i !== index),
                    })
                  }
                  className="btn btn-ghost text-[var(--color-error)] flex-shrink-0 whitespace-nowrap"
                >
                  削除
                </button>
              </div>
              <input
                type="text"
                value={rule.note ?? ""}
                onChange={(e) => updateCorrection(index, { note: e.target.value })}
                placeholder="メモ（なぜこのルールを入れたか）"
                className="input text-xs"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            update({
              corrections: [...draft.corrections, { from: "", to: "", enabled: true }],
            })
          }
          className="btn btn-ghost mt-3"
        >
          ルールを追加
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleReprocessAll}
          disabled={reprocessing}
          className="btn btn-secondary"
        >
          {reprocessing ? "登録中..." : "公開済みエピソードに再適用"}
        </button>

        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? "保存中..." : "設定を保存"}
        </button>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        設定を保存しただけでは既存のエピソードは変わりません。過去の分にも反映するには
        「公開済みエピソードに再適用」を実行してください。
      </p>
    </form>
  );
}
