/**
 * 切り抜きの音を、ブラウザの中で繋ぐ。
 *
 * 手元は音声を作らない。置かれるのは「どこをどの順に繋ぐか」のデータだけで、音はここが
 * エピソードの mp3 から必要な範囲だけを取って復号し、本番と同じ規則で繋ぐ。端を動かしたら
 * その場で繋ぎ直せる。
 *
 * 固定ビットレートの mp3 は、時刻とバイト位置が比例する。フレーム（1152 サンプル）の境目から
 * 取れば、途中だけを復号しても ffmpeg の復号と 1 サンプルもずれない（実測。Chromium）。
 * ただし mp3 は前のフレームの余りを使って復号するので（ビットリザーバ）、欲しい位置の
 * 手前から余分に取り、落ち着くまでの分を捨てる。
 *
 * 繋ぎ方は imagecaster-video の splice.splice_audio と同じ：区間の両端に短いフェード →
 * 区間のあとに無音の間。片方だけ変えないこと。
 */

import type { ClipAudioInfo, ClipDraft } from "./api";
import type { Timeline } from "./clipTimeline";

const FRAME_SAMPLES = 1152;
/** 手前に余分に取るフレーム数。ビットリザーバが落ち着くまで */
const PREROLL_FRAMES = 12;
/** 同時に取りにいく数 */
const PARALLEL = 3;

/** pool の 1 範囲ぶんの波形。16bit のステレオで持つ（float のままだとスマホには重い） */
interface Chunk {
  /** 先頭のサンプルが、元の音声の何サンプル目か */
  firstSample: number;
  left: Int16Array;
  right: Int16Array;
}

export class UnsupportedAudio extends Error {}

const frameBytes = (a: ClipAudioInfo) => (144 * a.bitrate) / a.sampleRate;

const isFrameHeader = (b: Uint8Array, i: number) =>
  i + 1 < b.length && b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0;

/**
 * 取ってきたバイト列の中で、フレームの境目を探す。
 *
 * パディングの有無でフレームの長さは 1 バイト揺れるので、見積もりの位置から前後数バイトを
 * 探し、1 フレーム先にもヘッダーがあることで確かめる。
 */
function findFrame(bytes: Uint8Array, near: number, size: number): number {
  for (let d = 0; d <= 6; d++) {
    for (const i of [near + d, near - d]) {
      if (i < 0 || !isFrameHeader(bytes, i)) continue;
      const next = i + Math.floor(size);
      if (isFrameHeader(bytes, next) || isFrameHeader(bytes, next + 1)) return i;
    }
  }
  throw new UnsupportedAudio("音声のフレームの境目が見つかりません");
}

async function loadChunk(
  url: string,
  info: ClipAudioInfo,
  range: { start: number; end: number },
  signal: AbortSignal
): Promise<Chunk> {
  const size = frameBytes(info);
  const toFrame = (t: number) => Math.floor((t * info.sampleRate + info.skipSamples) / FRAME_SAMPLES);
  const wantFirst = Math.max(0, toFrame(range.start));
  const first = Math.max(0, wantFirst - PREROLL_FRAMES);
  const last = toFrame(range.end) + 2;

  // 見積もりは 2 バイト以内に収まる（実測）。前後に 1 フレームずつ余分に取って境目を探す
  const from = Math.max(0, Math.floor(info.headerBytes + (first - 1) * size));
  const to = Math.ceil(info.headerBytes + (last + 1) * size);
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal });
  if (res.status !== 206) throw new UnsupportedAudio("音声を途中から取れませんでした");
  const bytes = new Uint8Array(await res.arrayBuffer());

  const at = findFrame(bytes, Math.round(info.headerBytes + first * size) - from, size);
  // 見つけた境目が何フレーム目か。見積もりとのずれは 1 フレームよりずっと小さい
  const frame = Math.round((from + at - info.headerBytes) / size);

  // 復号でサンプリングレートを変えさせない。変わるとサンプルの位置が合わなくなる
  const ctx = new OfflineAudioContext(2, 1, info.sampleRate);
  const decoded = await ctx.decodeAudioData(bytes.slice(at).buffer);

  const skip = (wantFirst - frame) * FRAME_SAMPLES;
  const l = decoded.getChannelData(0);
  const r = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : l;
  const n = Math.max(0, decoded.length - skip);
  const left = new Int16Array(n);
  const right = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = Math.max(-32768, Math.min(32767, Math.round(l[skip + i] * 32767)));
    right[i] = Math.max(-32768, Math.min(32767, Math.round(r[skip + i] * 32767)));
  }
  return { firstSample: wantFirst * FRAME_SAMPLES - info.skipSamples, left, right };
}

/**
 * pool の範囲の波形。一度取れば、端を動かしても取り直さない（端は pool の中でしか動かない）
 */
export class ClipAudioPool {
  private chunks: Chunk[] = [];

  constructor(
    readonly info: ClipAudioInfo,
    private readonly url: string
  ) {
    if (info.format !== "mp3-cbr") {
      throw new UnsupportedAudio(
        "この回の音声は固定ビットレートの mp3 ではないので、ここでは繋げません"
      );
    }
  }

  async load(
    pool: ClipDraft["pool"],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const queue = [...pool];
    let done = 0;
    const worker = async () => {
      for (let range = queue.shift(); range; range = queue.shift()) {
        this.chunks.push(await loadChunk(this.url, this.info, range, signal));
        onProgress?.(++done, pool.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, pool.length) }, worker));
  }

  /**
   * 区間の並びのとおりに繋いで、WAV にする。
   */
  splice(draft: ClipDraft, tl: Timeline): Blob {
    const sr = this.info.sampleRate;
    const total = Math.max(1, Math.round(tl.duration * sr));
    const pcm = new Int16Array(total * 2);

    for (const piece of tl.pieces) {
      const s0 = Math.round(piece.span.start * sr);
      const n = Math.round((piece.span.end - piece.span.start) * sr);
      const chunk = this.chunks.find(
        (c) => s0 >= c.firstSample && s0 + n <= c.firstSample + c.left.length
      );
      if (!chunk) throw new Error(`区間 ${piece.span.id} の音声がまだ読めていません`);

      const out = Math.round(piece.tau * sr);
      const fade = Math.round(Math.max(0, Math.min(draft.edgeFade, (piece.span.end - piece.span.start) / 2)) * sr);
      const src = s0 - chunk.firstSample;
      for (let i = 0; i < n && out + i < total; i++) {
        // 波形を途中で断ち切るとプツッと鳴る。両端だけ直線で絞る
        const g = i < fade ? i / fade : i >= n - fade ? (n - 1 - i) / fade : 1;
        pcm[(out + i) * 2] = chunk.left[src + i] * g;
        pcm[(out + i) * 2 + 1] = chunk.right[src + i] * g;
      }
    }
    return wav(pcm, sr);
  }
}

function wav(pcm: Int16Array, sampleRate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => header.setUint8(at + i, ch.charCodeAt(0)));
  const bytes = pcm.length * 2;
  text(0, "RIFF");
  header.setUint32(4, 36 + bytes, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 2, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 4, true);
  header.setUint16(32, 4, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, bytes, true);
  return new Blob([header.buffer as ArrayBuffer, pcm.buffer as ArrayBuffer], { type: "audio/wav" });
}
