#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir, readdir, stat, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const DEFAULT_URL = process.env.VOICEVOX_URL || `http://127.0.0.1:${process.env.ZUNDONE_DOCKER_PORT || 50021}`;
const DEFAULT_SPEAKER = process.env.ZUNDONE_SPEAKER || '3';
const CACHE_DIR = process.env.ZUNDONE_CACHE_DIR
  || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'zundone');

const DOCKER_CONTAINER = process.env.ZUNDONE_DOCKER_CONTAINER || 'voicevox';
const DOCKER_PORT = Number(process.env.ZUNDONE_DOCKER_PORT || 50021);
const DOCKER_IMAGE = process.env.ZUNDONE_DOCKER_IMAGE
  || (process.arch === 'arm64'
    ? 'voicevox/voicevox_engine:cpu-arm64-latest'
    : 'voicevox/voicevox_engine:cpu-latest');

// docker | http
const BACKEND = (() => {
  const v = (process.env.ZUNDONE_BACKEND || 'docker').toLowerCase();
  if (v === 'docker' || v === 'http') return v;
  throw new Error(`ZUNDONE_BACKEND は docker または http なのだ (受け取った値: ${v})`);
})();

const DONE_PHRASES = [
  '完了したのだ！',
  '終わったのだ〜！',
  'お疲れさまなのだ！',
  'できたのだ！',
  'ぼく頑張ったのだ！',
  '任務完了なのだ！',
  'ふう、やり切ったのだ！',
  'ばっちりなのだ！',
  'きりがついたのだ！',
  'ぼく、えらいのだ！',
  'ミッションコンプリートなのだ！',
  'ぼくを褒めてほしいのだ！',
  '全部やったのだ！',
  'いい感じに仕上がったのだ！',
  '完璧なのだ！',
  '無事完了なのだ！',
  '終わらせたのだ！',
  'ずんだもん、やりきったのだ！',
];

function pickDonePhrase() {
  return DONE_PHRASES[Math.floor(Math.random() * DONE_PHRASES.length)];
}

const KNOWN_SPEAKERS = {
  'ずんだもん': 3,
  'zundamon': 3,
  'zunda': 3,
  '四国めたん': 2,
  'metan': 2,
  '春日部つむぎ': 8,
  '雨晴はう': 10,
  '波音リツ': 9,
  '玄野武宏': 11,
  '白上虎太郎': 12,
  '青山龍星': 13,
  '冥鳴ひまり': 14,
  '九州そら': 16,
};

function printHelp() {
  process.stdout.write(`zundone — VOICEVOXで喋るCLI (Docker/HTTP backend, cross-platform)

使い方:
  zundone [オプション] [テキスト...]
  zundone --done                 # ランダムに完了フレーズを再生
  echo "テキスト" | zundone
  zundone help | list | engine | clear-cache | cache-path

主なオプション:
  -v, --voice <id|name>     話者 (既定: ずんだもん, env: ZUNDONE_SPEAKER)
  -r, --rate <float>        話速倍率 (1.0=標準, 例: 1.3で早口)
  -p, --pitch <float>       ピッチ (-0.15〜0.15目安)
      --volume <float>      音量 (1.0=標準)
      --intonation <float>  抑揚 (1.0=標準)
  -o, --output <path>       WAVファイルに保存
      --no-play             再生しない
  -u, --url <url>           VOICEVOX engine URL (既定: ${DEFAULT_URL})
  -l, --list                話者一覧を表示
  -q, --quiet               ログ抑制
  -h, --help                ヘルプ

完了通知:
      --done                ${DONE_PHRASES.length}個のフレーズからランダム選択して再生
      --prewarm-done        --done用の全フレーズを事前キャッシュ

キャッシュ:
      --no-cache            キャッシュを読み書きしない
      --clear-cache         キャッシュを全削除して終了
      --cache-info          キャッシュ場所とサイズを表示して終了
  保存先: ${CACHE_DIR}
  env: ZUNDONE_CACHE_DIR / ZUNDONE_NO_CACHE=1 で無効化

バックエンド:
  ZUNDONE_BACKEND=docker (既定)  接続失敗時にdocker containerを検知/起動
  ZUNDONE_BACKEND=http           HTTP接続のみ。autolaunchしない (リモートengine等)
      --no-autolaunch            backend=docker でも autolaunch 無効化
  env: ZUNDONE_DOCKER_CONTAINER (既定: ${DOCKER_CONTAINER})
       ZUNDONE_DOCKER_IMAGE     (既定: ${DOCKER_IMAGE})
       ZUNDONE_DOCKER_PORT      (既定: ${DOCKER_PORT})
       ZUNDONE_NO_AUTOLAUNCH=1

engineサブコマンド (docker container 管理):
  zundone engine status   # backend/HTTP/再生コマンドの状態確認
  zundone engine up       # docker container 起動 (無ければ作成)
  zundone engine down     # docker container 停止
  zundone engine logs     # docker logs --tail 100

再生コマンド (自動検出):
  macOS: afplay → paplay → play → ffplay
  Linux: paplay → aplay → play → ffplay
  Windows: PowerShell Media.SoundPlayer
  env: ZUNDONE_PLAYER=<bin> で明示指定 / ZUNDONE_PLAYER_ARGS=<空白区切り>

サブコマンド:
  help          このヘルプを表示
  list          話者一覧を表示 ( --list と同等 )
  engine ...    engine管理 (上記参照)
  clear-cache   キャッシュ全削除
  cache-info    キャッシュ情報表示
  cache-path    キャッシュディレクトリのパスのみ出力

例:
  zundone "完了したのだ"                       # 既定(ずんだもん) で再生 + キャッシュ
  zundone -r 1.3 "早口ずんだもん"
  zundone -v 四国めたん "めたん登場"
  zundone -o done.wav --no-play "保存のみ"
  zundone --no-cache "毎回合成したい"
  echo "標準入力も読めるのだ" | zundone
  ZUNDONE_BACKEND=http zundone -u http://remote:50021 "リモートengineを使う"
  zundone engine up && zundone "セットアップ完了なのだ"

VOICEVOX engine の手動起動 (Docker):
  docker run -d --restart unless-stopped --name ${DOCKER_CONTAINER} \\
    -p ${DOCKER_PORT}:50021 ${DOCKER_IMAGE}
`);
}

let autolaunchTried = false;
let autolaunchAllowed = true;
let autolaunchQuiet = false;

async function fetchRaw(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const down = e?.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/.test(String(e));
    const msg = down
      ? `VOICEVOX engine に接続できないのだ (${url})`
      : `リクエスト失敗: ${e.message}`;
    const err = new Error(msg);
    if (down) err.engineDown = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init?.method || 'GET'} ${url} → ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res;
}

function spawnCapture(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let p;
    try {
      p = spawn(cmd, args, opts);
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: e.message, missing: true });
      return;
    }
    let stdout = '', stderr = '';
    p.stdout?.on('data', d => stdout += d);
    p.stderr?.on('data', d => stderr += d);
    p.on('error', e => {
      const missing = e.code === 'ENOENT';
      resolve({ ok: false, code: -1, stdout, stderr: stderr || e.message, missing });
    });
    p.on('exit', code => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

async function waitForEngine(anyUrl, timeoutMs = 30000) {
  const origin = new URL(anyUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch(`${origin}/version`);
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

async function dockerContainerStatus() {
  const r = await spawnCapture('docker', [
    'ps', '-a',
    '--filter', `name=^${DOCKER_CONTAINER}$`,
    '--format', '{{.State}}',
  ]);
  if (r.missing) return { available: false };
  if (!r.ok) return { available: true, error: r.stderr.trim() };
  const state = r.stdout.trim().split('\n')[0] || '';
  if (!state) return { available: true, exists: false };
  return { available: true, exists: true, running: state === 'running', state };
}

function hostPortFromUrl(anyUrl) {
  const url = new URL(anyUrl);
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

async function dockerPublishedPort() {
  const r = await spawnCapture('docker', [
    'inspect',
    '--format',
    '{{with index .NetworkSettings.Ports "50021/tcp"}}{{(index . 0).HostPort}}{{end}}',
    DOCKER_CONTAINER,
  ]);
  if (!r.ok) return null;
  const port = r.stdout.trim();
  return port ? Number(port) : null;
}

async function dockerEnsureRunning(anyUrl, { autoCreate, quiet }) {
  const desiredPort = hostPortFromUrl(anyUrl);
  const status = await dockerContainerStatus();
  if (!status.available) {
    return { ok: false, reason: 'docker コマンドが見つからないのだ' };
  }
  if (status.error) {
    return { ok: false, reason: `docker 状態取得失敗: ${status.error}` };
  }
  if (status.exists) {
    const publishedPort = await dockerPublishedPort();
    if (publishedPort && publishedPort !== desiredPort) {
      return {
        ok: false,
        reason: `container "${DOCKER_CONTAINER}" is published on host port ${publishedPort}, but the current URL expects ${desiredPort}. Align VOICEVOX_URL / ZUNDONE_DOCKER_PORT or recreate the container.`,
      };
    }
  }
  if (!status.exists) {
    if (!autoCreate) return { ok: false, reason: `container "${DOCKER_CONTAINER}" が無いのだ (zd engine up で作成)` };
    if (!quiet) process.stderr.write(`docker container "${DOCKER_CONTAINER}" を作成するのだ (image: ${DOCKER_IMAGE})…\n`);
    const r = await spawnCapture('docker', [
      'run', '-d', '--restart', 'unless-stopped',
      '--name', DOCKER_CONTAINER,
      '-p', `${desiredPort}:50021`,
      DOCKER_IMAGE,
    ]);
    if (!r.ok) return { ok: false, reason: `docker run 失敗: ${r.stderr.trim()}` };
  } else if (!status.running) {
    if (!quiet) process.stderr.write(`docker container "${DOCKER_CONTAINER}" を起動するのだ…\n`);
    const r = await spawnCapture('docker', ['start', DOCKER_CONTAINER]);
    if (!r.ok) return { ok: false, reason: `docker start 失敗: ${r.stderr.trim()}` };
  }
  const ready = await waitForEngine(anyUrl, 60000);
  if (!ready) return { ok: false, reason: 'engine 接続確認タイムアウトなのだ' };
  return { ok: true };
}

async function tryAutolaunch(anyUrl) {
  if (BACKEND !== 'docker') {
    const err = new Error(
      `VOICEVOX engine に接続できないのだ (backend=${BACKEND}, url=${anyUrl})`
    );
    err.engineDown = true;
    throw err;
  }
  const r = await dockerEnsureRunning(anyUrl, { autoCreate: true, quiet: autolaunchQuiet });
  if (!r.ok) {
    const err = new Error(r.reason);
    err.engineDown = true;
    throw err;
  }
  if (!autolaunchQuiet) process.stderr.write('engine 起動したのだ (docker)\n');
}

async function fetchOrThrow(url, init) {
  try {
    return await fetchRaw(url, init);
  } catch (e) {
    if (!e.engineDown) throw e;
    if (!autolaunchAllowed || autolaunchTried) throw e;
    if (process.env.ZUNDONE_NO_AUTOLAUNCH === '1') throw e;
    if (BACKEND !== 'docker') throw e;
    autolaunchTried = true;
    await tryAutolaunch(url);
    return await fetchRaw(url, init);
  }
}

async function getSpeakers(baseUrl) {
  const res = await fetchOrThrow(`${baseUrl}/speakers`);
  return res.json();
}

async function listSpeakers(baseUrl) {
  const speakers = await getSpeakers(baseUrl);
  for (const s of speakers) {
    process.stdout.write(`${s.name}\n`);
    for (const st of s.styles) {
      process.stdout.write(`  ${String(st.id).padStart(3, ' ')}  ${st.name}\n`);
    }
  }
}

async function resolveSpeakerId(input, baseUrl) {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (KNOWN_SPEAKERS[trimmed] != null) return KNOWN_SPEAKERS[trimmed];

  const speakers = await getSpeakers(baseUrl);
  const [nameQ, styleQ] = trimmed.includes(':') ? trimmed.split(':') : [trimmed, null];

  for (const s of speakers) {
    if (s.name === nameQ || s.name.includes(nameQ)) {
      if (styleQ) {
        const st = s.styles.find(x => x.name === styleQ);
        if (st) return st.id;
        continue;
      }
      const normal = s.styles.find(x => x.name === 'ノーマル');
      return (normal || s.styles[0]).id;
    }
  }
  for (const s of speakers) {
    for (const st of s.styles) {
      if (st.name === trimmed || `${s.name}(${st.name})` === trimmed) return st.id;
    }
  }
  throw new Error(`話者 "${input}" が見つからないのだ。 \`zundone list\` で一覧を確認してほしいのだ`);
}

async function synthesize({ text, speakerId, baseUrl, rate, pitch, volume, intonation }) {
  const qUrl = `${baseUrl}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`;
  const qRes = await fetchOrThrow(qUrl, { method: 'POST' });
  const query = await qRes.json();

  if (rate != null) query.speedScale = rate;
  if (pitch != null) query.pitchScale = pitch;
  if (volume != null) query.volumeScale = volume;
  if (intonation != null) query.intonationScale = intonation;

  const sRes = await fetchOrThrow(`${baseUrl}/synthesis?speaker=${speakerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav' },
    body: JSON.stringify(query),
  });
  return Buffer.from(await sRes.arrayBuffer());
}

async function which(cmd) {
  const path = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of path.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      try {
        await access(full, FS.X_OK);
        return full;
      } catch {}
    }
  }
  return null;
}

const PLAYER_ARGS_BY_BIN = {
  ffplay: ['-autoexit', '-nodisp', '-loglevel', 'quiet'],
  play: ['-q'],
};

let resolvedPlayer = null;

async function resolvePlayer() {
  if (resolvedPlayer) return resolvedPlayer;

  if (process.env.ZUNDONE_PLAYER) {
    const bin = process.env.ZUNDONE_PLAYER;
    const args = (process.env.ZUNDONE_PLAYER_ARGS || '').split(' ').filter(Boolean);
    resolvedPlayer = { type: 'cmd', bin, args };
    return resolvedPlayer;
  }

  if (process.platform === 'win32') {
    resolvedPlayer = { type: 'powershell' };
    return resolvedPlayer;
  }

  const candidates = process.platform === 'darwin'
    ? ['afplay', 'paplay', 'play', 'ffplay']
    : ['paplay', 'aplay', 'play', 'ffplay'];

  for (const c of candidates) {
    if (await which(c)) {
      resolvedPlayer = { type: 'cmd', bin: c, args: PLAYER_ARGS_BY_BIN[c] || [] };
      return resolvedPlayer;
    }
  }
  throw new Error(
    '再生コマンドが見つからないのだ。afplay/paplay/aplay/play/ffplay のどれかを入れるか、ZUNDONE_PLAYER で指定してほしいのだ'
  );
}

async function playWav(path) {
  const player = await resolvePlayer();
  return new Promise((resolve, reject) => {
    let p;
    if (player.type === 'powershell') {
      const escaped = path.replace(/'/g, "''");
      const ps1 = `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`;
      p = spawn('powershell.exe', ['-NoProfile', '-Command', ps1], { stdio: 'ignore' });
    } else {
      p = spawn(player.bin, [...player.args, path], { stdio: 'ignore' });
    }
    p.on('error', reject);
    p.on('exit', (code, sig) =>
      code === 0 ? resolve() : reject(new Error(`${player.bin || 'player'} 終了コード ${code ?? sig}`)),
    );
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function parseFloatOpt(v, name) {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} は数値で指定してほしいのだ (受け取った値: ${v})`);
  return n;
}

function cacheKey({ text, speakerId, rate, pitch, volume, intonation }) {
  const payload = JSON.stringify({
    v: 1,
    text,
    speakerId,
    rate: rate ?? null,
    pitch: pitch ?? null,
    volume: volume ?? null,
    intonation: intonation ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

async function cacheLookup(key) {
  const path = join(CACHE_DIR, `${key}.wav`);
  try {
    await access(path, FS.R_OK);
    return path;
  } catch { return null; }
}

async function cacheStore(key, buf) {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${key}.wav`);
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, buf);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
  return path;
}

async function clearCache() {
  let removed = 0;
  let bytes = 0;
  try {
    const entries = await readdir(CACHE_DIR);
    for (const name of entries) {
      if (!name.endsWith('.wav') && !name.endsWith('.tmp')) continue;
      const p = join(CACHE_DIR, name);
      try {
        const s = await stat(p);
        bytes += s.size;
        await rm(p);
        removed++;
      } catch {}
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return { removed, bytes };
}

async function cacheInfo() {
  let count = 0, bytes = 0;
  try {
    for (const name of await readdir(CACHE_DIR)) {
      if (!name.endsWith('.wav')) continue;
      try { bytes += (await stat(join(CACHE_DIR, name))).size; count++; } catch {}
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return { dir: CACHE_DIR, count, bytes };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function engineCommand(action) {
  const baseUrl = DEFAULT_URL.replace(/\/+$/, '');

  if (!action || action === 'status') {
    process.stdout.write(`backend: ${BACKEND}\n`);

    if (BACKEND === 'docker') {
      const s = await dockerContainerStatus();
      if (!s.available) {
        process.stdout.write('docker: コマンドが見つからないのだ\n');
      } else if (s.error) {
        process.stdout.write(`docker: エラー (${s.error})\n`);
      } else if (!s.exists) {
        process.stdout.write(`docker container "${DOCKER_CONTAINER}": 未作成 (zd engine up で作成)\n`);
      } else {
        process.stdout.write(`docker container "${DOCKER_CONTAINER}": ${s.running ? '稼働中' : `停止中 (state=${s.state})`}\n`);
      }
    }

    try {
      const r = await fetch(`${baseUrl}/version`);
      const txt = (await r.text()).trim().replace(/^"|"$/g, '');
      process.stdout.write(`engine HTTP (${baseUrl}): OK / version=${txt || '?'}\n`);
    } catch (e) {
      process.stdout.write(`engine HTTP (${baseUrl}): 接続不可 (${e?.cause?.code || e.message})\n`);
    }

    const player = await resolvePlayer().catch(e => ({ error: e.message }));
    if (player.error) {
      process.stdout.write(`再生コマンド: 検出失敗 (${player.error})\n`);
    } else if (player.type === 'powershell') {
      process.stdout.write(`再生コマンド: PowerShell SoundPlayer\n`);
    } else {
      process.stdout.write(`再生コマンド: ${player.bin}${player.args.length ? ' ' + player.args.join(' ') : ''}\n`);
    }
    return;
  }

  if (BACKEND !== 'docker') {
    throw new Error(`engine ${action} は backend=docker のときだけ使えるのだ (現在: ${BACKEND})`);
  }

  if (action === 'up') {
    const r = await dockerEnsureRunning(baseUrl, { autoCreate: true, quiet: false });
    if (!r.ok) throw new Error(r.reason);
    process.stdout.write('engine 接続確認OKなのだ\n');
    return;
  }

  if (action === 'down') {
    const s = await dockerContainerStatus();
    if (!s.available) throw new Error('docker コマンドが見つからないのだ');
    if (!s.exists) { process.stdout.write('container は無いのだ\n'); return; }
    if (!s.running) { process.stdout.write('既に停止しているのだ\n'); return; }
    const r = await spawnCapture('docker', ['stop', DOCKER_CONTAINER]);
    if (!r.ok) throw new Error(`docker stop 失敗: ${r.stderr.trim()}`);
    process.stdout.write('container 停止したのだ\n');
    return;
  }

  if (action === 'logs') {
    const r = await spawnCapture('docker', ['logs', '--tail', '100', DOCKER_CONTAINER]);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (!r.ok) process.exit(1);
    return;
  }

  throw new Error(`engine: 不明なアクション "${action}". status/up/down/logs から選んでほしいのだ`);
}

const SUBCOMMANDS = new Set(['help', 'list', 'engine', 'clear-cache', 'cache-info', 'cache-path']);

async function main() {
  const firstArg = process.argv[2];
  if (firstArg && SUBCOMMANDS.has(firstArg)) {
    switch (firstArg) {
      case 'help':
        printHelp();
        return;
      case 'list': {
        const url = (process.env.VOICEVOX_URL || DEFAULT_URL).replace(/\/+$/, '');
        await listSpeakers(url);
        return;
      }
      case 'engine':
        await engineCommand(process.argv[3]);
        return;
      case 'clear-cache': {
        const { removed, bytes } = await clearCache();
        process.stdout.write(`削除したのだ: ${removed}ファイル / ${formatBytes(bytes)}\n`);
        return;
      }
      case 'cache-info': {
        const { dir, count, bytes } = await cacheInfo();
        process.stdout.write(`${dir}\n  ${count}ファイル / ${formatBytes(bytes)}\n`);
        return;
      }
      case 'cache-path':
        process.stdout.write(`${CACHE_DIR}\n`);
        return;
    }
  }

  let parsed;
  try {
    parsed = parseArgs({
      options: {
        voice: { type: 'string', short: 'v' },
        rate: { type: 'string', short: 'r' },
        pitch: { type: 'string', short: 'p' },
        volume: { type: 'string' },
        intonation: { type: 'string' },
        output: { type: 'string', short: 'o' },
        'no-play': { type: 'boolean' },
        url: { type: 'string', short: 'u' },
        list: { type: 'boolean', short: 'l' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        'no-cache': { type: 'boolean' },
        'clear-cache': { type: 'boolean' },
        'cache-info': { type: 'boolean' },
        'no-autolaunch': { type: 'boolean' },
        done: { type: 'boolean' },
        'prewarm-done': { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    process.stderr.write(`引数エラー: ${e.message}\n\n`);
    printHelp();
    process.exit(2);
  }
  const { values, positionals } = parsed;

  if (values.help) { printHelp(); return; }

  if (values['no-autolaunch']) autolaunchAllowed = false;
  if (values.quiet) autolaunchQuiet = true;

  const baseUrl = (values.url || DEFAULT_URL).replace(/\/+$/, '');

  if (values.list) { await listSpeakers(baseUrl); return; }
  if (values['clear-cache']) {
    const { removed, bytes } = await clearCache();
    process.stdout.write(`削除したのだ: ${removed}ファイル / ${formatBytes(bytes)}\n`);
    return;
  }
  if (values['cache-info']) {
    const { dir, count, bytes } = await cacheInfo();
    process.stdout.write(`${dir}\n  ${count}ファイル / ${formatBytes(bytes)}\n`);
    return;
  }

  if (values['prewarm-done']) {
    const rate = parseFloatOpt(values.rate, '--rate');
    const pitch = parseFloatOpt(values.pitch, '--pitch');
    const volume = parseFloatOpt(values.volume, '--volume');
    const intonation = parseFloatOpt(values.intonation, '--intonation');
    const speakerId = await resolveSpeakerId(values.voice || DEFAULT_SPEAKER, baseUrl);
    let synth = 0, hit = 0;
    for (const phrase of DONE_PHRASES) {
      const key = cacheKey({ text: phrase, speakerId, rate, pitch, volume, intonation });
      if (await cacheLookup(key)) { hit++; continue; }
      const wav = await synthesize({ text: phrase, speakerId, baseUrl, rate, pitch, volume, intonation });
      await cacheStore(key, wav);
      synth++;
      if (!values.quiet) process.stderr.write(`  ${phrase}\n`);
    }
    process.stdout.write(`prewarm完了: 合成${synth} / キャッシュ既存${hit} / 合計${DONE_PHRASES.length}\n`);
    return;
  }

  let text;
  if (values.done) {
    text = pickDonePhrase();
    if (!values.quiet) process.stderr.write(`${text}\n`);
  } else {
    text = positionals.length > 0 ? positionals.join(' ') : await readStdin();
  }
  if (!text) {
    process.stderr.write('テキストが無いのだ。引数か標準入力で渡してほしいのだ。\n\n');
    printHelp();
    process.exit(1);
  }

  const rate = parseFloatOpt(values.rate, '--rate');
  const pitch = parseFloatOpt(values.pitch, '--pitch');
  const volume = parseFloatOpt(values.volume, '--volume');
  const intonation = parseFloatOpt(values.intonation, '--intonation');

  const speakerId = await resolveSpeakerId(values.voice || DEFAULT_SPEAKER, baseUrl);

  const cacheDisabled = values['no-cache'] || process.env.ZUNDONE_NO_CACHE === '1';
  const key = cacheKey({ text, speakerId, rate, pitch, volume, intonation });
  const cachedPath = cacheDisabled ? null : await cacheLookup(key);

  let playPath;
  let tempPathToCleanup = null;

  if (cachedPath) {
    if (!values.quiet) process.stderr.write(`cache hit: ${key.slice(0, 10)}\n`);
    playPath = cachedPath;

    if (values.output) {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(cachedPath, values.output);
      if (!values.quiet) process.stderr.write(`保存したのだ: ${values.output}\n`);
    }
  } else {
    const wav = await synthesize({ text, speakerId, baseUrl, rate, pitch, volume, intonation });

    if (!cacheDisabled) {
      try {
        playPath = await cacheStore(key, wav);
      } catch (e) {
        if (!values.quiet) process.stderr.write(`キャッシュ書き込み失敗(続行): ${e.message}\n`);
      }
    }

    if (values.output) {
      await writeFile(values.output, wav);
      if (!values.quiet) process.stderr.write(`保存したのだ: ${values.output}\n`);
      if (!playPath) playPath = values.output;
    }

    if (!playPath) {
      playPath = join(tmpdir(), `zundone-${randomBytes(6).toString('hex')}.wav`);
      await writeFile(playPath, wav);
      tempPathToCleanup = playPath;
    }
  }

  try {
    if (!values['no-play']) await playWav(playPath);
  } finally {
    if (tempPathToCleanup) { try { await rm(tempPathToCleanup); } catch {} }
  }
}

main().catch(err => {
  if (err?.engineDown) {
    process.stderr.write(`エラー: ${err.message}\n`);
    if (BACKEND === 'docker') {
      process.stderr.write(`engine 起動方法:\n`);
      process.stderr.write(`  zd engine up                 # docker container 自動作成/起動\n`);
      process.stderr.write(`  zd engine status             # 状態確認\n`);
    } else {
      process.stderr.write(`backend=http なので autolaunch しないのだ。\n`);
      process.stderr.write(`engine の URL を確認するか、ZUNDONE_BACKEND=docker で docker 自動起動を有効化してほしいのだ\n`);
    }
  } else {
    process.stderr.write(`エラー: ${err?.message || err}\n`);
  }
  process.exit(1);
});
