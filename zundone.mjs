#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir, readdir, stat, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const DEFAULT_URL = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const DEFAULT_SPEAKER = process.env.ZUNDONE_SPEAKER || '3'; // ずんだもん(ノーマル)
const CACHE_DIR = process.env.ZUNDONE_CACHE_DIR
  || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'zundone');

// --done で使う、ずんだもん口調のランダム完了フレーズ
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

// よく使う話者のショートカット（/speakers を叩かずに解決するため）
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
  process.stdout.write(`zundone — VOICEVOXずんだもんで喋るCLIなのだ

使い方:
  zundone [オプション] [テキスト...]
  zundone --done                 # ランダムに完了フレーズを再生
  echo "テキスト" | zundone
  zundone help | list | clear-cache | cache-path

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

自動起動:
      --no-autolaunch       engine未起動時にVOICEVOX.appを自動起動しない
  既定: engine接続失敗時に \`open -a VOICEVOX\` で起動・最大30秒待機
  env: ZUNDONE_NO_AUTOLAUNCH=1 で無効化

サブコマンド (最初の引数で指定):
  help          このヘルプを表示
  list          話者一覧を表示 ( --list と同等 )
  clear-cache   キャッシュ全削除
  cache-info    キャッシュ情報表示
  cache-path    キャッシュディレクトリのパスのみ出力

環境変数:
  VOICEVOX_URL        engine URL
  ZUNDONE_SPEAKER     既定話者
  ZUNDONE_CACHE_DIR   キャッシュ先
  ZUNDONE_NO_CACHE=1  キャッシュ常時無効

例:
  zundone "完了したのだ"                      # 既定(ずんだもん) で再生 + キャッシュ
  zundone -r 1.3 "早口ずんだもん"
  zundone -v 四国めたん "めたん登場"
  zundone -o done.wav --no-play "保存のみ"
  zundone --no-cache "毎回合成したい"
  echo "標準入力も読めるのだ" | zundone
  zundone clear-cache

VOICEVOX engine の起動 (未起動時):
  docker run -d --restart unless-stopped --name voicevox \\
    -p 50021:50021 voicevox/voicevox_engine:cpu-latest
`);
}

let autolaunchTried = false;
let autolaunchAllowed = true; // main() で --no-autolaunch によって false になる
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

async function tryAutolaunch(anyUrl) {
  if (!autolaunchQuiet) process.stderr.write('VOICEVOX 起動中なのだ…\n');
  // -g: 前面に出さない / -j: 隠して起動 (Electronだと無視されるので後でSystem Events経由でも隠す)
  spawn('open', ['-gj', '-a', 'VOICEVOX'], { stdio: 'ignore', detached: true }).unref();
  const origin = new URL(anyUrl).origin;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch(`${origin}/version`);
      if (r.ok) {
        if (!autolaunchQuiet) process.stderr.write('起動したのだ\n');
        hideVoicevoxWindow();
        return;
      }
    } catch {}
  }
  const err = new Error(`VOICEVOX 起動を試みたがタイムアウトしたのだ (${origin})`);
  err.engineDown = true;
  throw err;
}

function hideVoicevoxWindow() {
  // ウィンドウが復元されてしまう場合があるので、短いディレイ後にもう一度隠す
  const script = `
    repeat 5 times
      try
        tell application "System Events"
          if exists (process "VOICEVOX") then set visible of process "VOICEVOX" to false
        end tell
      end try
      delay 0.5
    end repeat
  `;
  spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
}

async function fetchOrThrow(url, init) {
  try {
    return await fetchRaw(url, init);
  } catch (e) {
    if (!e.engineDown) throw e;
    if (!autolaunchAllowed || autolaunchTried) throw e;
    if (process.platform !== 'darwin') throw e;
    if (process.env.ZUNDONE_NO_AUTOLAUNCH === '1') throw e;
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

function playWav(path) {
  return new Promise((resolve, reject) => {
    const p = spawn('afplay', [path], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code, sig) =>
      code === 0 ? resolve() : reject(new Error(`afplay 終了コード ${code ?? sig}`)),
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

// ---- キャッシュ ----

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

// ---- サブコマンド処理 ----

const SUBCOMMANDS = new Set(['help', 'list', 'clear-cache', 'cache-info', 'cache-path']);

async function main() {
  // 最初のpositionalがサブコマンドなら専用処理
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
      // キャッシュ無効かつ --output も無い場合は一時ファイルに書く
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
    process.stderr.write(`VOICEVOX engine を起動してほしいのだ:\n`);
    process.stderr.write(`  docker start voicevox    # 既に作成済みのコンテナを起動\n`);
    process.stderr.write(`  docker run -d --restart unless-stopped --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest\n`);
  } else {
    process.stderr.write(`エラー: ${err?.message || err}\n`);
  }
  process.exit(1);
});
