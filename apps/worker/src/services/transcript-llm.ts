/**
 * LLM による文字起こしの校正
 *
 * 辞書は「この表記をこう直す」と決め打ちできるものしか扱えない。文脈を読まないと
 * 判断できない誤り（同音異義語の取り違え、話の流れから見て明らかにおかしい語）は
 * ここで直す。
 *
 * 本文を丸ごと書き換えさせると、毎回結果が変わって検証できないうえ、フィラーを
 * 消したり口語を書き言葉に整えたりと、頼んでいない改変が混ざる。そこで
 * 「どのセグメントをどう直すか」の一覧だけを出させ、適用はこちらで行う。
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Env, TranscriptSegment } from "../types";

/** 1 リクエストに載せるセグメント数。長い回でも数回で収まる量にする */
const CHUNK_SIZE = 400;

/** 前後の文脈として添えるセグメント数 */
const CONTEXT_SIZE = 20;

/**
 * 修正の提案
 */
export interface LlmCorrection {
  index: number;
  before: string;
  after: string;
  reason: string;
}

export interface LlmReviewResult {
  corrections: LlmCorrection[];
  /** 検査で弾いた提案（適用しなかったもの） */
  rejected: Array<{ correction: LlmCorrection; reason: string }>;
  /** 実際に適用した後のセグメント */
  segments: TranscriptSegment[];
}

const SYSTEM_PROMPT = `あなたはPodcastの文字起こしを校正します。音声認識が拾い損ねた箇所を直すのが仕事です。

直すもの:
- 同音異義語の取り違え（例:「仕事を支持する」→「仕事を指示する」）
- 文脈から見て明らかに誤認識されている固有名詞・専門用語
- 話の流れとして意味が通らない語

直さないもの:
- フィラー（「えー」「あの」「まあ」）は残す。話し方の記録として意味がある
- 言い直しや言いよどみもそのまま残す
- 口語を書き言葉に整えない。「〜っすね」を「〜ですね」にしない
- 句読点の追加や削除だけの変更はしない
- 内容の要約・省略は一切しない

判断に迷ったら直さないでください。確実に誤認識だと言える箇所だけを挙げます。
1つも見つからなければ空の配列を返します。`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    corrections: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          index: { type: "number" as const, description: "セグメント番号" },
          before: { type: "string" as const, description: "元のテキスト全体" },
          after: { type: "string" as const, description: "修正後のテキスト全体" },
          reason: { type: "string" as const, description: "なぜ誤認識と判断したか（簡潔に）" },
        },
        required: ["index", "before", "after", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["corrections"],
  additionalProperties: false,
};

/**
 * 提案が安全に適用できるか検査する
 *
 * LLM が指示を外れて要約や書き換えをしていないかを、機械的に確かめる。
 */
function validate(
  correction: LlmCorrection,
  segments: TranscriptSegment[]
): string | null {
  const target = segments[correction.index];

  if (!target) {
    return "存在しないセグメント番号";
  }

  if (target.text !== correction.before) {
    return "元のテキストが一致しない";
  }

  if (correction.after === correction.before) {
    return "変更がない";
  }

  if (correction.after.trim() === "") {
    return "空になる";
  }

  // 大幅に短く/長くなる提案は、校正ではなく書き換えとみなして捨てる
  const ratio = correction.after.length / Math.max(1, correction.before.length);
  if (ratio < 0.6 || ratio > 1.6) {
    return `文字数が大きく変わる（${correction.before.length}→${correction.after.length}）`;
  }

  return null;
}

function buildPrompt(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  episodeTitle: string,
  vocabulary: string
): string {
  const contextStart = Math.max(0, start - CONTEXT_SIZE);
  const contextEnd = Math.min(segments.length, end + CONTEXT_SIZE);

  const lines: string[] = [];
  for (let i = contextStart; i < contextEnd; i++) {
    const inRange = i >= start && i < end;
    const speaker = segments[i].speaker ? `${segments[i].speaker}: ` : "";
    // 校正対象の範囲だけ番号を振る。前後は文脈を読むためだけに見せる
    lines.push(
      inRange ? `[${i}] ${speaker}${segments[i].text}` : `    ${speaker}${segments[i].text}`
    );
  }

  return `番組: ${episodeTitle}
${vocabulary ? `\nこの番組でよく出る固有名詞:\n${vocabulary}\n` : ""}
以下は文字起こしです。[番号] が付いている行だけが校正の対象です。
番号の無い行は前後の文脈を読むためのもので、修正の対象ではありません。

${lines.join("\n")}`;
}

/**
 * LLM に校正させ、検査を通った提案だけを適用する
 */
export async function reviewWithLlm(
  env: Env,
  segments: TranscriptSegment[],
  options: { episodeTitle?: string; vocabulary?: string } = {}
): Promise<LlmReviewResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const accepted: LlmCorrection[] = [];
  const rejected: Array<{ correction: LlmCorrection; reason: string }> = [];

  for (let start = 0; start < segments.length; start += CHUNK_SIZE) {
    const end = Math.min(segments.length, start + CHUNK_SIZE);

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: buildPrompt(
            segments,
            start,
            end,
            options.episodeTitle ?? "",
            options.vocabulary ?? ""
          ),
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    let parsed: { corrections?: LlmCorrection[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("[transcript-llm] 応答をJSONとして読めませんでした");
      continue;
    }

    for (const correction of parsed.corrections ?? []) {
      const problem = validate(correction, segments);
      if (problem) {
        rejected.push({ correction, reason: problem });
      } else {
        accepted.push(correction);
      }
    }
  }

  const applied = segments.map((segment, i) => {
    const correction = accepted.find((c) => c.index === i);
    return correction ? { ...segment, text: correction.after } : { ...segment };
  });

  return { corrections: accepted, rejected, segments: applied };
}
