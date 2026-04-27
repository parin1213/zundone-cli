# zundone-cli

VOICEVOX エンジン経由でテキストを読み上げる小さな CLI です。

English README: [README.en.md](./README.en.md)

この CLI は macOS の `VOICEVOX.app` 前提ではありません。HTTP で VOICEVOX API を叩き、必要なら Docker でローカル engine を起動できます。

## できること

- 既に起動している VOICEVOX engine に接続する
- Docker ベースのローカル engine を起動する
- 合成した音声を WAV として保存する
- OS ごとのプレイヤーで音声を再生する

## 必要なもの

- Node.js 20+
- 以下のどちらか
  - 到達可能な VOICEVOX engine URL
  - `zundone engine up` を使うなら Docker

## インストール

```bash
npm i -g zundone-cli                  # npm
pnpm add -g zundone-cli               # pnpm
mise use -g npm:zundone-cli@latest    # mise
```

`zundone` と `zd` の 2 つのバイナリが入ります (`zd` は短いエイリアス)。

## ソースからの開発

```bash
pnpm install
pnpm dev -- "done"   # tsx 経由で src/cli.ts を実行
pnpm build           # tsup → dist/cli.js
pnpm test            # vitest
pnpm typecheck
```

## 技術構成

- `src/`: 人が編集する TypeScript ソース
- `dist/`: `tsup` が生成する配布用ビルド
- `cac`: command / option / help の定義
- `vitest`: テスト
- `.mise.toml`: Node / pnpm のローカル固定

## backend

- `docker`
  - 既定値
  - engine に繋がらない場合、Docker container を作成または起動できる
- `http`
  - 指定 URL に対してのみ通信する
  - Docker の自動起動はしない

主な環境変数:

- `ZUNDONE_BACKEND=docker|http`
- `VOICEVOX_URL`
- `ZUNDONE_DOCKER_CONTAINER`
- `ZUNDONE_DOCKER_IMAGE`
- `ZUNDONE_DOCKER_PORT`

`VOICEVOX_URL` 未指定時は `http://127.0.0.1:$ZUNDONE_DOCKER_PORT` を使い、未指定なら `50021` です。

## 使い方

```bash
zundone [options] [text...]
echo "text" | zundone
zundone --done
zundone list
zundone engine status
zundone engine up
zundone engine down
zundone cache-info
```

## 例

Docker 管理の engine を使う:

```bash
zundone engine up
zundone "done"
```

既存の HTTP engine を使う:

```bash
ZUNDONE_BACKEND=http zundone -u http://127.0.0.1:50021 "done"
```

PowerShell:

```powershell
$env:ZUNDONE_BACKEND = "http"
zundone -u http://127.0.0.1:50021 "done"
```

保存だけして再生しない:

```bash
zundone --no-play --output done.wav "done"
```

## engine コマンド

```bash
zundone engine status
zundone engine up
zundone engine down
zundone engine logs
```

`engine up` は container が無ければ作成します。

## 再生

再生は OS ごとの利用可能コマンドに依存します。

- macOS: `afplay`, `paplay`, `play`, `ffplay`
- Linux: `paplay`, `aplay`, `play`, `ffplay`
- Windows: PowerShell `Media.SoundPlayer`

手動指定:

- `ZUNDONE_PLAYER`
- `ZUNDONE_PLAYER_ARGS`

再生が不要なら `--no-play` を使います。

## キャッシュ

既定では `env-paths("zundone")` の OS 標準 cache ディレクトリを使います。

- macOS: `~/Library/Caches/zundone`
- Linux: `~/.cache/zundone`
- Windows: `%LOCALAPPDATA%\zundone\Cache`

上書きや無効化:

- `ZUNDONE_CACHE_DIR`
- `ZUNDONE_NO_CACHE=1`

## 補足

- `dist/` は生成物です。編集は `src/` 側で行います
- `engine up` は Docker 公開ポートと `VOICEVOX_URL` のポート一致を前提にしています

## License

MIT
