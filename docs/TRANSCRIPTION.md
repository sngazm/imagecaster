# 文字起こしワーカー仕様

外部Pythonワーカーによる文字起こし処理のためのAPI仕様。

## 概要

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Python Worker   │────▶│   Worker API     │────▶│       R2         │
│  (ローカルPC)    │◀────│  (Cloudflare)    │◀────│   (Storage)      │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### 処理フロー

1. **キュー取得**: Worker APIから文字起こし待ちエピソードを取得（自動ロック）
2. **音声ダウンロード**: Presigned URLで音声ファイルをダウンロード
3. **文字起こし実行**: Whisper等で文字起こし処理
4. **結果アップロード**: Presigned URLでJSONをR2にアップロード
5. **完了通知**: Worker APIに完了を通知（JSON→VTT変換＆保存）

## 認証

**Cloudflare Access Service Token** を使用。

### 発行手順

1. Cloudflare Zero Trust Dashboard → Access コントロール → サービス資格情報
2. 「サービストークンを作成」をクリック
3. Client ID と Client Secret をメモ（**Client Secretは作成時のみ表示**）

### リクエストヘッダー

```
CF-Access-Client-Id: <client_id>
CF-Access-Client-Secret: <client_secret>
```

## API エンドポイント

### GET /api/transcription/queue

文字起こし待ちエピソードを取得（読み取り専用）。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| limit | number | 1 | 取得件数（最大10） |

**レスポンス:**

```json
{
  "episodes": [
    {
      "id": "ep-abc123",
      "slug": "ep-abc123",
      "title": "エピソードタイトル",
      "audioUrl": "https://r2.example.com/episodes/ep-abc123/audio.mp3",
      "duration": 0,
      "lockedAt": ""
    }
  ]
}
```

**注意:** GETはロックを付与しない。処理開始前に `POST /api/episodes/:id/transcription-lock` でロックを取得すること。

---

### POST /api/episodes/:id/transcription-lock

文字起こし処理のロックを取得。処理開始前に必ず呼び出す。

**レスポンス（成功時 200）:**

```json
{
  "success": true,
  "lockedAt": "2024-01-01T00:00:00.000Z",
  "episode": {
    "id": "ep-abc123",
    "slug": "ep-abc123",
    "title": "エピソードタイトル",
    "audioUrl": "https://r2.example.com/episodes/ep-abc123/audio.mp3",
    "duration": 0
  }
}
```

**エラー:**
- 400: エピソードが transcribing 状態でない
- 409: 既にロック済み
- 404: エピソードが存在しない

**ソフトロック:**
- ロックは1時間で自動解除
- ロック中のエピソードはqueueに表示されない

---

### GET /api/episodes/:id/audio-url

音声ファイルダウンロード用のPresigned URLを発行。

**レスポンス:**

```json
{
  "downloadUrl": "https://xxx.r2.cloudflarestorage.com/...",
  "expiresIn": 3600
}
```

---

### POST /api/episodes/:id/transcript/upload-url

文字起こしJSONアップロード用のPresigned URLを発行。

**条件:** エピソードが `transcribing` 状態であること

**レスポンス:**

```json
{
  "uploadUrl": "https://xxx.r2.cloudflarestorage.com/.../transcript.json",
  "expiresIn": 3600
}
```

---

### POST /api/episodes/:id/transcription-complete

文字起こし完了を通知。Worker側でJSON→VTT変換＆保存を実行。

**リクエストボディ:**

```json
{
  "status": "completed",  // または "failed"
  "duration": 3600        // 任意: 音声の長さ（秒）
}
```

**完了時の処理:**
1. R2から `transcript.json` を読み込み
2. VTT形式に変換して `transcript.vtt` として保存
3. メタデータ更新（transcriptUrl, ステータス変更）
4. ロック解除
5. publishAtに応じてステータス設定（scheduled/published/draft）

**レスポンス:**

```json
{
  "success": true,
  "status": "scheduled"  // または "published", "draft", "failed"
}
```

---

### DELETE /api/episodes/:id/transcription-lock

文字起こしロックを手動解除（処理失敗時など）。

**レスポンス:**

```json
{
  "success": true
}
```

## トランスクリプトJSON形式

### 基本構造

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "こんにちは"
    },
    {
      "start": 2.5,
      "end": 5.0,
      "text": "今日は良い天気ですね"
    }
  ],
  "language": "ja"
}
```

### フィールド

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|-----|------|
| segments | array | ✓ | セグメント配列 |
| segments[].start | number | ✓ | 開始時間（秒） |
| segments[].end | number | ✓ | 終了時間（秒） |
| segments[].text | string | ✓ | テキスト |
| segments[].speaker | string | | 話者ID（将来の話者分離用） |
| language | string | | 言語コード（例: "ja"） |

### 話者分離対応

将来の話者分離（diarization）に対応するため、`speaker` フィールドをサポート。

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "こんにちは",
      "speaker": "speaker_0"
    },
    {
      "start": 2.5,
      "end": 5.0,
      "text": "こんにちは！",
      "speaker": "speaker_1"
    }
  ]
}
```

VTT変換時、話者情報がある場合は `<v>` タグが付与される：

```vtt
WEBVTT

1
00:00:00.000 --> 00:00:02.500
<v speaker_0>こんにちは</v>

2
00:00:02.500 --> 00:00:05.000
<v speaker_1>こんにちは！</v>
```

## Pythonワーカー実装例

```python
import requests
import time

API_BASE = "https://caster.image.club/api"
HEADERS = {
    "CF-Access-Client-Id": "<client_id>",
    "CF-Access-Client-Secret": "<client_secret>",
}

def poll_queue():
    """文字起こしキューをポーリング"""
    while True:
        # キューから取得（GETは状態を変えない）
        resp = requests.get(f"{API_BASE}/transcription/queue", headers=HEADERS)
        data = resp.json()

        if data["episodes"]:
            episode = data["episodes"][0]
            process_episode(episode["id"])

        time.sleep(60)  # 1分間隔

def process_episode(episode_id):
    """エピソードを処理"""
    try:
        # 1. ロックを取得
        resp = requests.post(
            f"{API_BASE}/episodes/{episode_id}/transcription-lock",
            headers=HEADERS
        )
        if resp.status_code == 409:
            print(f"Episode {episode_id} is already locked, skipping")
            return
        if not resp.ok:
            print(f"Failed to lock episode {episode_id}: {resp.status_code}")
            return

        lock_data = resp.json()
        episode = lock_data["episode"]

        # 2. 音声ダウンロードURL取得
        resp = requests.get(
            f"{API_BASE}/episodes/{episode_id}/audio-url",
            headers=HEADERS
        )
        audio_url = resp.json()["downloadUrl"]

        # 3. 音声ダウンロード
        audio_resp = requests.get(audio_url)
        audio_path = f"/tmp/{episode_id}.mp3"
        with open(audio_path, "wb") as f:
            f.write(audio_resp.content)

        # 4. Whisperで文字起こし
        transcript_data = transcribe_with_whisper(audio_path)

        # 5. JSONアップロードURL取得
        resp = requests.post(
            f"{API_BASE}/episodes/{episode_id}/transcript/upload-url",
            headers=HEADERS
        )
        upload_url = resp.json()["uploadUrl"]

        # 6. JSONアップロード
        requests.put(
            upload_url,
            json=transcript_data,
            headers={"Content-Type": "application/json"}
        )

        # 7. 完了通知（ロックも自動解除）
        requests.post(
            f"{API_BASE}/episodes/{episode_id}/transcription-complete",
            headers={**HEADERS, "Content-Type": "application/json"},
            json={"status": "completed", "duration": transcript_data.get("duration")}
        )

    except Exception as e:
        print(f"Error processing {episode_id}: {e}")
        # 失敗通知（ロックも自動解除）
        requests.post(
            f"{API_BASE}/episodes/{episode_id}/transcription-complete",
            headers={**HEADERS, "Content-Type": "application/json"},
            json={"status": "failed"}
        )

def transcribe_with_whisper(audio_path):
    """Whisperで文字起こし（実装例）"""
    import whisper

    model = whisper.load_model("large-v3")
    result = model.transcribe(audio_path, language="ja")

    return {
        "segments": [
            {
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip()
            }
            for seg in result["segments"]
        ],
        "language": result["language"]
    }

if __name__ == "__main__":
    poll_queue()
```

## エラーハンドリング

### よくあるエラー

| ステータス | エラー | 原因 |
|-----------|--------|------|
| 400 | "Episode is not in transcribing status" | エピソードがtranscribing状態でない |
| 400 | "Audio file not available" | 音声ファイルがアップロードされていない |
| 400 | "Transcript JSON not found in R2" | JSONがアップロードされていない状態で完了通知 |
| 400 | "Invalid transcript data structure" | JSON形式が不正 |
| 401 | "Unauthorized" | Service Tokenが無効 |
| 404 | "Episode not found" | エピソードが存在しない |

### リトライ戦略

- ネットワークエラー: 指数バックオフでリトライ（2s, 4s, 8s, 16s）
- 400エラー: リトライ不要、ログ出力
- 401エラー: Service Token確認
- 500エラー: 一定時間後にリトライ

## R2ストレージ構造

```
episodes/{id}/
├── meta.json           # メタデータ
├── audio.mp3           # 音声ファイル
├── transcript.json     # 文字起こしJSON（ワーカーがアップロード）
├── transcript.vtt      # VTTファイル（Worker APIが生成）
└── artwork.jpg         # アートワーク（任意）
```
