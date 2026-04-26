import cac, { type CAC, type Command } from "cac";
import { randomBytes } from "node:crypto";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WavCache, formatBytes } from "./cache.js";
import { normalizeBaseUrl, readConfig, type AppConfig } from "./config.js";
import { DONE_PHRASES } from "./constants.js";
import {
  dockerContainerStatus,
  dockerEnsureRunning,
  dockerLogs,
  dockerStop,
} from "./docker.js";
import { getErrorMessage } from "./errors.js";
import { describePlayer, playWav } from "./player.js";
import { probeVersion, VoicevoxClient } from "./voicevox.js";
import { normalizeCliArgs } from "./argv.js";

type HelpSection = {
  title?: string;
  body: string;
};

type ClientOptions = {
  url?: string;
  quiet?: boolean;
  autolaunch?: boolean;
};

type SpeechOptions = ClientOptions & {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  intonation?: string;
  output?: string;
  play?: boolean;
  list?: boolean;
  cache?: boolean;
  clearCache?: boolean;
  cacheInfo?: boolean;
  done?: boolean;
  prewarmDone?: boolean;
};

type EngineOptions = {
  url?: string;
};

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function pickDonePhrase(): string {
  return DONE_PHRASES[Math.floor(Math.random() * DONE_PHRASES.length)] ?? "終わったのだ。";
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseFloatOption(rawValue: string | undefined, label: string): number | undefined {
  if (rawValue === undefined) return undefined;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a number (got: ${rawValue})`);
  }
  return value;
}

function resolveBaseUrl(config: AppConfig, url?: string): string {
  return normalizeBaseUrl(url ?? config.defaultUrl);
}

function createVoicevoxClient(config: AppConfig, options: ClientOptions): VoicevoxClient {
  return new VoicevoxClient(config, {
    baseUrl: resolveBaseUrl(config, options.url),
    autostartAllowed: options.autolaunch !== false,
    autostartQuiet: Boolean(options.quiet),
  });
}

async function listSpeakers(client: VoicevoxClient): Promise<void> {
  const speakers = await client.getSpeakers();
  for (const speaker of speakers) {
    writeStdout(speaker.name);
    for (const style of speaker.styles) {
      writeStdout(`  ${String(style.id).padStart(3, " ")}  ${style.name}`);
    }
  }
}

function addSpeechOptions<TCommand extends Command>(command: TCommand, config: AppConfig): TCommand {
  return command
    .option("-v, --voice <id|name>", "Speaker ID or name")
    .option("-r, --rate <float>", "Speed scale")
    .option("-p, --pitch <float>", "Pitch scale")
    .option("--volume <float>", "Volume scale")
    .option("--intonation <float>", "Intonation scale")
    .option("-o, --output <path>", "Write a WAV file")
    .option("--no-play", "Do not play audio")
    .option(`-u, --url <url>`, `VOICEVOX engine URL (default: ${config.defaultUrl})`)
    .option("-l, --list", "List speakers")
    .option("-q, --quiet", "Suppress extra logs")
    .option("--no-cache", "Disable cache reads and writes")
    .option("--clear-cache", "Remove cached files and exit")
    .option("--cache-info", "Print cache information and exit")
    .option("--no-autolaunch", "Disable docker autostart")
    .option("--done", "Speak a random completion phrase")
    .option("--prewarm-done", "Synthesize and cache all completion phrases");
}

export function createHelpSections(config: AppConfig): HelpSection[] {
  return [
    {
      title: "Environment",
      body: [
        "ZUNDONE_BACKEND=docker|http",
        `VOICEVOX_URL (default: ${config.defaultUrl})`,
        `ZUNDONE_DOCKER_CONTAINER (default: ${config.dockerContainer})`,
        `ZUNDONE_DOCKER_IMAGE (default: ${config.dockerImage})`,
        `ZUNDONE_DOCKER_PORT (default: ${config.dockerPort})`,
        `cache dir: ${config.cacheDir}`,
      ].join("\n"),
    },
    {
      title: "Development",
      body: [
        "pnpm dev -- --done",
        "pnpm build",
        "pnpm typecheck",
        "generated entrypoint: dist/cli.js",
      ].join("\n"),
    },
    {
      title: "Examples",
      body: [
        'zundone "done"',
        'zundone --no-play --output done.wav "done"',
        "zundone engine up",
        "$env:ZUNDONE_BACKEND='http'; zundone -u http://127.0.0.1:50021 \"done\"",
        'ZUNDONE_BACKEND=http zundone -u http://127.0.0.1:50021 "done"',
      ].join("\n"),
    },
  ];
}

async function handleEngineCommand(
  config: AppConfig,
  action: string | undefined,
  baseUrl: string,
): Promise<void> {
  if (!action || action === "status") {
    writeStdout(`backend: ${config.backend}`);

    if (config.backend === "docker") {
      const status = await dockerContainerStatus(config);
      if (!status.available) {
        writeStdout("docker: unavailable");
      } else if (status.error) {
        writeStdout(`docker: error (${status.error})`);
      } else if (!status.exists) {
        writeStdout(`docker container "${config.dockerContainer}": not created`);
      } else {
        writeStdout(
          `docker container "${config.dockerContainer}": ` +
            (status.running ? "running" : `stopped (state=${status.state ?? "unknown"})`),
        );
      }
    }

    const version = await probeVersion(baseUrl);
    if (version.ok) {
      writeStdout(`engine HTTP (${baseUrl}): OK / version=${version.version}`);
    } else {
      writeStdout(`engine HTTP (${baseUrl}): unreachable (${version.error})`);
    }

    writeStdout(`player: ${await describePlayer(config)}`);
    return;
  }

  if (config.backend !== "docker") {
    throw new Error(`engine ${action} is only available when ZUNDONE_BACKEND=docker`);
  }

  if (action === "up") {
    const result = await dockerEnsureRunning(config, baseUrl, { autoCreate: true, quiet: false });
    if (!result.ok) throw new Error(result.reason);
    writeStdout("engine is ready");
    return;
  }

  if (action === "down") {
    const status = await dockerContainerStatus(config);
    if (!status.available) throw new Error("docker command is not available");
    if (!status.exists) {
      writeStdout("container does not exist");
      return;
    }
    if (!status.running) {
      writeStdout("container is already stopped");
      return;
    }

    const result = await dockerStop(config);
    if (!result.ok) throw new Error(result.stderr.trim() || "docker stop failed");
    writeStdout("container stopped");
    return;
  }

  if (action === "logs") {
    const result = await dockerLogs(config);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (!result.ok) process.exit(1);
    return;
  }

  throw new Error(`unknown engine action "${action}" (expected status/up/down/logs)`);
}

async function handleSpeechCommand(
  config: AppConfig,
  cache: WavCache,
  textParts: string[],
  options: SpeechOptions,
): Promise<void> {
  const client = createVoicevoxClient(config, options);

  if (options.list) {
    await listSpeakers(client);
    return;
  }

  if (options.clearCache) {
    const info = await cache.clear();
    writeStdout(`removed: ${info.removed} files / ${formatBytes(info.bytes)}`);
    return;
  }

  if (options.cacheInfo) {
    const info = await cache.info();
    writeStdout(info.dir);
    writeStdout(`  ${info.count} files / ${formatBytes(info.bytes)}`);
    return;
  }

  if (options.prewarmDone) {
    const rate = parseFloatOption(options.rate, "--rate");
    const pitch = parseFloatOption(options.pitch, "--pitch");
    const volume = parseFloatOption(options.volume, "--volume");
    const intonation = parseFloatOption(options.intonation, "--intonation");
    const speakerId = await client.resolveSpeakerId(options.voice ?? config.defaultSpeaker);

    let synthesized = 0;
    let cacheHits = 0;

    for (const phrase of DONE_PHRASES) {
      const key = cache.buildKey({ text: phrase, speakerId, rate, pitch, volume, intonation });
      if (await cache.lookup(key)) {
        cacheHits += 1;
        continue;
      }

      const wav = await client.synthesize({ text: phrase, speakerId, rate, pitch, volume, intonation });
      await cache.store(key, wav);
      synthesized += 1;

      if (!options.quiet) writeStderr(`  ${phrase}`);
    }

    writeStdout(
      `prewarmed: generated=${synthesized} cache-hit=${cacheHits} total=${DONE_PHRASES.length}`,
    );
    return;
  }

  const text =
    options.done ? pickDonePhrase() : textParts.length > 0 ? textParts.join(" ") : await readStdin();
  if (!text) {
    throw new Error("no text was provided");
  }

  if (options.done && !options.quiet) {
    writeStderr(text);
  }

  const rate = parseFloatOption(options.rate, "--rate");
  const pitch = parseFloatOption(options.pitch, "--pitch");
  const volume = parseFloatOption(options.volume, "--volume");
  const intonation = parseFloatOption(options.intonation, "--intonation");
  const speakerId = await client.resolveSpeakerId(options.voice ?? config.defaultSpeaker);

  const cacheDisabled = options.cache === false || config.noCache;
  const cacheKey = cache.buildKey({ text, speakerId, rate, pitch, volume, intonation });
  const cachedPath = cacheDisabled ? null : await cache.lookup(cacheKey);

  let playPath: string | undefined;
  let tempPathToCleanup: string | undefined;

  if (cachedPath) {
    if (!options.quiet) writeStderr(`cache hit: ${cacheKey.slice(0, 10)}`);
    playPath = cachedPath;

    if (options.output) {
      await copyFile(cachedPath, options.output);
      if (!options.quiet) writeStderr(`saved: ${options.output}`);
    }
  } else {
    const wav = await client.synthesize({ text, speakerId, rate, pitch, volume, intonation });

    if (!cacheDisabled) {
      try {
        playPath = await cache.store(cacheKey, wav);
      } catch (error) {
        if (!options.quiet) {
          writeStderr(`cache write failed: ${getErrorMessage(error)}`);
        }
      }
    }

    if (options.output) {
      await writeFile(options.output, wav);
      if (!options.quiet) writeStderr(`saved: ${options.output}`);
      if (!playPath) playPath = options.output;
    }

    if (!playPath) {
      playPath = join(tmpdir(), `zundone-${randomBytes(6).toString("hex")}.wav`);
      await writeFile(playPath, wav);
      tempPathToCleanup = playPath;
    }
  }

  try {
    if (options.play !== false && playPath) {
      await playWav(config, playPath);
    }
  } finally {
    if (tempPathToCleanup) {
      try {
        await rm(tempPathToCleanup);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

export function buildCli(config: AppConfig = readConfig()): CAC {
  const cache = new WavCache(config.cacheDir);
  const cli = cac("zundone");

  cli.usage("[options] [text...]");
  cli.help((sections) => [...sections, ...createHelpSections(config)]);
  cli.example('"done"');
  cli.example("--done");
  cli.example("engine up");

  cli.command("help", "Show help").action(() => {
    cli.outputHelp();
  });

  cli
    .command("list", "List speakers")
    .option(`-u, --url <url>`, `VOICEVOX engine URL (default: ${config.defaultUrl})`)
    .option("-q, --quiet", "Suppress extra logs")
    .option("--no-autolaunch", "Disable docker autostart")
    .action(async (options: ClientOptions) => {
      await listSpeakers(createVoicevoxClient(config, options));
    });

  cli.command("cache-info", "Print cache information").action(async () => {
    const info = await cache.info();
    writeStdout(info.dir);
    writeStdout(`  ${info.count} files / ${formatBytes(info.bytes)}`);
  });

  cli.command("clear-cache", "Remove cached files").action(async () => {
    const info = await cache.clear();
    writeStdout(`removed: ${info.removed} files / ${formatBytes(info.bytes)}`);
  });

  cli.command("cache-path", "Print the cache directory").action(() => {
    writeStdout(cache.dir);
  });

  cli
    .command("engine [action]", "Inspect or manage the docker engine")
    .option(`-u, --url <url>`, `VOICEVOX engine URL (default: ${config.defaultUrl})`)
    .action(async (action: string | undefined, options: EngineOptions) => {
      await handleEngineCommand(config, action, resolveBaseUrl(config, options.url));
    });

  addSpeechOptions(
    cli
      .command("[...text]", "Speak text through the configured VOICEVOX engine")
      .usage("[options] [text...]")
      .ignoreOptionDefaultValue(),
    config,
  ).action(async (text: string[], options: SpeechOptions) => {
    await handleSpeechCommand(config, cache, text, options);
  });

  return cli;
}

export async function runCli(argv = process.argv): Promise<void> {
  const cli = buildCli();
  const normalizedArgv = [argv[0] ?? "node", argv[1] ?? "zundone", ...normalizeCliArgs(argv.slice(2))];
  cli.parse(normalizedArgv, { run: false });

  if (cli.matchedCommand?.commandAction) {
    await cli.runMatchedCommand();
  }
}

runCli().catch((error) => {
  writeStderr(`error: ${getErrorMessage(error)}`);

  if (error instanceof Error && "engineDown" in error) {
    const config = readConfig();
    if (config.backend === "docker") {
      writeStderr("hint: run `zundone engine up` to create or start the docker engine");
    } else {
      writeStderr("hint: verify VOICEVOX_URL or switch to ZUNDONE_BACKEND=docker");
    }
  }

  process.exit(1);
});
