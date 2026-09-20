---
title: 切り抜き動画 API
description: 動画にする前に音声と字幕で確かめ、直して OK を出す
sidebar:
  order: 6
---

エピソードから作る切り抜き動画を、**動画にする前に**管理画面で確かめて直し、OK を出すための API です。

**描画はここではできません。** ffmpeg も素材も手元（Mac / WSL）にあります。一方、確かめて直すのに
描画は要りません。音声は R2 にあり、字幕は文字と時刻の並びでしかないからです。確かめて直す
ところまでを管理画面で済ませ、手元の道具（[imagecaster-video](https://github.com/sngazm/imagecaster-video)）には
決まったものを描かせるだけにします。

```
手元（Mac / WSL）                 管理画面（Cloudflare）
  区間を選び、下書きを作る
        ↓ PUT clips/:clipId  ──→  音声＋字幕でプレビュー
                                   PUT draft で直す
                                   PUT status で OK ＋ 投稿の予定
        ↓ GET /api/clips/pending ←──
  下書きのとおりに 3 本描く
        ↓ upload-url ×3 → POST versions  ──→  予定日に投稿
```

設計の理由は `docs/clip-viewer-spec.md` にあります。

## エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/episodes/:id/clips` | この回の切り抜き一覧 |
| GET | `/api/episodes/:id/clips/:clipId` | 切り抜き 1 本分の meta |
| PUT | `/api/episodes/:id/clips/:clipId` | 下書きを置く（生成側から） |
| GET | `/api/episodes/:id/clips/:clipId/draft` | 下書き |
| PUT | `/api/episodes/:id/clips/:clipId/draft` | 下書きを保存する（管理画面から） |
| PUT | `/api/episodes/:id/clips/:clipId/status` | OK / 取り消し / ボツ |
| POST | `/api/episodes/:id/clips/:clipId/upload-url` | 動画を置く Presigned URL（レイアウトごと） |
| POST | `/api/episodes/:id/clips/:clipId/versions` | 描いた版を登録する（生成側から） |
| GET | `/api/clips/pending` | 描画待ちのもの（手元が拾う） |

## 状態

| 値 | 意味 |
|---|---|
| `draft` | 下書き。管理画面で直せる |
| `approved` | OK が出た。描画待ち。下書きは直せない |
| `rendered` | OK を出した下書きの動画が揃った。投稿待ち |
| `published` | 投稿が済んだ。状態も下書きも変えられない |
| `rejected` | ボツ |

`approved` と `rendered` は、`status: "draft"` を送れば OK を取り消して下書きに戻せます。
`rendered` と `published` は外から付けられません。

## 下書き

切り抜きは連続した 1 区間とは限りません。離れた区間を選び、並べ替え、間を落として繋ぎます。
**どこをどの順に繋ぐかを決めるのは手元の AI** で、下書きはその結果を区間の並びとして持ちます。

```json
{
  "revision": 4,
  "speed": 1.2,
  "gap": 0.12,
  "edgeFade": 0.03,
  "lead": 0.18,
  "trail": 0.22,
  "audio": { "format": "mp3-cbr", "headerBytes": 160, "bitrate": 192000, "sampleRate": 44100, "skipSamples": 0 },
  "pool": [{ "start": 480.0, "end": 510.0 }, { "start": 555.0, "end": 580.0 }],
  "spans": [
    { "id": "p3", "group": "g2", "start": 562.08, "end": 570.4, "gap": 0.3, "note": "落ち" },
    { "id": "p1", "group": "g1", "start": 487.74, "end": 491.2, "gap": null }
  ],
  "subs": [
    {
      "id": "s12", "speaker": "あずま", "start": 487.92, "end": 490.1,
      "of": "切層もない", "chars": [487.92, 488.1, 488.31, 488.5, 488.7],
      "rows": ["節操もない"], "skip": false
    }
  ],
  "cards": [{ "at": 489.0, "word": "…", "image": "https://…" }]
}
```

| 項目 | 意味 | 管理画面から |
|---|---|---|
| `speed` | 再生の速さ（0.5〜2）。生成側が省けば **1.2**。置き直しても画面で決めた値を保つ | 変えられる |
| `gap` / `edgeFade` | 継ぎ目に挟む間の既定 / 区間の両端のフェード | 変えられない |
| `lead` / `trail` | 区間の端を字幕に合わせて置くときに、前後へ足す余白 | 変えられない |
| `audio` | その回の mp3 を途中だけ取って復号するための手掛かり | 変えられない |
| `pool` | 下書きが字幕を持っている範囲。区間の端はこの中でしか動かせない | 変えられない |
| `spans` | **鳴らす順**に並んだ区間。元の音声での順とは限らない。`off: true` は鳴らさない | 端・間・外す／戻す |
| `subs` | `pool` 全体の字幕。元の音声の順 | `rows` / `skip` / 割る・繋ぐ・足す |
| `cards` | 画面中央に出す画像 | 時刻・外す |

- 時刻はすべて**エピソードの音声上の秒**です。繋いだあとの時刻は持たず、区間の並びから
  そのつど計算します。式は `docs/clip-viewer-spec.md` の「繋いだあとの時刻」にあります
- 鳴らす区間どうしは重なれません。同じところを 2 回鳴らすと、字幕がどちらの区間のものか決まりません
- `of` は元の書き起こしの文字、`chars` はその 1 字ごとの読み始めです。字数は
  **コードポイント**で数えます（`𠮷` は 1 字）
- `rows` が画面に出す文字と改行です。連ねたものが `of` と違えば、文字を直したということです
- `skip: true` は字幕を出しません。音は残ります
- 元に無い字幕を足すときは `of: ""`、`chars: []` にします

### PUT `/api/episodes/:id/clips/:clipId`

生成側が下書きを置きます。切り抜きが無ければ作り、あれば下書きを置き換えます。

```json
{ "label": "脳が5つにちぎれる", "draft": { "gap": 0.12, "edgeFade": 0.03, "lead": 0.18, "trail": 0.22, "audio": {…}, "pool": […], "spans": […], "subs": […], "cards": […] } }
```

- `revision` は前の下書きから 1 進みます
- 置き換えたら **OK は取り消されます**。確かめたのは前の下書きだからです
- 投稿が済んだ切り抜きは `409`
- 形が成り立っていなければ `400`（`chars` の数が `of` の字数と合わない、区間が `pool` の外、区間どうしが重なる、など）

### PUT `/api/episodes/:id/clips/:clipId/draft`

管理画面が下書きを保存します。送るのは `revision` と、直した `speed` / `spans` / `subs` / `cards` です。

| 返り | どんなとき |
|---|---|
| `200` | 保存した。`revision` が 1 進んだ下書きを返す |
| `400` | 形が成り立っていない、**`of` を連ねたものが変わっている**、または生成側が決める項目を変えている |
| `409` | `revision` が食い違う（ほかの画面で先に保存された）。いまの `revision` を返す |
| `409` | OK が出ている。先に取り消すこと |

`of` を変えさせないのは、生成側が「`of` を連ねたものが元の書き起こしと一字一句一致すること」を
確かめてから描くためです。字幕と音がずれるのを防ぐ関門で、ここで変わってしまうと OK を
出したあとの描画で止まります。枚を割る・繋ぐのは、連ねた全体が変わらないので通ります。

## OK と投稿の予定

### PUT `/api/episodes/:id/clips/:clipId/status`

```json
{
  "status": "approved",
  "publishAt": "2026-09-27T21:00:00+09:00",
  "postText": "…",
  "posts": { "instagram": { "enabled": false }, "x": { "layout": "square" } }
}
```

- `approved` のとき、その時点の下書きの `revision` が `approvedRevision` に控えられます
- `publishAt` が無ければ、描くだけで投稿しません
- `posts` は送った投稿先だけが変わります。既定のレイアウトは X が横、Bluesky が正方形、
  YouTube と Instagram が縦です
- 下書きが無い切り抜き（下書きの仕組みより前に作られたもの）には OK を出せません（`409`）

## 描画

### GET `/api/clips/pending`

```json
{ "pending": [{ "episodeId": "285", "storageKey": "…", "clipId": "c1", "label": "…", "revision": 4 }] }
```

`approved` のものだけが出ます。**全エピソードを走査しません。** `index.json` の
`clipRenderIds` に載っているものだけを読みます。索引が未構築のときだけ一度全走査して作ります。

### POST `/api/episodes/:id/clips/:clipId/upload-url`

```json
{ "layout": "square" }
```

`v{n}/{layout}.mp4` への Presigned URL を返します。`n` を省くと次の版です。動画は Worker を
通さず、手元から直に R2 へ入れます。

### POST `/api/episodes/:id/clips/:clipId/versions`

```json
{ "revision": 4, "layouts": ["portrait", "landscape", "square"], "manifest": {…} }
```

**動画を置いてから呼びます。** 逆にすると、登録は済んでいるのに動画が無い版が画面に出ます。

| 返り | どんなとき |
|---|---|
| `201` | 登録した。`rendered` になり、`v{n}/draft.json` に描いたときの下書きが控えられる |
| `409` | `approved` でない、または `revision` が `approvedRevision` と違う |
| `400` | `layouts` が空、または投稿に使うレイアウトが欠けている |

`409` は、描いている間に OK が取り消されて直された、ということです。その動画は確かめた
ものと違うので受け取りません。

版は上書きしません。OK を取り消して直し、描き直すと v2 になります。
