import { describe, it, expect } from "vitest";
import { getMp3Duration } from "../services/audio";

/**
 * 最小限の有効なMP3フレームヘッダーを生成するヘルパー
 *
 * MPEG1 Layer III, 128kbps, 44100Hz のフレーム:
 * - Sync: 0xFFE0 (11bit)
 * - Version: MPEG1 (11)
 * - Layer: III (01)
 * - Protection: no CRC (1)
 * → 0xFF 0xFB
 * - Bitrate index: 128kbps = 1001 (index 9)
 * - Sample rate: 44100 = 00
 * - Padding: 0
 * - Private: 0
 * → 0x90
 * - Channel mode, etc: 0x00
 *
 * フレームサイズ = floor(1152 * 128000 / (8 * 44100)) + 0 = floor(417.96) = 417 bytes
 */
function createMp3FrameHeader(): number[] {
  return [0xff, 0xfb, 0x90, 0x00];
}

/**
 * CBR MP3ファイル（指定フレーム数）のバイナリを生成
 */
function createCbrMp3(frameCount: number): ArrayBuffer {
  const header = createMp3FrameHeader();
  const frameSize = 417; // MPEG1 Layer III, 128kbps, 44100Hz, no padding
  const totalSize = frameSize * frameCount;
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);

  for (let i = 0; i < frameCount; i++) {
    const offset = i * frameSize;
    view[offset] = header[0];
    view[offset + 1] = header[1];
    view[offset + 2] = header[2];
    view[offset + 3] = header[3];
    // 残りは0のまま（有効なオーディオデータではないがパーサーには影響しない）
  }

  return buffer;
}

/**
 * ID3v2タグ付きのCBR MP3を生成
 */
function createMp3WithId3v2(frameCount: number): ArrayBuffer {
  const id3Size = 128; // ID3v2タグのデータサイズ
  const header = createMp3FrameHeader();
  const frameSize = 417;
  const totalSize = 10 + id3Size + frameSize * frameCount; // 10 = ID3v2ヘッダー
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);

  // ID3v2ヘッダー
  view[0] = 0x49; // 'I'
  view[1] = 0x44; // 'D'
  view[2] = 0x33; // '3'
  view[3] = 0x04; // version 2.4
  view[4] = 0x00; // revision
  view[5] = 0x00; // flags
  // syncsafe integer: 128 = 0x00 0x00 0x01 0x00
  view[6] = 0x00;
  view[7] = 0x00;
  view[8] = 0x01;
  view[9] = 0x00;

  // ID3タグのデータ（ダミー）
  // 10 + id3Size の位置からMP3フレームが始まる

  const audioOffset = 10 + id3Size;
  for (let i = 0; i < frameCount; i++) {
    const offset = audioOffset + i * frameSize;
    view[offset] = header[0];
    view[offset + 1] = header[1];
    view[offset + 2] = header[2];
    view[offset + 3] = header[3];
  }

  return buffer;
}

/**
 * Xing VBRヘッダー付きMP3を生成
 */
function createVbrMp3WithXing(totalFrameCount: number): ArrayBuffer {
  const header = createMp3FrameHeader();
  const frameSize = 417;
  // 最初のフレームにXingヘッダーを含める + 少なくとも2フレーム分
  const totalSize = frameSize * 3;
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  const dataView = new DataView(buffer);

  // 最初のフレームヘッダー
  view[0] = header[0];
  view[1] = header[1];
  view[2] = header[2];
  view[3] = header[3];

  // MPEG1ステレオのサイド情報は32バイト
  // Xingヘッダーはフレームヘッダー(4) + サイド情報(32) = オフセット36
  const xingOffset = 4 + 32;

  // "Xing" マジック
  view[xingOffset] = 0x58;     // 'X'
  view[xingOffset + 1] = 0x69; // 'i'
  view[xingOffset + 2] = 0x6e; // 'n'
  view[xingOffset + 3] = 0x67; // 'g'

  // Flags: frames field present (bit 0)
  dataView.setUint32(xingOffset + 4, 0x01);

  // Frame count
  dataView.setUint32(xingOffset + 8, totalFrameCount);

  // 2番目のフレーム（次フレーム検証用）
  const secondFrameOffset = frameSize;
  view[secondFrameOffset] = header[0];
  view[secondFrameOffset + 1] = header[1];
  view[secondFrameOffset + 2] = header[2];
  view[secondFrameOffset + 3] = header[3];

  // 3番目のフレーム
  const thirdFrameOffset = frameSize * 2;
  view[thirdFrameOffset] = header[0];
  view[thirdFrameOffset + 1] = header[1];
  view[thirdFrameOffset + 2] = header[2];
  view[thirdFrameOffset + 3] = header[3];

  return buffer;
}

describe("getMp3Duration", () => {
  it("空のバッファに対して0を返す", () => {
    const buffer = new ArrayBuffer(0);
    expect(getMp3Duration(buffer)).toBe(0);
  });

  it("不正なデータに対して0を返す", () => {
    const buffer = new ArrayBuffer(1024);
    const view = new Uint8Array(buffer);
    // ランダムっぽいデータ
    for (let i = 0; i < 1024; i++) {
      view[i] = i % 256;
    }
    expect(getMp3Duration(buffer)).toBe(0);
  });

  it("CBR MP3のdurationを正しく計算する", () => {
    // 128kbps, 44100Hz
    // 1フレーム = 1152サンプル / 44100Hz ≒ 0.0261秒
    // 100フレーム ≒ 2.61秒 → floor = 2
    // ただしCBR方式: (100 * 417 * 8) / (128 * 1000) = 2.60625 → floor = 2
    const mp3 = createCbrMp3(100);
    const duration = getMp3Duration(mp3);
    expect(duration).toBeGreaterThanOrEqual(2);
    expect(duration).toBeLessThanOrEqual(3);
  });

  it("ID3v2タグ付きMP3のdurationを正しく計算する", () => {
    const mp3 = createMp3WithId3v2(100);
    const duration = getMp3Duration(mp3);
    expect(duration).toBeGreaterThanOrEqual(2);
    expect(duration).toBeLessThanOrEqual(3);
  });

  it("Xing VBRヘッダーからdurationを計算する", () => {
    // 10000フレーム @ MPEG1 Layer III (1152 samples/frame, 44100Hz)
    // duration = 10000 * 1152 / 44100 ≒ 261.22秒 → floor = 261
    const mp3 = createVbrMp3WithXing(10000);
    const duration = getMp3Duration(mp3);
    expect(duration).toBe(261);
  });

  it("大きめのCBR MP3で妥当なdurationを返す", () => {
    // 3843フレーム ≒ 100秒相当 (128kbps, 44100Hz)
    // CBR方式: (3843 * 417 * 8) / (128 * 1000) ≒ 100.12秒
    const mp3 = createCbrMp3(3843);
    const duration = getMp3Duration(mp3);
    expect(duration).toBeGreaterThanOrEqual(99);
    expect(duration).toBeLessThanOrEqual(101);
  });
});
