import { describe, it, expect } from "vitest";
import {
  mergeSegments,
  applyCorrections,
  removeHallucinations,
  dropStandaloneBackchannels,
  repairSpeakerBoundaries,
  removeFillers,
  DEFAULT_FILLER_SETTINGS,
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
    // 句点で終わっているので、上限を切れ目にしてよい
    const segments = [
      seg(0, 20, "長い話。", "あずま"),
      seg(20, 40, "さらに長い話。", "あずま"),
    ];

    const result = mergeSegments(segments, { maxDurationSec: 30 });

    expect(result).toHaveLength(2);
  });

  it("統合後の文字数が上限を超える場合は分けたままにする", () => {
    const segments = [
      seg(0, 2, "あ".repeat(79) + "。", "あずま"),
      seg(2, 4, "い".repeat(79) + "。", "あずま"),
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

    // 長い規則から当てるので、報告もその順になる
    expect(applied).toEqual([
      { from: "テッド", to: "鉄塔", count: 1 },
      { from: "テト", to: "鉄塔", count: 1 },
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
  it("文の途中で間も無く話者が変わったら、長く喋っている話者に寄せる", () => {
    // 音量判定のぶれで「多いかもし」「れないけど」が別々の人に割り振られていた
    const result = repairSpeakerBoundaries([
      seg(0, 3, "チームだったら多いかもし", "鉄塔"),
      seg(3, 5, "れないけど、そ", "あずま"),
      seg(5, 8, "こが結構自分で回している。", "鉄塔"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["鉄塔", "鉄塔", "鉄塔"]);
    expect(result.repaired).toBe(1);
  });

  it("短い断片が長い発話を引っ張らない", () => {
    // 0.88秒の「で、そう」が16.9秒の発話を巻き込み、あずまの発言が
    // 丸ごと鉄塔のものになっていた
    const result = repairSpeakerBoundaries([
      seg(933.86, 934.74, "で、そう", "鉄塔"),
      seg(934.74, 951.66, "すると、向こうが提案してきたのが、確認の時間は必要で。", "あずま"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["あずま", "あずま"]);
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

describe("applyCorrections の適用順", () => {
  it("長い規則から先に当てる", () => {
    // 短い規則が先に当たると「バントウ」が「番頭ウ」になり、
    // 「バントウ」の規則が二度と一致しなくなる
    const result = applyCorrections(
      [seg(0, 2, "バントウとバントーとバント。")],
      [
        { from: "バント", to: "番頭", enabled: true },
        { from: "バントウ", to: "番頭", enabled: true },
        { from: "バントー", to: "番頭", enabled: true },
      ]
    );

    expect(result.segments[0].text).toBe("番頭と番頭と番頭。");
  });

  it("並び順に関わらず結果が同じ", () => {
    const rules = [
      { from: "クロード", to: "Claude", enabled: true },
      { from: "クロードコード", to: "Claude Code", enabled: true },
    ];
    const text = "クロードコードとクロード。";

    const forward = applyCorrections([seg(0, 2, text)], rules);
    const backward = applyCorrections([seg(0, 2, text)], [...rules].reverse());

    expect(forward.segments[0].text).toBe("Claude CodeとClaude。");
    expect(backward.segments[0].text).toBe(forward.segments[0].text);
  });
});

describe("繰り返しの相槌を落とす", () => {
  it("対象の語の並びだけで出来た行を落とす", () => {
    // 語形を1つずつ登録していくときりがない
    const result = dropStandaloneBackchannels(
      [
        seg(0, 2, "ふんふんふん。", "鉄塔"),
        seg(2, 4, "うんうんうんうん。", "鉄塔"),
        seg(4, 6, "そうそうそうそうそう。", "あずま"),
      ],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("相槌の語を含むだけの文は残す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 3, "うんうん、それはそうですね。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });

  it("読点で終わる繰り返しは残す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "そうそう、", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });
});

describe("笑い声を落とす", () => {
  it("「ははは。」を落とす", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "ははは。", "あずま"), seg(2, 4, "はぁはぁはぁ。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("1文字の語を並べただけでは本文を消さない", () => {
    // 「は」「へ」は笑い声として登録しているが、文の一部を消してはいけない
    const result = dropStandaloneBackchannels(
      [seg(0, 3, "へえ、それはすごい。", "鉄塔"), seg(3, 5, "はい、わかりました。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(2);
  });
});

describe("否定の相槌も落とす", () => {
  it("「いやいやいやいや。」を落とす", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "いやいやいやいや。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("「いや、」で始まる文は残す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 3, "いや、それは違うと思います。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });
});

describe("区切りを挟んだ相槌も落とす", () => {
  it("読点で区切られた相槌を落とす", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "はい、はい、はい。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("促音で区切られた笑い声を落とす", () => {
    const result = dropStandaloneBackchannels(
      [
        seg(0, 2, "はっはっはっはっ。", "鉄塔"),
        seg(2, 4, "ああ、は、は、は、は。", "鉄塔"),
      ],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("相槌でない繰り返しは残す", () => {
    // 擬音や副詞。意味を持っている
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "バチバチバチバチ。", "あずま"), seg(2, 4, "どんどんどんどん。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(2);
  });

  it("読点で終わる相槌はやはり残す", () => {
    // 次の発話の一部である可能性を優先する
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "はい、はい、", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });
});

describe("統合で生まれた相槌も落とす", () => {
  it("「そう」と「そうそう」が繋がったものを落とす", () => {
    // 統合の前だけで判定すると、繋がって生まれたものが残る
    const result = postProcess({
      language: "ja",
      segments: [
        seg(0, 1, "そう", "あずま"),
        seg(1, 2, "そうそう", "あずま"),
        seg(3, 6, "それで本編です。", "鉄塔"),
      ],
    });

    expect(result.segments.map((s) => s.text)).toEqual(["それで本編です。"]);
  });

  it("統合で本文になったものは残す", () => {
    const result = postProcess({
      language: "ja",
      segments: [
        seg(0, 1, "そう", "あずま"),
        seg(1, 3, "それは面白いですね。", "あずま"),
      ],
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toContain("面白い");
  });
});

describe("問いかけの直後の扱い", () => {
  it("一言の返事は残す", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "行ったことある?", "あずま"), seg(2, 3, "はい。", "鉄塔")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(2);
  });

  it("繰り返しは返事ではなく相槌として落とす", () => {
    // 返事としては1回で足りる。繰り返しは勢いでしかない
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "逆に?", "鉄塔"), seg(2, 3, "そうそうそう", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments.map((s) => s.text)).toEqual(["逆に?"]);
  });

  it("区切りを挟んだ繰り返しも落とす", () => {
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "そうなの?", "鉄塔"), seg(2, 3, "はい、はい、はい。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(1);
  });
});

describe("笑い声の変形も落とす", () => {
  it("「うふふふ。」を落とす", () => {
    // 「ふんふんふん」と言っているものが笑い声として出てくる
    const result = dropStandaloneBackchannels(
      [seg(0, 2, "うふふふ。", "鉄塔"), seg(2, 4, "あはは。", "あずま")],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(0);
  });

  it("1文字の語が本文を消さない", () => {
    const result = dropStandaloneBackchannels(
      [
        seg(0, 3, "あの話は面白かった。", "鉄塔"),
        seg(3, 6, "うん、そうですね、確かに。", "あずま"),
      ],
      DEFAULT_BACKCHANNEL_SETTINGS
    );

    expect(result.segments).toHaveLength(2);
  });
});


describe("removeFillers", () => {
  const settings = DEFAULT_FILLER_SETTINGS;

  function clean(text: string): string {
    return removeFillers([seg(0, 3, text, "あずま")], settings).segments[0].text;
  }

  it("読点で挟まれた言いよどみを落とす", () => {
    expect(
      clean("AIが、その、効率化するってことを、あの、ゴールにしちゃうと、僕がその")
    ).toBe("AIが効率化するってことをゴールにしちゃうと、僕がその");
  });

  it("行頭の言いよどみを落とす", () => {
    expect(clean("なんか、そうやって、なんか、")).toBe("そうやって、");
  });

  it("続けて並んでいるものをまとめて落とす", () => {
    // 「なんか」は格助詞で終わっていないので、切れ目として読点が残る
    expect(clean("なんか、あの、あとなんか、こう、話が飛ぶんですけど。")).toBe(
      "あとなんか、話が飛ぶんですけど。"
    );
  });

  it("接続詞の重なりを1つにする", () => {
    expect(clean("で、で、Asanaっていうツールを通じて。")).toBe(
      "で、Asanaっていうツールを通じて。"
    );
  });

  it("意味を持つ語は残す", () => {
    // 読点が付いていないものは、文の一部として働いている
    expect(clean("なんか変だよね。")).toBe("なんか変だよね。");
    expect(clean("その話は面白かった。")).toBe("その話は面白かった。");
    expect(clean("まあまあの出来でした。")).toBe("まあまあの出来でした。");
  });

  it("落とした結果が空になるなら元のまま残す", () => {
    expect(clean("えー、あの、")).toBe("えー、あの、");
  });

  it("何も変わらない文はそのまま", () => {
    expect(clean("これは普通の文です。")).toBe("これは普通の文です。");
  });

  it("enabled: false なら何もしない", () => {
    const result = removeFillers([seg(0, 3, "AIが、その、効率化する")], {
      ...settings,
      enabled: false,
    });

    expect(result.segments[0].text).toBe("AIが、その、効率化する");
  });

  it("時刻と話者は保つ", () => {
    const result = removeFillers([seg(1.5, 3.5, "なんか、本編です。", "鉄塔")], settings);

    expect(result.segments[0]).toMatchObject({ start: 1.5, end: 3.5, speaker: "鉄塔" });
  });
});

describe("言いよどみを落としたあとの読点", () => {
  function clean(text: string): string {
    return removeFillers([seg(0, 3, text)], DEFAULT_FILLER_SETTINGS).segments[0].text;
  }

  it("格助詞で終わるなら読点も落とす", () => {
    // 「AIが」と「効率化する」は直接つながる。読点は言いよどみを挟むために
    // 置かれただけ
    expect(clean("AIが、その、効率化する")).toBe("AIが効率化する");
    expect(clean("ことを、あの、ゴールにする")).toBe("ことをゴールにする");
  });

  it("接続助詞で終わるなら読点を残す", () => {
    // そこが文の切れ目。落とすと「言うしまあ」になって読めなくなる
    expect(clean("とも言うし、なんていうか、まあ一重しく")).toBe(
      "とも言うし、まあ一重しく"
    );
  });

  it("「〜ので、」は切れ目として扱う", () => {
    expect(clean("使ってるんで、その、メッセージとか")).toBe(
      "使ってるんで、メッセージとか"
    );
  });
});

describe("行頭の疑問符の誤付与", () => {
  function clean(text: string): string {
    return removeFillers([seg(0, 3, text)], DEFAULT_FILLER_SETTINGS).segments[0].text;
  }

  it("「え?で、」を落とす", () => {
    // 「えー、で、」と言っているものが「え?で、」になる
    expect(clean("え?で、あと打ち合わせをしたときに。")).toBe(
      "で、あと打ち合わせをしたときに。"
    );
  });

  it("本物の問いかけは残す", () => {
    expect(clean("え?本当にそうなんですか?")).toBe("え?本当にそうなんですか?");
    expect(clean("え?それは知らなかった。")).toBe("え?それは知らなかった。");
  });
});

describe("句読点で終わらない断片の扱い", () => {
  it("わずかな間があっても、断片は塊に含める", () => {
    // 「だ」が別話者と判定され、前後0.1秒の間があるだけで塊が切れ、
    // 「だんだん良くなってきて、だ」「いぶ周りに…」と語が割れていた
    const result = repairSpeakerBoundaries([
      seg(594.98, 596.04, "だんだん良くなってきて、", "あずま"),
      seg(596.14, 597.9, "だ", "鉄塔"),
      seg(597.9, 601.78, "いぶ周りにお勧めできる感じの。", "あずま"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual([
      "あずま",
      "あずま",
      "あずま",
    ]);
  });

  it("句点で終わる相槌は本物として残す", () => {
    // 実データの107件のうち、本物の相槌はすべて句点で終わっていた
    const result = repairSpeakerBoundaries([
      seg(116.4, 116.98, "そうなんですよ。", "あずま"),
      seg(116.98, 117.26, "はい。", "鉄塔"),
      seg(118.4, 120.0, "それでですね。", "あずま"),
    ]);

    expect(result.segments[1].speaker).toBe("鉄塔");
  });

  it("間が空いた断片は別の発話として残す", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 2, "そうなんですよ", "あずま"),
      seg(3, 4, "うん", "鉄塔"),
      seg(5, 7, "それで。", "あずま"),
    ]);

    expect(result.segments[1].speaker).toBe("鉄塔");
  });
});

describe("統合の上限と文の切れ目", () => {
  it("上限に達していても、文の途中なら繋ぐ", () => {
    // 上限をそのまま切れ目にすると語の途中で割れる
    const segments = [
      seg(0, 9, "あ".repeat(190) + "だんだん良くなってきて、だ", "あずま"),
      seg(9, 12, "いぶ周りにお勧めできる感じ。", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("だんだん良くなってきて、だいぶ周りに");
  });

  it("句点で終わっていれば上限で切る", () => {
    const segments = [
      seg(0, 9, "あ".repeat(190) + "ここで終わります。", "あずま"),
      seg(9, 12, "次の話です。", "あずま"),
    ];

    const result = mergeSegments(segments);

    expect(result).toHaveLength(2);
  });
});

describe("長い発話に挟まった相手の一言", () => {
  it("節が切れていれば、別の発話として分ける", () => {
    // あずまの長い話の途中に鉄塔が言葉を挟むことがある。巻き込むと
    // 発言者が入れ替わる
    const result = repairSpeakerBoundaries([
      seg(0, 5, "AIがこんなに発達したのになんで仕事がこんなに大変なんだみたいな", "あずま"),
      seg(5, 7, "話はしてましたけどもね。", "鉄塔"),
      seg(7, 12, "まあ、どうして自分の仕事が今大変なのか。", "あずま"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual([
      "あずま",
      "鉄塔",
      "あずま",
    ]);
  });

  it("語の途中で切れていれば繋ぐ", () => {
    // 音量判定のぶれで割れただけ
    const result = repairSpeakerBoundaries([
      seg(0, 3, "チームだったら多いかもし", "鉄塔"),
      seg(3, 5, "れないけど、そ", "あずま"),
      seg(5, 8, "こが結構自分で回している。", "鉄塔"),
    ]);

    expect(new Set(result.segments.map((s) => s.speaker)).size).toBe(1);
  });

  it("「〜して」で終わっていれば分ける", () => {
    const result = repairSpeakerBoundaries([
      seg(0, 4, "そうやって、なんか、こうして", "鉄塔"),
      seg(4, 8, "大量のスパムメールがインターネットを覆っていくんですね。", "あずま"),
    ]);

    expect(result.segments.map((s) => s.speaker)).toEqual(["鉄塔", "あずま"]);
  });

  it("助詞や活用の途中なら繋ぐ", () => {
    const cases: Array<[string, string]> = [
      ["事できているぞ、という気持ち", "に慣れている"],
      ["みたいな感じで、投", "げてくるとか、"],
      ["で、そう", "すると、向こうが提案してきた。"],
    ];

    for (const [before, after] of cases) {
      const result = repairSpeakerBoundaries([
        seg(0, 3, before, "あずま"),
        seg(3, 6, after, "鉄塔"),
      ]);

      expect(new Set(result.segments.map((s) => s.speaker)).size).toBe(1);
    }
  });
});
