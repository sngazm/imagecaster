#!/usr/bin/env node
/**
 * 公開サイトの文字起こしを Claude に読ませて、引っかかる箇所を報告させる。
 *
 * audit-site.mjs は既知の形しか見ない。「切層もない」「ネーミングソロス」のような
 * **日本語として存在しない語**は、パターンでは書けないので読ませて探す。
 *
 * 直さない。人が見るための一覧を出すだけ。自動で直すのは校正の仕事で、
 * こちらは「見返し」を機械にやらせるもの。
 *
 *   node scripts/read-back.mjs            最新6本
 *   node scripts/read-back.mjs 285 284    個別指定
 */

import { spawn } from "node:child_process";

const SITE = process.env.SITE_URL ?? "https://cast.image.club";

/** 一度に読ませる行数。多すぎると見落とす */
const CHUNK = 250;

const SYSTEM = `あなたはPodcastの文字起こしを読み返す校正者です。

読んで「ん?」と引っかかる箇所だけを挙げてください。探すのは次のものです。

- 日本語として存在しない語（例:「切層もない」は「節操もない」の誤り）
- 意味の取れないカタカナ語（例:「ネーミングソロス」は「ネーミングそろそろ」の誤り）
- 文脈に合わない同音異義語（例:「仕事を支持する」は「指示する」の誤り）

挙げないもの:
- 話し言葉の崩れ、言い直し、言いよどみ。これは正常です
- 固有名詞の表記ゆれ。別の仕組みで直しています
- 読点や句点の位置

確実におかしいと言えるものだけを挙げます。迷ったら挙げません。

出力は JSON だけ。前置きも後書きも付けません。

{"findings": [{"text": "その行の該当部分", "guess": "たぶんこう", "why": "理由"}]}

1つも無ければ {"findings": []} を返します。`;

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSegments(html) {
  // 本文は最後の <span>。話者アイコンや名前が前に入ることがある
  const blocks = html.split("transcript-segment").slice(1);

  return blocks
    .map((block) => {
      const spans = [...block.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)];
      const last = spans[spans.length - 1];
      return last ? unescapeHtml(last[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
    })
    .filter(Boolean);
}

/** ローカルの claude に問い合わせる。API キーは使わない */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--append-system-prompt", SYSTEM], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}`))
    );

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function parseFindings(answer) {
  const match = answer.match(/\{[\s\S]*\}/);
  if (!match) return [];

  try {
    return JSON.parse(match[0]).findings ?? [];
  } catch {
    return [];
  }
}

async function readBack(id) {
  const res = await fetch(`${SITE}/episodes/${id}/`);
  if (!res.ok) return { id, error: `HTTP ${res.status}` };

  const segments = parseSegments(await res.text());
  const findings = [];

  for (let start = 0; start < segments.length; start += CHUNK) {
    const lines = segments.slice(start, start + CHUNK);
    const answer = await ask(lines.join("\n"));
    findings.push(...parseFindings(answer));
  }

  return { id, count: segments.length, findings };
}

const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["285", "284", "283", "282", "281", "280"];

let total = 0;
for (const id of targets) {
  const result = await readBack(id);

  if (result.error) {
    console.log(`#${result.id}: ${result.error}`);
    continue;
  }

  console.log(`#${result.id}: ${result.count} 行 / 指摘 ${result.findings.length}`);
  for (const f of result.findings) {
    console.log(`    ${f.text}`);
    console.log(`      → ${f.guess}  (${f.why})`);
  }
  total += result.findings.length;
}

console.log(`\n合計 ${total} 件`);
process.exit(total === 0 ? 0 : 1);
