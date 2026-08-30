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
  // 「えー、で、」が「え?で、」になる疑問符の誤付与
  { pattern: /[ぁ-ん][?？]\s*で[、。]/, kind: "疑問符が誤って付いている" },
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
      ...[...block.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1].trim()),
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

  for (const { speakers, text } of segments) {
    for (const word of BAD_WORDS) {
      if (text.includes(word)) {
        findings.push({ kind: word, speakers, text });
      }
    }

    // 辞書の規則が行き過ぎていないか
    for (const { pattern, kind, except } of OVER_REPLACED) {
      // 正当な綴りを取り除いてから当てる
      const target = (except ?? []).reduce((t, w) => t.split(w).join(""), text);
      if (pattern.test(target)) {
        findings.push({ kind, speakers, text });
      }
    }

    // VTT のタグがそのまま出ていないか
    if (text.includes("<v ") || text.includes("</v>")) {
      findings.push({ kind: "VTTタグの露出", speakers, text });
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
