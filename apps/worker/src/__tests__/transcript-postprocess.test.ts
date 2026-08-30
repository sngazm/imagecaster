import { describe, it, expect } from "vitest";
import {
  mergeSegments,
  applyCorrections,
  removeHallucinations,
  dropStandaloneBackchannels,
  repairSpeakerBoundaries,
  postProcess,
  DEFAULT_MERGE_OPTIONS,
  DEFAULT_BACKCHANNEL_SETTINGS,
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
      seg(0, 2, "今日は、", "あずま"),
      seg(2, 4, "いい天気ですね。", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      start: 0,
      end: 4,
      text: "今日は、いい天気ですね。",
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
      seg(0, 2, "一つ目。", "あずま"),
      seg(2, 4, "二つ目。", "あずま"),
      seg(4, 6, "三つ目。", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("一つ目。二つ目。三つ目。");
    expect(result[0].end).toBe(6);
  });

  it("話者が分からないセグメントは統合しない", () => {
    // 誰が喋っているか分からないものをまとめると、別々の話者の発話が
    // 1 つの塊になってしまう
    const segments = [seg(0, 2, "前半。"), seg(2, 4, "後半。")];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(2);
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

  it("句読点で終わっていれば区切りを入れずに繋ぐ", () => {
    const segments = [
      seg(0, 2, "文字起こしの話です。", "あずま"),
      seg(2, 4, "続きを話します。", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result[0].text).toBe("文字起こしの話です。続きを話します。");
  });

  it("句読点が無く間が空いていれば空白で区切る", () => {
    // 句読点を付けない設定で文字起こしされた場合、そのまま繋ぐと別々の発話が
    // 一続きの文に見えてしまう
    const segments = [
      seg(0, 2, "文字起こしの", "あずま"),
      seg(2.5, 4, "話をします", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result[0].text).toBe("文字起こしの 話をします");
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

describe("removeHallucinations", () => {
  const PHRASES = ["ヤンヤン", "ご視聴ありがとうございました"];

  it("セグメント全体が一致すれば落とす", () => {
    const result = removeHallucinations(
      [seg(0, 2, "ヤンヤン"), seg(2, 4, "本編です")],
      PHRASES
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("本編です");
  });

  it("文頭に貼り付いたものを剥がす", () => {
    // 実データではこれが大半だった（883件中831件）
    const result = removeHallucinations(
      [seg(0, 5, "ヤンヤン この仕事体験、なんか全然良くない。")],
      PHRASES
    );

    expect(result.segments[0].text).toBe("この仕事体験、なんか全然良くない。");
  });

  it("文末に付いたものを剥がす", () => {
    const result = removeHallucinations(
      [seg(0, 5, "そうですね。ご視聴ありがとうございました")],
      PHRASES
    );

    expect(result.segments[0].text).toBe("そうですね。");
  });

  it("繰り返し貼り付いていても剥がす", () => {
    const result = removeHallucinations(
      [seg(0, 5, "ヤンヤン ヤンヤン なるほど。")],
      PHRASES
    );

    expect(result.segments[0].text).toBe("なるほど。");
  });

  it("文中に埋もれているものは触らない", () => {
    // 本当にその言葉を喋った可能性があり、前後の文を壊す
    const text = "さっきヤンヤンって言いましたよね。";
    const result = removeHallucinations([seg(0, 5, text)], PHRASES);

    expect(result.segments[0].text).toBe(text);
  });

  it("剥がして空になればセグメントごと落とす", () => {
    const result = removeHallucinations(
      [seg(0, 2, "ヤンヤン。"), seg(2, 4, "本編")],
      PHRASES
    );

    expect(result.segments).toHaveLength(1);
  });

  it("何を落としたか返す", () => {
    const result = removeHallucinations(
      [seg(0, 5, "ヤンヤン なるほど。"), seg(5, 8, "普通の発言")],
      PHRASES
    );

    expect(result.removed).toEqual(["ヤンヤン なるほど。"]);
  });

  it("時刻と話者は保つ", () => {
    const result = removeHallucinations(
      [seg(1.5, 3.5, "ヤンヤン そうですね。", "鉄塔")],
      PHRASES
    );

    expect(result.segments[0]).toMatchObject({
      start: 1.5,
      end: 3.5,
      speaker: "鉄塔",
      text: "そうですね。",
    });
  });
});

describe("dropStandaloneBackchannels", () => {
  const settings = DEFAULT_BACKCHANNEL_SETTINGS;

  it("相槌だけのセグメントを落とす", () => {
    const result = dropStandaloneBackchannels(
      [
        seg(0, 1, "はい。"),
        seg(1, 3, "それで思ったんですけど。"),
        seg(3, 4, "なるほど。"),
      ],
      settings
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("それで思ったんですけど。");
    expect(result.dropped).toEqual(["はい。", "なるほど。"]);
  });

  it("句点が無くても落とす", () => {
    const result = dropStandaloneBackchannels([seg(0, 1, "うん")], settings);

    expect(result.segments).toHaveLength(0);
  });

  it("読点で終わるものは残す", () => {
    // 「なんか、」は相槌ではなく次の発話の一部。消すと文が壊れる
    const result = dropStandaloneBackchannels(
      [seg(0, 1, "なんか、"), seg(1, 3, "そう、"), seg(3, 5, "でも、")],
      settings
    );

    expect(result.segments).toHaveLength(3);
  });

  it("相槌を含むだけの文は残す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 3, "はい、それでいいと思います。")],
      settings
    );

    expect(result.segments).toHaveLength(1);
  });

  it("dropStandalone が false なら何もしない", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 1, "はい。")],
      { ...settings, dropStandalone: false }
    );

    expect(result.segments).toHaveLength(1);
  });

  it("時刻と話者は保つ", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 1, "はい。"), seg(1.5, 3.5, "本編です。", "あずま")],
      settings
    );

    expect(result.segments[0]).toMatchObject({
      start: 1.5,
      end: 3.5,
      speaker: "あずま",
    });
  });
});

describe("postProcess で相槌が整理されること", () => {
  it("繰り返しを抑えてから相槌だけの行を落とす", () => {
    // 順序が逆だと「うんうんうんうんうん」が対象語に一致せず残る
    const data = {
      language: "ja",
      segments: [
        seg(0, 2, "うんうんうんうんうん。", "鉄塔"),
        seg(2, 5, "それでですね。", "あずま"),
      ],
    };

    const result = postProcess(data, { merge: { enabled: false } });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("それでですね。");
  });
});

describe("dropStandaloneBackchannels の返事の扱い", () => {
  it("直前が疑問文なら消さない", () => {
    // 相槌ではなく返事。消すと問いが宙に浮く
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "汚い手?", "あずま"), seg(2, 3, "はい。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(2);
  });

  it("疑問文の直後でなければ消す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "汚い手だった。", "あずま"), seg(2, 3, "はい。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });

  it("疑問文の次が相槌でも、そのまた次の相槌は消す", () => {
    // 残した返事を基準に判定するので、連鎖して残り続けない
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "行った?", "あずま"), seg(2, 3, "はい。", "鉄塔"), seg(3, 4, "うん。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments.map((s) => s.text)).toEqual(["行った?", "はい。"]);
  });
});


describe("repairSpeakerBoundaries", () => {
  it("文の途中で間も無く話者が変わったら、直前の話者に寄せる", () => {
    // 音量判定のぶれで「多いかもし」「れないけど」が別々の人に割り振られていた
    const result = repairSpeakerBoundaries([
      seg(0, 3, "チームだったら多いかもし", "鉄塔"),
      seg(3, 5, "れないけど、そ", "あずま"),
      seg(5, 8, "こが結構自分で回している。", "鉄塔"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["鉄塔", "鉄塔", "鉄塔"]);
    // 2 件目を寄せた時点で 3 件目は同じ話者になるので、数えるのは 1 回
    expect(result.repaired).toBe(1);
  });

  it("句点で終わっていれば本物の交代として残す", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 3, "どう思います。", "あずま"),
      seg(3, 5, "いいと思いますよ。", "鉄塔"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["あずま", "鉄塔"]);
    expect(result.repaired).toBe(0);
  });

  it("読点で終わっていても本物の交代として残す", () => {
    // 読点は文の切れ目。ここでの交代は割り込みでありうる
    const result = repairSpeakerBoundaries([
      seg(0, 3, "それでですね、", "あずま"),
      seg(3, 5, "ちょっといいですか。", "鉄塔"),
    ]);

    expect(result.repaired).toBe(0);
  });

  it("間が空いていれば本物の交代として残す", () => {
    // 人が交代するには間が空く。文の途中でも、間があるなら割り込み
    const result = repairSpeakerBoundaries([
      seg(0, 3, "それでこう思ってて", "あずま"),
      seg(4, 6, "分かります。", "鉄塔"),
    ]);

    expect(result.repaired).toBe(0);
  });

  it("話者が分かっていないものには触らない", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 3, "話者なし"),
      seg(3, 5, "これも話者なし"),
    ]);

    expect(result.repaired).toBe(0);
  });

  it("寄せた話者を基準に、続きも同じ話者へ寄せる", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 2, "あの", "あずま"),
      seg(2, 4, "とき", "鉄塔"),
      seg(4, 6, "の話です。", "あずま"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["あずま", "あずま", "あずま"]);
  });

  it("テキストと時刻はそのまま", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 3, "続く", "あずま"),
      seg(3, 5, "文です。", "鉄塔"),
    ]);

    expect(result.segments[1]).toMatchObject({ start: 3, end: 5, text: "文です。" });
  });
});

describe("postProcess で話者境界が直ってから統合されること", () => {
  it("単語の途中で切れた断片が1つにまとまる", () => {
    // 直す前に統合すると、話者が違うので別々のまま残ってしまう
    const result = postProcess({
      language: "ja",
      segments: [
        seg(0, 3, "今のところそういう感じのスクリーン", "あずま"),
        seg(3, 6, "になっています。", "鉄塔"),
      ],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("今のところそういう感じのスクリーンになっています。");
    expect(result.segments[0].speaker).toBe("あずま");
  });
});
