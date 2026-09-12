#!/usr/bin/env node
/**
 * 公開サイトの文字起こしを読んで、違和感のある箇所を洗い出す。
 *
 * R2 のデータが正しくても、公開サイトのビルドが古ければ読者には古い内容が
 * 見えている。「実装した」「テストが通った」で終わらせず、最終成果物である
 * サイトを読み返すための道具。
 *
 *   node scripts/audit-site.mjs            # 最新6本
 *   node scripts/audit-site.mjs 285 284    # 個別指定
 */

const SITE = process.env.SITE_URL ?? "https://cast.image.club";
const BUCKET = process.env.BUCKET_URL ?? "https://cast-bucket.image.club";

/** Whisper の定番ハルシネーションと、番組で確認済みの誤り */
const BAD_WORDS = [
  "ヤンヤン",
  "ご視聴ありがとう",
  "チャンネル登録",
  "高評価とチャンネル",
  // 空白を認識し直したときに出る定型句。拾い直しが作った可能性がある
  "最後までご覧",
  "字幕視聴者",
  // 出演者名の誤認識
  "テッドです",
  "テトです",
  "さともです",
  "てっとです",
  "佐藤です",
  "鉄道",
  // 固有名詞の誤認識
  "クロードコード",
  "クローズコード",
  "プロードコード",
  "イメージキャスト",
];

/** それ自体がキャメルケースの製品名。空白が落ちているわけではない */
const CAMEL_CASE_NAMES = [
  "YouTube", "GitHub", "JavaScript", "TypeScript", "PostgreSQL", "iPhone",
  "iPad", "macOS", "iOS", "OpenAI", "DaVinci", "InDesign", "SoundCloud",
  "iTerm", "iCloud", "eBay", "PayPal", "LinkedIn", "WordPress",
  "ToDo", "OpenClaw", "OpenAI", "AdGuard", "DaVinci", "McDonald",
];

/**
 * 置換が行き過ぎた形跡
 *
 * 辞書は番組全体に効くので、一般名詞を対象にした規則が入ると被害が広い。
 * 実際に `メール → mail` と `コード → Code` が自動登録され、「メールフォーム」が
 * 「mailフォーム」に、「コードを書く」が「Codeを書く」になった。
 *
 * 日本語の中に英単語が助詞と直結して現れるのは、その兆候になる。
 */
/**
 * 日本語の文字起こしに混じるはずのない文字
 *
 * アラビア文字・キリル文字・ギリシャ文字・ウムラウト付きラテン文字。Whisper が
 * 無音や被りに対して吐く多言語のハルシネーション。#281 で「قطになitorメダ」
 * がそのまま公開されていた。文字起こし側で出た時点で捨てるようにしたが、
 * 経路の取りこぼしに備えてここでも見る
 */
// 乗算記号「×」（U+00D7）と「÷」はラテン文字補助の範囲にあるが日本語の本文に普通に出る
// （#286「3mm×3mm」「15mm×33mm」）ので除く
const FOREIGN_SCRIPT =
  /[\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u06ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u2460-\u24ff\ufffd]/;

// 番組の会話に出てよい英単語。これ以外の英単語が 1 行に 3 つ以上並ぶのは、Whisper が
// 脱線した出力（#281 の取り直しで「wanting to choose」「Geme Auch initial Mach」が
// 公開まで通った）。全部大文字の短い語（AI、NSC、BPM）は略語として除く
const KNOWN_LATIN = new Set(
  [
    "Image", "Cast", "Club", "Claude", "Code", "Opus", "Sonnet", "Haiku", "Asana", "Slack",
    "Gmail", "Google", "Workspace", "tmux", "Ghostty", "iTerm", "Codex", "Hugging", "Face",
    "VS", "YouTube", "Discord", "AdGuard", "Twitter", "TikTok", "Instagram", "iPhone",
    "iPad", "Mac", "Windows", "Linux", "Apple", "Spotify", "Podcast", "ChatGPT", "OpenAI",
    "GitHub", "Zoom", "Web", "Notion", "Figma", "Blender", "Unity", "Arduino", "Raspberry",
    "Pi", "Kickstarter", "Amazon", "Netflix", "Nintendo", "Switch", "PlayStation", "Xbox",
  ].map((w) => w.toLowerCase())
);
const LATIN_WORD = /[A-Za-z]{2,}/g;
// 数字に付く単位（3mm×3mm、16kHz、2000mAh）。英単語ではない
const UNIT_AFTER_DIGIT = /(?<=[0-9×])[A-Za-z]{1,4}\b/g;
function unknownLatinWords(text, known = KNOWN_LATIN) {
  const bare = text.replace(UNIT_AFTER_DIGIT, "");
  return (bare.match(LATIN_WORD) ?? []).filter(
    (w) => !known.has(w.toLowerCase()) && !(w === w.toUpperCase() && w.length <= 4)
  );
}

/**
 * その回の参考リンクのタイトルに出る英字の綴り（「ServersMan」「Tyrell Bike」）。
 * 番組の語彙に無くても、その回では正しい綴りなので指摘しない
 */
async function episodeVocabulary(id) {
  try {
    const index = await (await fetch(`${BUCKET}/index.json?v=${Date.now()}`)).json();
    const key = index.episodes?.find((e) => String(e.id) === String(id))?.storageKey;
    if (!key) return { words: new Set(), names: [] };
    const meta = await (await fetch(`${BUCKET}/episodes/${key}/meta.json?v=${Date.now()}`)).json();
    const titles = (meta.referenceLinks ?? []).map((l) => l.title ?? "");
    const names = titles.flatMap((t) => t.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []);
    return { words: new Set(names.map((w) => w.toLowerCase())), names };
  } catch {
    return { words: new Set(), names: [] };
  }
}

const OVER_REPLACED = [
  { pattern: /[ぁ-んァ-ヴ一-龥]mail/, kind: "「メール」が置換されている" },
  // 「Claude Code」のような正しい用例は除く。単独の Code が助詞に付くのが兆候
  { pattern: /(?<!Claude |VS ?)Code[をがはにでとも]/, kind: "「コード」が置換されている" },
  { pattern: /番頭[ーウ]/, kind: "「バントー」の置換が壊れている" },
  // 英単語同士が空白なしで繋がっている（「GoogleWorkspace」）。
  // 辞書の規則が語の一部だけを対象にしていると起きる。
  // YouTube のように、それ自体がキャメルケースの製品名は除く
  {
    // 単位（kHz, mAh）は数字が前に付くので、直前が数字でないものだけを見る
    pattern: /(?<![0-9])[a-z][A-Z][a-z]/,
    kind: "英単語の空白が落ちている",
    except: CAMEL_CASE_NAMES,
  },
  // 「えー、で、」が「え?で、」になる疑問符の誤付与。
  // 「いくら使えました?で、」のような本物の問いかけと分けるため、
  // 疑問符の手前が1文字の言いよどみのときだけ見る
  { pattern: /(?:^|[、。\s])[えあま][ーぁ-ん]?[?？]\s*で[、。]/, kind: "疑問符が誤って付いている" },
];

/**
 * 繰り返しに意味がある語
 *
 * 擬音や副詞は、同じ字が並んでいても相槌ではない。消してはいけない。
 */
const MEANINGFUL_REPEATS = ["どんどん", "バチバチ", "だんだん", "そろそろ", "いろいろ"];

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 公開ページから文字起こしのセグメントを取り出す */
function parseSegments(html) {
  // 話者はアイコンで出すので、名前は img の alt に入っている
  const blocks = html.split("transcript-segment").slice(1);

  return blocks.map((block) => {
    const speakers = [
      // 話者アイコンだけを拾う。アートワークの alt を話者名と取り違えないよう、
      // /speakers/ の画像に限る
      ...[...block.matchAll(/<img[^>]*src="\/speakers\/[^"]*"[^>]*alt="([^"]*)"/g)].map(
        (m) => m[1].trim()
      ),
      ...[...block.matchAll(/text-speaker-\d[^"]*"[^>]*>([^<]+)<\/span>/g)].map((m) =>
        m[1].trim()
      ),
    ];
    const body = block.match(/transcript-text[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/span>/);
    const text = body ? unescapeHtml(body[1].replace(/<[^>]+>/g, "")).trim() : "";

    return { speakers, text: text.replace(/\s+/g, " ") };
  });
}

async function auditEpisode(id) {
  const res = await fetch(`${SITE}/episodes/${id}/`);
  if (!res.ok) {
    return { id, error: `HTTP ${res.status}` };
  }

  const segments = parseSegments(await res.text());
  const findings = [];
  const vocabulary = await episodeVocabulary(id);
  const known = new Set([...KNOWN_LATIN, ...vocabulary.words]);

  for (const { speakers, text } of segments) {
    for (const word of BAD_WORDS) {
      if (text.includes(word)) {
        findings.push({ kind: word, speakers, text });
      }
    }

    // 辞書の規則が行き過ぎていないか
    for (const { pattern, kind, except } of OVER_REPLACED) {
      // 正当な綴りを取り除いてから当てる
      // その回の参考リンクにある綴り（ServersMan）も、空白落ちではない
      const skip = except ? [...except, ...vocabulary.names] : [];
      const target = skip.reduce((t, w) => t.split(w).join(""), text);
      if (pattern.test(target)) {
        findings.push({ kind, speakers, text });
      }
    }

    // VTT のタグがそのまま出ていないか
    if (text.includes("<v ") || text.includes("</v>")) {
      findings.push({ kind: "VTTタグの露出", speakers, text });
    }

    // 日本語の文字起こしに混じるはずのない文字（Whisper の多言語ハルシネーション）
    if (FOREIGN_SCRIPT.test(text)) {
      findings.push({ kind: "外国語の文字が混じる行", speakers, text });
    }

    // 語彙に無い英単語が並ぶ行（Whisper の脱線）
    if (unknownLatinWords(text, known).length >= 3) {
      findings.push({ kind: "英単語の断片が並ぶ行", speakers, text });
    }

    // 同じ字が並ぶだけの行（「笑 笑 笑 笑」「ふんふんふん。」）
    //
    // 「はい、はい。」「どんどん、」のような普通の言葉と分けるため、
    // 1種類なら3文字以上、2種類なら6文字以上を条件にする。
    const core = text.replace(/[\s。．、，,！？!?]/g, "");
    const kinds = new Set(core).size;
    const meaningful = MEANINGFUL_REPEATS.some((w) => core.startsWith(w));
    if (
      !meaningful &&
      ((kinds <= 1 && core.length >= 3) || (kinds === 2 && core.length >= 6))
    ) {
      findings.push({ kind: "同じ字が並ぶだけの行", speakers, text });
    }

    // 相槌が読みづらいほど繰り返されていないか
    const repeat = text.match(/(うん|はい|そう|ええ|へえ)\1{3,}/);
    if (repeat) {
      findings.push({ kind: `相槌4回以上（${repeat[0]}）`, speakers, text });
    }
  }

  const hasSpeakers = segments.some((s) => s.speakers.length > 0);

  // 文として閉じていない行
  //
  // 読み物としての文体が揃っていれば、行の終わりには「。」「！」「？」が来る。
  // 来ていない行は、文の途中で切れているか、句点が落ちているかのどちらか。
  // 割合で見るより、行ごとに白黒がつくこちらのほうが直す場所が分かる。
  // 1 割を超えたら挙げる（元の公開データでも 38% あり、まず減らすのが先）
  const unclosed = segments.filter(
    (s) => s.text.trim() !== "" && !/[。．！？!?」』）)…]\s*$/.test(s.text.trim())
  );
  if (segments.length > 0 && unclosed.length / segments.length > 0.1) {
    const examples = unclosed.slice(0, 3).map((s) => s.text.slice(-30)).join(" / ");
    findings.push({
      kind: "文として閉じていない行",
      speakers: [],
      text: `${unclosed.length} 行 / ${segments.length} 行 (${Math.round((100 * unclosed.length) / segments.length)}%)。例: ${examples}`,
    });
  }

  // 句読点の薄い区間
  //
  // hotwords を入れたあと、30〜45 分の読点がほぼ消えたのに気づかなかった。CER も
  // 話者一致も既知の形の検査も、読点の欠落には反応しない。8 文字以上の行を 30 行ずつ
  // まとめ、句読点のある行が 6 割を下回る塊を挙げる。
  const longLines = segments
    .map((s, index) => ({ index, text: s.text }))
    .filter((s) => s.text.replace(/\s/g, "").length >= 8);
  for (let from = 0; from < longLines.length; from += 30) {
    const block = longLines.slice(from, from + 30);
    if (block.length < 15) break;
    const punctuated = block.filter((s) => /[、。]/.test(s.text)).length;
    if (punctuated / block.length < 0.6) {
      findings.push({
        kind: "句読点の薄い区間",
        speakers: [],
        text: `${block[0].index + 1}〜${block[block.length - 1].index + 1} 行目: 8 文字以上の ${block.length} 行のうち句読点あり ${punctuated} 行`,
      });
    }
  }
  return { id, count: segments.length, hasSpeakers, findings };
}

const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["285", "284", "283", "282", "281", "280"];

const results = [];
for (const id of targets) {
  results.push(await auditEpisode(id));
}

let total = 0;
for (const r of results) {
  if (r.error) {
    console.log(`#${r.id}: ${r.error}`);
    continue;
  }
  const speaker = r.hasSpeakers ? "話者あり" : "話者なし";
  console.log(`#${r.id}: ${r.count} セグメント / ${speaker} / 指摘 ${r.findings.length}`);
  total += r.findings.length;
}

const byKind = new Map();
for (const r of results) {
  for (const f of r.findings ?? []) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
}

console.log(`\n合計 ${total} 件の指摘`);
if (total === 0) {
  console.log("既知の形の問題はありません。");
  console.log("読んで分かる誤りは node scripts/read-back.mjs で探せます。");
} else {
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${list.length} 件  ${kind}`);
    for (const f of list.slice(0, 2)) {
      const who = f.speakers.length ? `[${f.speakers.join("・")}] ` : "";
      console.log(`      ${who}${f.text.slice(0, 70)}`);
    }
  }
}

process.exit(total === 0 ? 0 : 1);
