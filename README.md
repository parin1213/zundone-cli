# zundone-cli

VOICEVOX のずんだもんで喋るための小さな CLI です。Mac 上で `say` の代わりに使う想定で、テキスト読み上げ、完了フレーズのランダム再生、WAV キャッシュをまとめています。

## Requirements

- macOS
- Node.js 20+
- VOICEVOX engine
  - 既定値: `http://127.0.0.1:50021`
  - macOS では engine 未起動時に `VOICEVOX.app` の自動起動を試みます

## Install

ローカル実行:

```bash
node ./zundone.mjs "終わったのだ"
```

グローバルに使う場合:

```bash
npm install -g .
```

または:

```bash
pnpm link --global
```

`zundone` と `zd` の 2 つのコマンド名で使えます。

## Usage

```bash
zundone [options] [text...]
echo "テキスト" | zundone
zundone --done
zundone help
zundone list
zundone clear-cache
zundone cache-info
zundone cache-path
```

## Examples

```bash
zundone "終わったのだ"
zundone -r 1.3 "早口ずんだもん"
zundone -v 3 "ノーマルで読むのだ"
zundone -o done.wav --no-play "保存だけするのだ"
zundone --done
zundone --prewarm-done
echo "標準入力から読むのだ" | zundone
```

## Options

- `-v, --voice <id|name>`: 話者 ID または名前
- `-r, --rate <float>`: 話速
- `-p, --pitch <float>`: ピッチ
- `--volume <float>`: 音量
- `--intonation <float>`: 抑揚
- `-o, --output <path>`: WAV 保存先
- `--no-play`: 再生しない
- `-u, --url <url>`: VOICEVOX engine URL
- `-l, --list`: 話者一覧を表示
- `-q, --quiet`: 補助ログを抑制
- `--done`: 完了フレーズをランダム再生
- `--prewarm-done`: 完了フレーズ群を事前キャッシュ
- `--no-cache`: キャッシュを無効化
- `--clear-cache`: キャッシュ削除
- `--cache-info`: キャッシュ情報表示
- `--no-autolaunch`: `VOICEVOX.app` 自動起動を無効化
- `-h, --help`: ヘルプ表示

## Environment Variables

- `VOICEVOX_URL`: engine URL
- `ZUNDONE_SPEAKER`: 既定の話者
- `ZUNDONE_CACHE_DIR`: キャッシュ保存先
- `ZUNDONE_NO_CACHE=1`: キャッシュ無効化
- `ZUNDONE_NO_AUTOLAUNCH=1`: 自動起動無効化

## Notes

- 実装は `afplay`、`open`、`osascript` を使うため、現状は macOS 前提です
- キャッシュは既定で `~/.cache/zundone` に保存されます
- `.wav`、`.env*`、ログは `.gitignore` 済みです
