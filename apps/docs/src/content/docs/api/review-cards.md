---
title: 確認カード API
description: 機械が決められなかった箇所を、人が音声を聞いて決める
sidebar:
  order: 7
---

文字起こしの校正で、機械が「怪しいが決められない」とした行を、管理画面で 1 枚ずつ決める
ための API です。カードを作るのは文字起こしを回すマシン（transcriber の見直しの段）、
決めるのは人です。管理画面では **エピソード一覧の上** と、エピソード編集画面の
「怪しい箇所を聞いて確かめる」から開けます（`/episodes/:id/review`）。

**人が確認した結果はカードに残します。** 修正規則（`transcriptCorrections`）はそこから作る
派生物で、取り直しで本文が変われば失効して消えます。消えても、確認した行の全文はカードに
あるので、前回の判断を添えてカードが戻ってきます。

## カードの形

```typescript
interface ReviewCard {
  id: string;
  start: number;          // 行の時刻（秒）
  end: number;
  line: string;           // カードを作ったときの行の本文
  reason: string;         // なぜ引っかかったか
  candidates: string[];   // 直したあとの行の形の候補（行まるごと）。無いこともある
  whisper?: string;       // 校正前の音声認識の出力（前の校正が手を入れた行だけ）
  source: "suspicion" | "readback";
  createdAt: string;
  // 人が決めた結果。text は確認した行の全文
  resolution?: {
    action: "keep" | "fix";
    text: string;
    at: string;
    correction?: { from: string; to: string };  // fix のときに登録した修正
  };
}
```

`episodes/{storageKey}/review-cards.json` に `{ cards: ReviewCard[] }` の形で保存します。

## PUT /api/episodes/:id/review-cards

機械が決められなかった箇所を受け取ります。

```typescript
{
  cards: Array<{
    start: number; end: number; line: string;
    reason?: string; candidates?: string[]; whisper?: string;
    source?: "suspicion" | "readback";
  }>;
}
```

| いまあるカード | どうなるか |
|---|---|
| 人が決めたカード | 残す（取り直しをまたいで持ち越す） |
| まだ決めていない機械のカード | 届いたもので入れ替える。校正を回し直すたびに機械の見立ては変わるので、古い問いを残さない |

人が確認済みの文面と同じ行について機械がもう一度聞いてきたら、そのカードは捨てます。
空の一覧も受け付けます（前回の問いが、今回の校正で解けて要らなくなった場合）。

```typescript
{ success: boolean; received: number; cards: number; open: number }
```

## GET /api/episodes/:id/review-cards

**開いているカード**を、いまの本文と前後の行を添えて返します。開いているとは、まだ人が
決めていないか、決めた結果が本文から消えていることです。

```typescript
{
  episodeId: string;
  title: string;
  audioUrl: string | null;
  cards: Array<ReviewCard & {
    current: { start: number; end: number; text: string; speaker?: string } | null;
    before: string[];    // 前の 2 行
    after: string[];     // 後ろの 2 行
    reopened: boolean;   // 前に決めた結果が、取り直しなどで本文から消えている
  }>;
  decided: number;       // 決め終わっている枚数
}
```

- `current` は、カードの時刻にいちばん長く重なる行です。公開用の `transcript.json` ではなく、
  生データから作り直した本文（この回かぎりの修正まで当てたもの）を使います。決めた直しは
  この本文から探して登録するので、見せるものと登録の土台を同じにしてあります
- 戻ってきたカード（`reopened`）の `candidates` は、**前に人が確認した文面**です。大半は
  1 タップで入れ直せます
- 機械の候補は、カードを作ったときから行が変わっていたら返しません

### 確認がまだ有効かの判定

その時刻（±2 秒）に重なる行を繋いで空白を詰めたものに、確認した文面が含まれていれば有効です。
整形の設定を変えて 1 行が 2 行に割れても、隣と繋がっても、有効なままです。

## POST /api/episodes/:id/review-cards/:cardId/resolve

人が決めた結果を受け取ります。

```typescript
{
  action: "keep" | "fix";  // keep: いまの形で正しい / fix: text にする
  text?: string;           // fix のとき。直したあとの行の全文
  expected?: string;       // 画面で見ていた行の本文。違っていたら 409
}
```

`fix` は、行の直しを**行の中でちょうど 1 箇所に決まる形**の修正にして、その行の時刻と
`source: "human"` を付けて登録します（[この回かぎりの修正](/features/transcription/)と同じ仕組み）。

**公開サイトはすぐには作り直しません。** 1 枚決めるたびにビルドを走らせると、50 枚で 50 回
走ります。`index.json` の `webRebuildPending` を立てるだけにして、Cron（5 分おき）が 1 回に
まとめます。

| ステータス | 意味 |
|---|---|
| `200` | 決めた |
| `400` | `action` が不正、`fix` なのに `text` が無い、文字起こしが無い |
| `404` | 回かカードが無い |
| `409` | 画面を開いてから本文が変わっている、その時刻に行が無い、直す場所が決まらない |

## DELETE /api/episodes/:id/review-cards/:cardId/resolution

決めた結果を取り消します。スワイプで決める画面は押し間違いが起きるためです。直していた場合は、
そのとき登録した修正も外して整形をやり直します。

```typescript
{ success: boolean; removed: number }  // removed: 外した修正の数
```

## GET /api/review-cards/pending

確認待ちのカードがある回の一覧です。`index.json` の `reviewCardIds` に載っている回だけを
読みます（全エピソードを走査すると Worker のリソース制限に達するため、切り抜き動画の
`clipRequestIds` と同じ持ち方です）。

```typescript
{ episodes: Array<{ episodeId: string; title: string; open: number }> }
```

ここの `open` は、まだ決めていない枚数だけです。取り直しで戻ってきたカードは、新しい
生データが届いたとき（`transcription-complete`）と、その回のカードを開いたときに数え直して
一覧に戻します。
