import { describe, it, expect } from "vitest";
import {
  mergeSegments,
  applyCorrections,
  postProcess,
  DEFAULT_MERGE_OPTIONS,
} from "../services/transcript-postprocess";
import type { TranscriptSegment } from "../types";

/**
 * テスト用ヘルパー: セグメントを簡潔に組み立てる
 */
function seg(
  start: number,
  end: number,
  text: string,
  speaker?: string
): TranscriptSegment {
  return speaker === undefined
    ? { start, end, text }
    : { start, end, text, speaker };
}

describe("mergeSegments", () => {
  it("同一話者の連続セグメントを統合する", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(2, 4, "いい天気ですね", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      start: 0,
      end: 4,
      text: "今日はいい天気ですね",
      speaker: "あずま",
    });
  });

  it("話者が変わったら統合しない", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(2, 4, "そうですね", "鉄塔"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe("あずま");
    expect(result[1].speaker).toBe("鉄塔");
  });

  it("間が空きすぎていたら同一話者でも統合しない", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(10, 12, "話は変わりますが", "あずま"),
    ];

    const result = mergeSegments(segments, { maxGapSec: 2 });

    expect(result).toHaveLength(2);
  });

  it("統合後の長さが上限を超える場合は分けたままにする", () => {
    const segments = [
      seg(0, 20, "長い話", "あずま"),
      seg(20, 40, "さらに長い話", "あずま"),
    ];

    const result = mergeSegments(segments, { maxDurationSec: 30 });

    expect(result).toHaveLength(2);
  });

  it("統合後の文字数が上限を超える場合は分けたままにする", () => {
    const segments = [
      seg(0, 2, "あ".repeat(80), "あずま"),
      seg(2, 4, "い".repeat(80), "あずま"),
    ];

    const result = mergeSegments(segments, { maxChars: 150 });

    expect(result).toHaveLength(2);
  });

  it("3つ以上の連続セグメントをまとめて統合する", () => {
    const segments = [
      seg(0, 2, "一つ目", "あずま"),
      seg(2, 4, "二つ目", "あずま"),
      seg(4, 6, "三つ目", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("一つ目二つ目三つ目");
    expect(result[0].end).toBe(6);
  });

  it("話者未判定のセグメント同士は統合する", () => {
    const segments = [seg(0, 2, "前半"), seg(2, 4, "後半")];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("前半後半");
    expect(result[0].speaker).toBeUndefined();
  });

  it("片方だけ話者未判定なら統合しない", () => {
    const segments = [seg(0, 2, "前半", "あずま"), seg(2, 4, "後半")];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(2);
  });

  it("英単語同士が隣接する場合は空白を入れる", () => {
    const segments = [
      seg(0, 2, "Claude", "あずま"),
      seg(2, 4, "Code の話", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result[0].text).toBe("Claude Code の話");
  });

  it("日本語同士は空白を入れずに繋ぐ", () => {
    const segments = [
      seg(0, 2, "文字起こしの", "あずま"),
      seg(2, 4, "話をします", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result[0].text).toBe("文字起こしの話をします");
  });

  it("enabled: false なら何も統合しない", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(2, 4, "いい天気ですね", "あずま"),
    ];

    const result = mergeSegments(segments, { enabled: false });

    expect(result).toHaveLength(2);
  });

  it("空の入力を扱える", () => {
    expect(mergeSegments([])).toEqual([]);
  });

  it("入力のセグメントを書き換えない", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(2, 4, "いい天気ですね", "あずま"),
    ];

    mergeSegments(segments);

    expect(segments[0].text).toBe("今日は");
    expect(segments[0].end).toBe(2);
    expect(segments).toHaveLength(2);
  });

  it("同時発話は単独の発話と統合しない", () => {
    // 番組冒頭で 2 人が声を揃える区間は、直前の単独発話とは別のブロックにする
    const segments = [
      seg(0, 2, "特になし", "鉄塔"),
      seg(2, 4, "Image Cast", "あずま・鉄塔"),
      seg(4, 6, "おはようございます", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(3);
    expect(result[1].speaker).toBe("あずま・鉄塔");
  });

  it("同時発話が続く場合は統合する", () => {
    const segments = [
      seg(0, 2, "Image", "あずま・鉄塔"),
      seg(2, 4, "Cast", "あずま・鉄塔"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Image Cast");
  });

  it("既定では間の長さを条件にしない", () => {
    expect(DEFAULT_MERGE_OPTIONS.enabled).toBe(true);
    expect(DEFAULT_MERGE_OPTIONS.maxGapSec).toBeNull();
    expect(DEFAULT_MERGE_OPTIONS.maxDurationSec).toBe(10);
  });

  it("maxGapSec が null なら間が空いていても統合する", () => {
    const segments = [
      seg(0, 2, "今日は", "あずま"),
      seg(8, 9, "話は変わりますが", "あずま"),
    ];

    const result = mergeSegments(segments, { maxGapSec: null });

    expect(result).toHaveLength(1);
    expect(result[0].end).toBe(9);
  });
});

describe("postProcess", () => {
  it("language を保ったままセグメントを後処理する", () => {
    const data = {
      language: "ja",
      segments: [
        seg(0, 2, "今日は", "あずま"),
        seg(2, 4, "いい天気ですね", "あずま"),
      ],
    };

    const result = postProcess(data);

    expect(result.language).toBe("ja");
    expect(result.segments).toHaveLength(1);
  });

  it("統合を無効にできる", () => {
    const data = {
      language: "ja",
      segments: [
        seg(0, 2, "今日は", "あずま"),
        seg(2, 4, "いい天気ですね", "あずま"),
      ],
    };

    const result = postProcess(data, { merge: { enabled: false } });

    expect(result.segments).toHaveLength(2);
  });
});

describe("applyCorrections", () => {
  it("辞書に従って置換する", () => {
    const segments = [seg(0, 2, "テトです。", "鉄塔")];

    const { segments: result } = applyCorrections(segments, [
      { from: "テト", to: "鉄塔", enabled: true },
    ]);

    expect(result[0].text).toBe("鉄塔です。");
  });

  it("1 つのセグメント内の複数箇所を置換する", () => {
    const segments = [seg(0, 2, "テトさんとテトさん")];

    const { segments: result, applied } = applyCorrections(segments, [
      { from: "テト", to: "鉄塔", enabled: true },
    ]);

    expect(result[0].text).toBe("鉄塔さんと鉄塔さん");
    expect(applied[0].count).toBe(2);
  });

  it("どのルールが何回効いたか返す", () => {
    const segments = [
      seg(0, 2, "テトです"),
      seg(2, 4, "テッドさん"),
      seg(4, 6, "変換対象なし"),
    ];

    const { applied } = applyCorrections(segments, [
      { from: "テト", to: "鉄塔", enabled: true },
      { from: "テッド", to: "鉄塔", enabled: true },
      { from: "使われないルール", to: "x", enabled: true },
    ]);

    expect(applied).toEqual([
      { from: "テト", to: "鉄塔", count: 1 },
      { from: "テッド", to: "鉄塔", count: 1 },
    ]);
  });

  it("無効なルールは適用しない", () => {
    const segments = [seg(0, 2, "テトです")];

    const { segments: result, applied } = applyCorrections(segments, [
      { from: "テト", to: "鉄塔", enabled: false },
    ]);

    expect(result[0].text).toBe("テトです");
    expect(applied).toEqual([]);
  });

  it("ルールは登録順に適用される", () => {
    const segments = [seg(0, 2, "AAA")];

    const { segments: result } = applyCorrections(segments, [
      { from: "AAA", to: "BBB", enabled: true },
      { from: "BBB", to: "CCC", enabled: true },
    ]);

    expect(result[0].text).toBe("CCC");
  });

  it("空の from は無視する", () => {
    const segments = [seg(0, 2, "テトです")];

    const { segments: result, applied } = applyCorrections(segments, [
      { from: "", to: "x", enabled: true },
    ]);

    expect(result[0].text).toBe("テトです");
    expect(applied).toEqual([]);
  });

  it("入力のセグメントを書き換えない", () => {
    const segments = [seg(0, 2, "テトです")];

    applyCorrections(segments, [{ from: "テト", to: "鉄塔", enabled: true }]);

    expect(segments[0].text).toBe("テトです");
  });

  it("話者と時刻は保たれる", () => {
    const segments = [seg(1.5, 3.5, "テトです", "鉄塔")];

    const { segments: result } = applyCorrections(segments, [
      { from: "テト", to: "鉄塔", enabled: true },
    ]);

    expect(result[0]).toMatchObject({ start: 1.5, end: 3.5, speaker: "鉄塔" });
  });
});

describe("postProcess with corrections", () => {
  it("統合してから置換する", () => {
    // セグメントをまたいで分断された誤字も、統合後なら 1 つの文字列として拾える
    const data = {
      language: "ja",
      segments: [seg(0, 2, "テッ", "鉄塔"), seg(2, 4, "トです", "鉄塔")],
    };

    const result = postProcess(data, {
      corrections: [{ from: "テット", to: "鉄塔", enabled: true }],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("鉄塔です");
  });
});
