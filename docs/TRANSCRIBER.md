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
  prompt_file: "prompt.txt"   # initial_prompt を読むファイル
  hotwords: ["Image Cast", "Image Club", "あずま", "鉄塔"]  # 毎ウィンドウ見せる語彙
  hotwords_from_description: true   # 概要から固有名詞を claude に抜かせて足す
  hotwords_max_chars: 80            # 直前の文脈と枠を分け合うので長くしない

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

# 完了通知（メール）
notification:
  enabled: false
  smtp_host: "smtp.gmail.com"
  smtp_port: 587
  username: ""
  password: ""              # Gmail はアプリパスワードが必要
  to_address: ""
  episode_url_template: "https://cast.image.club/episodes/{id}/"
```

### initial_prompt について

`prompt_file` に番組名や出演者名を書いておくと、固有名詞の認識精度が上がる。
Whisper はプロンプトの書き方を出力に引き継ぐため、**句読点付きの文を書いておくと
出力にも句読点が付く**。逆にプロンプトが無いと句読点の付かない文字起こしになる。

```
この音声はポッドキャスト番組「Image Cast」です。話しているのは「あずま」と
「鉄塔(てっとう)」です。技術、デザイン、表現などについての雑談です。
```

### 句読点の復元について

Whisper の句読点は初期プロンプトの文体が窓から窓へ伝播している副作用で、脆い。
`punctuate.py` が全文を claude に渡し、「各行が日本語の文として成立するように」
「、」「。」「？」「！」を入れさせる（8 文字以上の行が 1 つでも句読点を欠く窓を渡す。
基準は窓の割合ではなく行ごとの文の成立で、それは claude が見る）。以前は「窓の 15% 未満」
の区間だけを対象にしていたが、hotwords 以降は句読点の付く行と付かない行が交互に出るため
一度も反応せず、#281 の 30〜45 分が読点なしのまま公開された。読点の欠落は CER にも話者一致にも監査にも映らないので、
`scripts/transcript-eval/punct_check.py` で時間帯ごとに確かめる。

### 節の中で話者を揃える

単語ごとの音量判定は、相手の相槌や笑いが被った単語だけを相手のものにするので、
「いろい｜ろこうリ｜ハビリをしていって」のように一つの発話が語の途中で割れて 2 人に
振られる（#281 で話者交代の 37% が文の途中に落ちていた）。`speaker.py` は単語に話者を
付けたあと、節（読点・句点、または 0.3 秒以上の間で区切られる単位）の中で多数派が
7 割以上なら、明白でない少数派の単語を多数派に揃える。相手が黙っている間の「うん」の
ように音量が言い切っている交代は触らない。半々の節（冒頭の掛け合い）も触らない。

### hotwords について

`initial_prompt` は最初の 30 秒の窓にしか効かない。2 つ目の窓からは直前の認識結果が
プロンプトになり、番組名も出演者名も消える（#281 では 12 分で句読点が消えたのと
同じ仕組み）。`whisper.hotwords` に書いた語は faster-whisper が**毎ウィンドウ**
プロンプトの先頭に差し込むので、固有名詞はこちらで効かせ続ける。

その回の出演者名（トラックの話者名）は自動で先頭に足される。ゲスト名はここからしか
取れない。`hotwords_from_description` を有効にすると、概要の要約から固有名詞
（書名・出版社・作品名）を claude に抜かせて足す。概要に無い綴りは採らない。

#281 では「藤原まりな → 藤原麻里菜」「無駄作り → 無駄づくり」「左右者 → 左右社」
「鉄道 → 0 件」がこれで直った。本文全体の誤り率は変わらない。

### トラックからの拾い直し（track_recovery）

ミックス音源の Whisper は **30 秒のウィンドウを丸ごと落とす**ことがある。#281 では
3 箇所・計 87 秒・約 670 文字が公開サイトから消えていた。位置は実行のたびに変わり、
`no_speech_threshold` を切っても消えない（別の場所に移るだけ）。無音を聞く拾い直し
（gaps.py）は「複数トラックが鳴っている」区間を見送るので、相手の笑いが重なった穴は
埋まらなかった。

話者トラックがある回では、各トラックを丸ごと 1 回文字起こしし（3 トラックで 5 分半）、
次の 2 条件を満たす発話だけをミックスの文字起こしに足す。

- 本人のトラックが優勢: その区間で鳴っているフレームの大半で本人が最大（回り込みを弾く）
- ミックス側に本文が無い: 同じ時刻のミックスの単語列に、その本文がほとんど現れない

足す前に、相槌・笑いだけの本文と 4 文字未満は捨て、離れた場所で一字一句同じ文が
出たもの（Whisper の既定出力）も捨てる。トラックの無音や叫び声を聞いた Whisper は
外国語の断片（「groß Шok ze Pechount」）や同じ語の繰り返し（「自分の自分の自分の…」）を
返すので、日本語以外の文字が混じるもの・繰り返しが本文の大半を占めるものも捨てる。
「既にある発話」の判定は ±1.5 秒で見る。同じ発話でもトラック側とミックス側で時刻が
1 秒ほどずれることがあり、狭く見ると二重に足す。

ほかに、トラックを聞かせた Whisper に固有の癖が 2 つある。句の切れ目ごとに全角の
「１」を吐くことがある（「私が１本当なんか１個人的な１記録」。ミックス側には出ない。
Whisper が数を書くときは半角なので、他の数字が隣に無い全角の「１」がそのトラックに
繰り返し出ていれば落とす）。相手が喋っている間の物音に対して、ミックスにも語彙にも無い
ラテン文字の語（「vecinos」「Continue um」）や相槌だけの本文を返すので、それも足さない。
10 文字未満の短い断片は、本人のトラックが 7 割以上のフレームで最大のときだけ足す。

出力側で弾く前に、**入力側で聞かせない**。無音や相手の声の回り込みを Whisper に聞かせる
こと自体がハルシネーションの原因なので、トラックの波形のうち「本人が鳴っていて、かつ
他の誰より大きい」区間（前後 0.5 秒の余白、1 秒以下の間は繋ぐ、0.3 秒未満の島は捨てる）
だけを残し、それ以外を無音にした音声を渡す。聞かせる長さがトラックの 3 分の 1 程度に
なるので、時間も縮む。

無音化の切れ目には 50 ミリ秒のフェードを付ける。急に切ると Whisper がそこでつまずいて
同じ句を言い直す（「家買ったりとかしたのって、あの、家買ったりとかしたのって」）。それでも
出た言い直しは、同じ句が連続していれば一つに畳む。Whisper 自身がセグメントに付ける
統計（圧縮率 > 2.2、対数確率 < -1.0）も見て、疑っているものは足さない。

Whisper の出力にアラビア文字・キリル文字などが混じるセグメントは、ミックスでもトラックでも
出た時点で捨てる（`transcriber.py`）。無音や被りに対する多言語のハルシネーションで、
#281 では「قطになitor」がミックス側から公開まで通っていた。`scripts/audit-site.mjs` も
これを見る。同じ場所で、圧縮率（`compression_ratio`）が 2.4 を超えるセグメントも捨てる。
笑い声を「キャキャキャキャ…」と 40 回書く類で、Whisper 自身が temperature fallback の
判定に使う既定値と同じしきい値。

拾った発話は、誰のトラックから出たかで話者が確定している（`Segment.pinned`）。
後段の話者分離と聞き分けはこれに触らない。触ると、相手の相槌が被った単語だけが相手の
ものになり「そうそうそう、」のような行が湧く。トラック側のセグメント時刻は VAD で 30 秒を
超えてまたがることがあるので、単語の時刻で切り直してから使う。

```yaml
recovery:
  from_tracks: true          # 話者トラックから拾うか
  track_min_dominance: 0.4   # 本人が最大のフレームの割合。下回れば回り込み
  track_max_covered: 0.4     # ミックスの近くにこれ以上本文があれば落ちていない
  track_min_chars: 4
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
    speaker: str | None = None  # 話者名（話者分離を使った場合）
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

## 話者分離

話者ごとにトラックが分かれた音声（DAW からのトラック別書き出し）があれば、区間ごとの
音量を比較して話者を判定する。機械学習モデルによる diarization と違い、トラックが
分かれている限り確実に判定できる。

### SpeakerIdentifier クラス

```python
class SpeakerIdentifier:
    def __init__(
        self,
        tracks: list[SpeakerTrack],
        frame_sec: float = 0.2,
        silence_threshold: float = 0.005,
        normalize: bool = True,
    ):
        """話者トラックから判定器を初期化"""

    def load_tracks(self) -> None:
        """全トラックを読み込み、フレームごとの RMS を事前計算"""

    def check_alignment(self, audio_duration: float) -> bool:
        """本編とトラックの尺が揃っているか検証"""

    def judge(self, start: float, end: float) -> SpeakerVerdict:
        """区間の話者を判定する（同時発話も検出）"""

    def identify_speakers(self, segments: list[Segment]) -> list[Segment]:
        """セグメント単位で話者を割り当てる"""

    def split_by_speaker(self, segments: list[Segment]) -> list[Segment]:
        """節を単位に話者を決め、話者が変わる位置で分割する"""
```

### セグメントの切り直し（節を単位に決める）

Whisper のセグメント境界は音響的な切れ目であって話者の切れ目ではない。そのため
「A さんの発言 + B さんの相槌」が 1 セグメントに同居し、音量の多数決でどちらか
一方に倒れてしまう。

`WhisperTranscriber.transcribe(word_timestamps=True)` で単語ごとの時刻を取得しておくと、
`split_by_speaker()` が話者の変わる位置でセグメントを分け直す。

単語ごとの音量の argmax で切ると、相手の相槌や笑いが被った単語だけが相手に振られ、
「いろい｜ろこうリ｜ハビリ」のように一つの発話が語の途中で割れる（#281 では話者交代の
37% が文の途中に落ちていた）。そこで**節（句読点か 0.3 秒以上の間で区切られる単位）を
最小単位**にする。節は Whisper のセグメント境界をまたいで作る（境界は語の途中にも落ちる）。

1. 単語ごとに argmax で話者を仮に決める。単語の中で話者が変わっている（頭は直前の単語と
   同じ人、終わりは別の人）なら、終わりの側の人にする。Whisper は発言の最初の語の開始
   時刻を前の発言の終わりまで伸ばすので、開始時刻は当てにならず終了時刻は当てになる
2. 単語を「同じ人・同じ競り具合（本人以外のトラックも鳴っているか）」で run にまとめ、
   競っておらず判定に足る長さ（0.3 秒・2 文字以上）で本人だけが鳴っている run を
   **明白な run** とする
3. 節の中で 7 割を占める人がいればその人の節。明白な少数派（本人だけが鳴っている
   「うん」）だけ独立させ、競っている少数派は多数派に揃える（隣に同じ人の明白な run が
   あればそこに付ける）
4. 7 割に届かない節は、明白な run を錨にして競っている部分を近いほうに付ける。錨が
   無ければ節を丸ごと一つにして印（`uncertain`）を付け、聞き分けに回す。単語で割って
   聞かせても短すぎて照合できないが、節ごとなら本人のトラックに同じ言葉が入っている
5. 同じ人の隣り合う塊は、句点をまたがない範囲で繋ぐ。ただし 10 秒・120 字まで。節は
   Whisper のセグメント境界をまたぐので、繋ぎ続けると 25 秒の行になり、Worker の統合
   （20 秒・200 字まで）がその前の短い行を繋げずに置き去りにする
6. 聞き分けのあと、同じ人の隣り合う行を文の中で繋ぎ直す（`arbitrate.rejoin_same_speaker`）。
   印の有無で分けていた「確かに、」「そうですね。」が別の行のままだと、Worker が後者を
   相槌として落として「確かに、」だけが孤立する

以前あった「音量が小さい交代は直前の話者を保つ」規則は外した。小声の話者の短い問い
（「え、なんですか?」）を直前の話者に渡していたため。相手のトラックが黙っていれば小さくても
本人、決められなければ印を付けて聞き分けに回す。

### 同時発話

2 人が同時に同じ言葉を言う区間（番組冒頭で声を揃えて番組名を言う、など）は
`あずま・鉄塔` のように連結した話者名になる。

**既定では検出しない。** 本編の会話中まで検出を効かせると、相槌のかぶりや同時に笑った
箇所を拾ってしまい、誤検出のほうが圧倒的に多くなる（実測で 50 分のエピソードに 38 件
検出され、本物は冒頭の 1 件だけだった）。`simultaneous_until_sec` に冒頭からの秒数を
指定した場合のみ、その範囲で検出する。

範囲の中では、フレームごとに 2 番目に大きいトラックが最大トラックの 55% 以上であれば
「同時に鳴っているフレーム」とし、区間の発話フレームの半分以上がそれに該当する場合を
同時発話と判定する。ただし 3 フレーム未満、または 0.3 秒未満の区間は採らない。

### 判定方法

1. 各トラックを 16kHz モノラルにデコードし、0.2 秒フレームごとの RMS を事前計算する
2. マイクのゲイン差で判定が偏らないよう、トラックごとの音量を揃える（95 パーセンタイル基準）
3. 判定したい区間のフレームごとに最大音量のトラックを求め、その多数決で話者を決める。
   同数なら勝ったフレームの音量の合計で決める（0.2 秒刻みでは 0.3 秒の単語が 2 フレームに
   しかならず、同数はよく起きる）。フレーム範囲は区間の端を近いフレーム境界に丸める
4. 無音しきい値を超えるフレームが 1 つも無ければ話者なし（`None`）とする

セグメント全体の平均音量を比べる方式では、短い相槌や大きな笑い声に引きずられて
セグメント全体が誤った話者に倒れる。フレーム単位の多数決はこれを避ける。

音声のデコードには faster-whisper 同梱の PyAV デコーダを使うため、ffmpeg バイナリの
インストールは不要。

### トラックの割り当て

zip 内のファイル名末尾の `Track N` からトラック番号を読み、割り当て表で話者名を引く。
macOS が作る zip はファイル名が化けることがあるため、展開時に `track_N.拡張子` へ
付け替えている。

ラベルに `None` を割り当てたトラック（BGM・効果音など）は判定候補から除外する。
除外しないと、全員が黙っている区間が BGM トラックに誤判定される。

### タイムラインの前提

本編音声とトラックのタイムラインが一致していることが前提。編集で頭出しやカットが入って
ずれていると判定結果が丸ごと無意味になるため、`check_alignment()` で尺の乖離を警告する。

## 将来の拡張予定

1. **複数エピソード並列処理**
   - max_concurrent設定の有効化
   - GPUメモリ管理

2. **Webhookモード**
   - ポーリングではなくWebhook受信
   - よりリアルタイムな処理

3. **Dockerコンテナ化**
   - GPU対応Dockerイメージ
   - docker-compose設定
