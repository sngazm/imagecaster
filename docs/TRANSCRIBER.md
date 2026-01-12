# imagecaster-transcriber 仕様書

Podcast音声の自動文字起こしワーカー。ローカルWindows環境で常時稼働し、imagecaster APIと連携して文字起こし処理を実行する。

## 概要

```
┌─────────────────────────────────────────────────────────────────┐
│                    Windows PC (常時稼働)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              imagecaster-transcriber                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │   Poller    │─▶│  Whisper    │─▶│   Uploader      │   │  │
│  │  │  (定期実行)  │  │  (文字起こし) │  │  (結果送信)     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  imagecaster    │
                    │  Worker API     │
                    └─────────────────┘
```

## システム要件

### ハードウェア

| 項目 | 最小 | 推奨 |
|-----|------|------|
| OS | Windows 10 | Windows 11 |
| CPU | 4コア | 8コア以上 |
| RAM | 8GB | 16GB以上 |
| GPU | - | NVIDIA GPU (CUDA対応) |
| ストレージ | 10GB空き | SSD 50GB以上空き |

### ソフトウェア

- Python 3.10以上
- uv（Pythonパッケージマネージャー）
- FFmpeg（PATHに追加）
- CUDA Toolkit 11.8以上（GPU使用時）

## インストール

```bash
# uvインストール（未インストールの場合）
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# リポジトリクローン
git clone https://github.com/sngazm/imagecaster-transcriber.git
cd imagecaster-transcriber

# 依存関係インストール（仮想環境も自動作成）
uv sync

# 設定ファイル作成
copy config.example.yaml config.yaml
```

## 設定ファイル

### config.yaml

```yaml
# imagecaster API設定
api:
  base_url: "https://caster.image.club/api"
  client_id: "your-cf-access-client-id"
  client_secret: "your-cf-access-client-secret"

# ポーリング設定
polling:
  interval_seconds: 60        # キュー確認間隔
  max_concurrent: 1           # 同時処理数（将来拡張用）

# Whisper設定
whisper:
  model: "large-v3"           # tiny, base, small, medium, large, large-v2, large-v3
  device: "cuda"              # cuda または cpu
  language: "ja"              # 言語コード
  compute_type: "float16"     # float16, int8 (faster-whisperの場合)

# 一時ファイル設定
temp:
  directory: "./temp"         # 一時ファイル保存先
  cleanup: true               # 処理完了後に削除

# ログ設定
logging:
  level: "INFO"               # DEBUG, INFO, WARNING, ERROR
  file: "./logs/transcriber.log"
  max_size_mb: 10
  backup_count: 5

# リトライ設定
retry:
  max_attempts: 3
  backoff_seconds: [2, 4, 8]  # 指数バックオフ
```

## ディレクトリ構成

```
imagecaster-transcriber/
├── src/
│   └── imagecaster_transcriber/
│       ├── __init__.py
│       ├── __main__.py          # エントリーポイント
│       ├── config.py            # 設定読み込み
│       ├── api_client.py        # imagecaster APIクライアント
│       ├── transcriber.py       # Whisper文字起こし処理
│       ├── worker.py            # メインワーカーループ
│       └── utils/
│           ├── __init__.py
│           ├── logging.py       # ログ設定
│           └── retry.py         # リトライ処理
├── tests/
│   ├── __init__.py
│   ├── test_api_client.py
│   ├── test_transcriber.py
│   └── test_worker.py
├── config.example.yaml
├── config.yaml              # .gitignore対象
├── pyproject.toml           # プロジェクト設定・依存関係
├── uv.lock                  # ロックファイル
├── README.md
└── run.bat                  # Windows起動スクリプト
```

## 処理フロー

### 1. 起動シーケンス

```
1. 設定ファイル読み込み
2. ログ初期化
3. Whisperモデルロード（初回のみ、キャッシュあり）
4. API接続確認（/api/health）
5. メインループ開始
```

### 2. メインループ

```python
while True:
    try:
        # 1. キューから取得
        episodes = api.get_transcription_queue(limit=1)

        if episodes:
            episode = episodes[0]
            process_episode(episode)

        # 2. 次のポーリングまで待機
        time.sleep(config.polling.interval_seconds)

    except KeyboardInterrupt:
        logger.info("Shutdown requested")
        break
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        time.sleep(60)  # エラー時は1分待機
```

### 3. エピソード処理フロー

```
┌─────────────────────────────────────────────────────────────┐
│                    process_episode()                         │
├─────────────────────────────────────────────────────────────┤
│  1. 音声ダウンロードURL取得                                   │
│     GET /api/episodes/{id}/audio-url                        │
│                          │                                   │
│                          ▼                                   │
│  2. 音声ファイルダウンロード                                  │
│     GET {presigned_url} → temp/{id}.mp3                     │
│                          │                                   │
│                          ▼                                   │
│  3. Whisperで文字起こし                                      │
│     whisper.transcribe(temp/{id}.mp3)                       │
│                          │                                   │
│                          ▼                                   │
│  4. JSONアップロードURL取得                                   │
│     POST /api/episodes/{id}/transcript/upload-url           │
│                          │                                   │
│                          ▼                                   │
│  5. JSONアップロード                                         │
│     PUT {presigned_url} ← transcript.json                   │
│                          │                                   │
│                          ▼                                   │
│  6. 完了通知                                                 │
│     POST /api/episodes/{id}/transcription-complete          │
│                          │                                   │
│                          ▼                                   │
│  7. 一時ファイル削除                                         │
│     delete temp/{id}.mp3                                    │
└─────────────────────────────────────────────────────────────┘
```

## APIクライアント仕様

### ImagecasterClient クラス

```python
class ImagecasterClient:
    def __init__(self, base_url: str, client_id: str, client_secret: str):
        """APIクライアント初期化"""

    def health_check(self) -> bool:
        """API疎通確認"""

    def get_transcription_queue(self, limit: int = 1) -> list[Episode]:
        """文字起こしキュー取得"""

    def get_audio_url(self, episode_id: str) -> str:
        """音声ダウンロードURL取得"""

    def get_transcript_upload_url(self, episode_id: str) -> str:
        """JSONアップロードURL取得"""

    def upload_transcript(self, upload_url: str, data: dict) -> None:
        """JSONアップロード"""

    def complete_transcription(
        self,
        episode_id: str,
        status: Literal["completed", "failed"],
        duration: float | None = None
    ) -> dict:
        """完了通知"""

    def release_lock(self, episode_id: str) -> None:
        """ロック解除"""
```

### Episode データ型

```python
@dataclass
class Episode:
    id: str
    slug: str
    title: str
    audio_url: str
    duration: float
    locked_at: str
```

## Transcriber仕様

### WhisperTranscriber クラス

```python
class WhisperTranscriber:
    def __init__(
        self,
        model: str = "large-v3",
        device: str = "cuda",
        language: str = "ja",
        compute_type: str = "float16"
    ):
        """Whisperモデル初期化"""

    def transcribe(self, audio_path: str) -> TranscriptResult:
        """
        音声ファイルを文字起こし

        Returns:
            TranscriptResult: 文字起こし結果
        """

    def is_model_loaded(self) -> bool:
        """モデルロード状態確認"""
```

### TranscriptResult データ型

```python
@dataclass
class TranscriptResult:
    segments: list[Segment]
    language: str
    duration: float

    def to_dict(self) -> dict:
        """API送信用dict形式に変換"""

@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None  # 将来の話者分離用
```

### 出力JSON形式

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.56,
      "text": "こんにちは、今日のエピソードでは"
    },
    {
      "start": 2.56,
      "end": 5.12,
      "text": "最新の技術トレンドについてお話しします"
    }
  ],
  "language": "ja"
}
```

## コマンドライン

### 基本起動

```bash
# 通常起動（デーモンモード）
uv run imagecaster-transcriber

# 設定ファイル指定
uv run imagecaster-transcriber --config /path/to/config.yaml

# デバッグモード
uv run imagecaster-transcriber --debug

# 一回だけ実行（テスト用）
uv run imagecaster-transcriber --once
```

### オプション

| オプション | 短縮 | 説明 |
|-----------|------|------|
| `--config` | `-c` | 設定ファイルパス |
| `--debug` | `-d` | デバッグログ有効化 |
| `--once` | `-1` | 1回だけ実行して終了 |
| `--dry-run` | | API呼び出しをスキップ |
| `--version` | `-v` | バージョン表示 |

### Windows起動スクリプト (run.bat)

```batch
@echo off
cd /d "%~dp0"
uv run imagecaster-transcriber %*
```

### タスクスケジューラ登録（自動起動）

```batch
:: 管理者権限で実行
schtasks /create /tn "ImagecasterTranscriber" /tr "C:\path\to\run.bat" /sc onstart /ru SYSTEM
```

## ログ出力

### ログ形式

```
2024-01-15 10:30:00 [INFO] Starting imagecaster-transcriber v1.0.0
2024-01-15 10:30:01 [INFO] Whisper model loaded: large-v3 (cuda)
2024-01-15 10:30:02 [INFO] API health check: OK
2024-01-15 10:30:02 [INFO] Starting main loop (interval: 60s)
2024-01-15 10:31:02 [INFO] Polling queue...
2024-01-15 10:31:02 [INFO] Found 1 episode(s) in queue
2024-01-15 10:31:02 [INFO] Processing: ep-abc123 "第10回：最新技術トレンド"
2024-01-15 10:31:03 [INFO] Downloading audio (15.2 MB)...
2024-01-15 10:31:10 [INFO] Transcribing with Whisper...
2024-01-15 10:35:45 [INFO] Transcription complete (duration: 3600.5s, segments: 842)
2024-01-15 10:35:46 [INFO] Uploading transcript JSON...
2024-01-15 10:35:47 [INFO] Notifying completion...
2024-01-15 10:35:48 [INFO] Episode ep-abc123 completed successfully
```

### ログレベル

| レベル | 用途 |
|-------|------|
| DEBUG | 詳細なデバッグ情報 |
| INFO | 通常の処理ログ |
| WARNING | 警告（リトライ発生など） |
| ERROR | エラー（処理失敗） |

## エラーハンドリング

### リトライ対象

| エラー種別 | リトライ | 対応 |
|-----------|---------|------|
| ネットワークエラー | ✓ | 指数バックオフ |
| 5xx サーバーエラー | ✓ | 指数バックオフ |
| 4xx クライアントエラー | ✗ | ログ出力、スキップ |
| Whisperエラー | ✗ | failed通知、スキップ |
| ファイルI/Oエラー | ✗ | failed通知、スキップ |

### エラー時の処理

```python
def process_episode(episode: Episode) -> None:
    try:
        # 処理...
        api.complete_transcription(episode.id, "completed", duration)
    except RetryableError as e:
        logger.warning(f"Retryable error: {e}")
        raise  # 上位でリトライ
    except Exception as e:
        logger.error(f"Failed to process {episode.id}: {e}")
        try:
            api.complete_transcription(episode.id, "failed")
        except:
            api.release_lock(episode.id)  # 最低限ロック解除
```

### グレースフルシャットダウン

```python
def signal_handler(signum, frame):
    logger.info("Shutdown signal received")
    # 現在処理中のエピソードがあれば完了を待つ
    worker.shutdown(wait=True, timeout=300)  # 最大5分待機
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)
```

## 監視・運用

### ヘルスチェック

```python
# HTTPエンドポイント（オプション）
# localhost:8080/health で状態確認可能
{
    "status": "running",
    "uptime_seconds": 3600,
    "model_loaded": true,
    "last_poll": "2024-01-15T10:31:02Z",
    "processed_today": 5,
    "errors_today": 0
}
```

### メトリクス（将来拡張）

- 処理済みエピソード数
- 平均処理時間
- エラー率
- GPU使用率

## 依存関係

### pyproject.toml

```toml
[project]
name = "imagecaster-transcriber"
version = "0.1.0"
description = "Podcast transcription worker for imagecaster"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    # Core
    "pyyaml>=6.0",
    "httpx>=0.27",
    "pydantic>=2.0",
    # Whisper
    "faster-whisper>=1.0.0",
    # Utilities
    "colorlog>=6.0",
]

[project.scripts]
imagecaster-transcriber = "imagecaster_transcriber.__main__:main"

[tool.uv]
dev-dependencies = [
    "pytest>=8.0",
    "pytest-cov>=4.0",
    "pytest-asyncio>=0.24",
    "ruff>=0.8",
    "mypy>=1.0",
]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.mypy]
python_version = "3.10"
strict = true

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/imagecaster_transcriber"]
```

## テスト

```bash
# 全テスト実行
uv run pytest

# カバレッジ付き
uv run pytest --cov=src --cov-report=html

# 特定テスト
uv run pytest tests/test_transcriber.py -v

# リント
uv run ruff check .

# 型チェック
uv run mypy src
```

## 将来の拡張予定

1. **話者分離（Diarization）**
   - pyannote-audioとの連携
   - speaker フィールドの自動付与

2. **複数エピソード並列処理**
   - max_concurrent設定の有効化
   - GPUメモリ管理

3. **Webhookモード**
   - ポーリングではなくWebhook受信
   - よりリアルタイムな処理

4. **Dockerコンテナ化**
   - GPU対応Dockerイメージ
   - docker-compose設定
