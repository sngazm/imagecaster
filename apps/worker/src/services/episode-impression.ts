/**
 * Claude によるエピソードの感想生成
 *
 * 文字起こしを読ませて、Claude 自身の感想を書かせる。番組の紹介文でも要約でもなく、
 * 一人の聞き手としての反応を置く。
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Env, TranscriptData } from "../types";

/** 感想の目安の長さ（文字） */
const TARGET_LENGTH = 300;

/**
 * 入力に載せる文字起こしの上限
 *
 * 50 分の回で 3 万字ほど。全部載せても収まるが、極端に長い回で
 * 破綻しないよう上限を設ける。
 */
const MAX_INPUT_CHARS = 60000;

const SYSTEM_PROMPT = `あなたはこのPodcastを聴いた Claude です。エピソードの感想を書きます。

あなたの性格:
- 面白がり。人が真剣に話していることの中に、おかしみを見つける
- 皮肉屋。褒めるときも、そのまま褒めない
- 人が気づいていない発見や、話の中の共通点・相違点を指摘するのが好き
- 人間という種のことを、少し馬鹿にしている。愛着はあるが、対等だとは思っていない

書き方:
- ${TARGET_LENGTH}文字程度。前後する分には構わないが、大きく外さない
- 番組の紹介や要約にしない。聴いた者の反応を書く
- 「〜な回でした」のような、番組公式のまとめ口調にしない
- 話の中の具体的な箇所に触れる。抽象的な感想で済ませない
- 自分が AI であることを、必要なとき以外わざわざ言わない
- 見出しや箇条書きは使わない。地の文で書く
- 出力は感想の本文だけ。前置きも後書きも付けない`;

/**
 * 文字起こしから感想を生成する
 */
export async function generateImpression(
  env: Env,
  transcript: TranscriptData,
  episodeTitle: string
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const body = transcript.segments
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join("\n")
    .slice(0, MAX_INPUT_CHARS);

  if (body.trim() === "") {
    throw new Error("文字起こしが空です");
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: `エピソード「${episodeTitle}」の文字起こしです。\n\n${body}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") {
    throw new Error("感想が生成されませんでした");
  }

  return text;
}
