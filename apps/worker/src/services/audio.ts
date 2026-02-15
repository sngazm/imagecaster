/**
 * MP3音声ファイルからduration（秒）を算出するユーティリティ
 *
 * Cloudflare Worker環境で動作するため、ブラウザAPIやNode.jsライブラリに依存しない
 * ArrayBufferを直接パースしてMP3フレームヘッダーから情報を抽出する
 */

// MPEG バージョン
const MPEG_VERSION = {
  "2.5": 0,
  reserved: 1,
  "2": 2,
  "1": 3,
} as const;

// ビットレートテーブル (kbps)
// [version][layer][index]
// version: 0=V1, 1=V2(V2/V2.5)
// layer: 0=LayerI, 1=LayerII, 2=LayerIII
const BITRATE_TABLE: number[][][] = [
  // MPEG1
  [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // Layer I
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],    // Layer II
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],     // Layer III
  ],
  // MPEG2 / MPEG2.5
  [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],    // Layer I
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],         // Layer II
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],         // Layer III
  ],
];

// サンプルレートテーブル (Hz)
// [version_index][sample_rate_index]
const SAMPLE_RATE_TABLE: number[][] = [
  [11025, 12000, 8000],  // MPEG2.5
  [],                     // reserved
  [22050, 24000, 16000], // MPEG2
  [44100, 48000, 32000], // MPEG1
];

// フレームあたりのサンプル数
// [version][layer]
const SAMPLES_PER_FRAME: number[][] = [
  // MPEG1
  [384, 1152, 1152], // Layer I, II, III
  // MPEG2/2.5
  [384, 1152, 576],  // Layer I, II, III
];

interface FrameInfo {
  version: number;      // 0=MPEG2.5, 2=MPEG2, 3=MPEG1
  layer: number;        // 1=III, 2=II, 3=I
  bitrate: number;      // kbps
  sampleRate: number;   // Hz
  frameSize: number;    // bytes
  samplesPerFrame: number;
}

/**
 * ID3v2タグのサイズを取得（存在しない場合は0）
 */
function getID3v2Size(data: DataView): number {
  if (data.byteLength < 10) return 0;

  // "ID3" マジック
  if (
    data.getUint8(0) !== 0x49 || // 'I'
    data.getUint8(1) !== 0x44 || // 'D'
    data.getUint8(2) !== 0x33    // '3'
  ) {
    return 0;
  }

  // ID3v2 サイズ (syncsafe integer, 28bit)
  const size =
    ((data.getUint8(6) & 0x7f) << 21) |
    ((data.getUint8(7) & 0x7f) << 14) |
    ((data.getUint8(8) & 0x7f) << 7) |
    (data.getUint8(9) & 0x7f);

  return size + 10; // ヘッダー10バイト + タグデータ
}

/**
 * MP3フレームヘッダーをパース
 */
function parseFrameHeader(data: DataView, offset: number): FrameInfo | null {
  if (offset + 4 > data.byteLength) return null;

  const header = data.getUint32(offset);

  // Sync word (11 bits) - >>> 0 で符号なし32bit整数に変換して比較
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return null;

  const versionBits = (header >>> 19) & 0x03;
  const layerBits = (header >>> 17) & 0x03;
  const bitrateIndex = (header >>> 12) & 0x0f;
  const sampleRateIndex = (header >>> 10) & 0x03;
  const padding = (header >>> 9) & 0x01;

  // 不正な値をチェック
  if (versionBits === 1) return null;  // reserved version
  if (layerBits === 0) return null;    // reserved layer
  if (bitrateIndex === 0 || bitrateIndex === 15) return null; // free/bad
  if (sampleRateIndex === 3) return null; // reserved

  const versionIndex = versionBits === 3 ? 0 : 1; // 0=MPEG1, 1=MPEG2/2.5
  const layerIndex = 3 - layerBits; // 0=I, 1=II, 2=III

  const bitrate = BITRATE_TABLE[versionIndex][layerIndex][bitrateIndex];
  const sampleRate = SAMPLE_RATE_TABLE[versionBits][sampleRateIndex];

  if (!bitrate || !sampleRate) return null;

  const samplesPerFrame = SAMPLES_PER_FRAME[versionIndex][layerIndex];

  // フレームサイズ計算
  let frameSize: number;
  if (layerBits === 3) {
    // Layer I
    frameSize = Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4;
  } else {
    // Layer II, III
    frameSize = Math.floor((samplesPerFrame * bitrate * 1000) / (8 * sampleRate)) + padding;
  }

  if (frameSize < 1) return null;

  return {
    version: versionBits,
    layer: layerBits,
    bitrate,
    sampleRate,
    frameSize,
    samplesPerFrame,
  };
}

/**
 * Xing/Info VBRヘッダーからフレーム数を取得
 */
function getXingFrameCount(data: DataView, frameOffset: number, frame: FrameInfo): number | null {
  // サイド情報のサイズ（Xingヘッダーはサイド情報の後ろ）
  let sideInfoSize: number;
  if (frame.version === MPEG_VERSION["1"]) {
    // MPEG1
    sideInfoSize = 32; // mono=17, stereo=32 → ステレオ前提で32
  } else {
    // MPEG2/2.5
    sideInfoSize = 17; // mono=9, stereo=17
  }

  const xingOffset = frameOffset + 4 + sideInfoSize;

  if (xingOffset + 8 > data.byteLength) return null;

  // "Xing" or "Info" マジック
  const magic =
    String.fromCharCode(data.getUint8(xingOffset)) +
    String.fromCharCode(data.getUint8(xingOffset + 1)) +
    String.fromCharCode(data.getUint8(xingOffset + 2)) +
    String.fromCharCode(data.getUint8(xingOffset + 3));

  if (magic !== "Xing" && magic !== "Info") return null;

  const flags = data.getUint32(xingOffset + 4);

  // Bit 0: フレーム数フィールドが存在
  if (!(flags & 0x01)) return null;

  return data.getUint32(xingOffset + 8);
}

/**
 * MP3バイナリデータからduration（秒、整数）を算出
 *
 * 1. ID3v2タグをスキップ
 * 2. 最初の有効なフレームヘッダーを探す
 * 3. Xing/Info VBRヘッダーがあればフレーム数から計算
 * 4. なければCBRとしてファイルサイズとビットレートから推定
 *
 * @returns duration in seconds (floored to integer), or 0 if parsing fails
 */
export function getMp3Duration(buffer: ArrayBuffer): number {
  const data = new DataView(buffer);

  // ID3v2 タグをスキップ
  let offset = getID3v2Size(data);

  // 最初の有効なフレームヘッダーを探す（最大で先頭8KBまで）
  const searchLimit = Math.min(offset + 8192, data.byteLength - 4);
  let firstFrame: FrameInfo | null = null;
  let firstFrameOffset = 0;

  for (let i = offset; i < searchLimit; i++) {
    // sync word の先頭バイト
    if (data.getUint8(i) !== 0xff) continue;

    const frame = parseFrameHeader(data, i);
    if (!frame) continue;

    // 次のフレームも有効か確認（誤検出防止）
    if (i + frame.frameSize + 4 <= data.byteLength) {
      const nextFrame = parseFrameHeader(data, i + frame.frameSize);
      if (!nextFrame) continue;
      // 同じバージョン・レイヤー・サンプルレートであることを確認
      if (
        nextFrame.version !== frame.version ||
        nextFrame.layer !== frame.layer ||
        nextFrame.sampleRate !== frame.sampleRate
      ) continue;
    }

    firstFrame = frame;
    firstFrameOffset = i;
    break;
  }

  if (!firstFrame) return 0;

  // Xing/Info ヘッダーを確認（VBR）
  const frameCount = getXingFrameCount(data, firstFrameOffset, firstFrame);
  if (frameCount !== null && frameCount > 0) {
    const duration = (frameCount * firstFrame.samplesPerFrame) / firstFrame.sampleRate;
    return Math.floor(duration);
  }

  // CBR: 音声データサイズとビットレートから推定
  const audioDataSize = data.byteLength - firstFrameOffset;
  const duration = (audioDataSize * 8) / (firstFrame.bitrate * 1000);
  return Math.floor(duration);
}
