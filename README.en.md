# zundone-cli

Small CLI for speaking text through a VOICEVOX engine.

Japanese README: [README.md](./README.md)

The CLI is no longer tied to a macOS app install. It talks to a VOICEVOX HTTP API and can:

- connect to an already running engine
- start a local Docker-based engine
- save synthesized audio as WAV
- optionally play the generated audio with a system player

## Requirements

- Node.js 20+
- One of:
  - a reachable VOICEVOX engine URL
  - Docker, if you want `zundone` to manage the engine for you

## Development

```bash
pnpm dev -- "done"
pnpm build
pnpm test
pnpm typecheck
```

The generated executable entrypoint is `dist/cli.js`.

## Stack

- `src/`: human-maintained TypeScript source
- `dist/`: generated build output from `tsup`
- `cac`: commands, options, and help output
- `vitest`: tests
- `.mise.toml`: pinned local tool versions

## Backends

`zundone` supports two backend modes.

- `docker`
  - default mode
  - if the engine is not reachable, `zundone` can create or start a local Docker container
- `http`
  - only talks to the configured URL
  - never tries to start Docker automatically

Environment variables:

- `ZUNDONE_BACKEND=docker|http`
- `VOICEVOX_URL`
- `ZUNDONE_DOCKER_CONTAINER`
- `ZUNDONE_DOCKER_IMAGE`
- `ZUNDONE_DOCKER_PORT`

If `VOICEVOX_URL` is not set, the default URL is `http://127.0.0.1:$ZUNDONE_DOCKER_PORT` and falls back to port `50021`.

## Usage

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

## Examples

Use a local Docker-managed engine:

```bash
zundone engine up
zundone "done"
```

Use an existing remote or local HTTP engine:

```bash
ZUNDONE_BACKEND=http zundone -u http://127.0.0.1:50021 "done"
ZUNDONE_BACKEND=http zundone -u http://remote-host:50021 "done"
```

PowerShell equivalents:

```powershell
$env:ZUNDONE_BACKEND = "http"
zundone -u http://127.0.0.1:50021 "done"
zundone -u http://remote-host:50021 "done"
```

Save audio without playing it:

```bash
zundone --no-play --output done.wav "done"
```

## Engine commands

```bash
zundone engine status
zundone engine up
zundone engine down
zundone engine logs
```

`engine up` creates the Docker container if it does not exist yet.

## Audio playback

Playback is best-effort and depends on what is available on the current OS.

- macOS: `afplay`, then `paplay`, `play`, `ffplay`
- Linux: `paplay`, `aplay`, `play`, `ffplay`
- Windows: PowerShell `Media.SoundPlayer`

Override the player manually with:

- `ZUNDONE_PLAYER`
- `ZUNDONE_PLAYER_ARGS`

If you do not want playback, use `--no-play`.

## Cache

By default, cache files are stored in the OS-standard cache directory returned by `env-paths("zundone")`.

- macOS: `~/Library/Caches/zundone`
- Linux: `~/.cache/zundone`
- Windows: `%LOCALAPPDATA%\zundone\Cache`

Override or disable with:

- `ZUNDONE_CACHE_DIR`
- `ZUNDONE_NO_CACHE=1`

## Notes

- `dist/` is generated; edit `src/` and rebuild instead of patching build output directly
- `engine up` expects the configured URL port and Docker published port to match
