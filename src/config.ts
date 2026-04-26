import envPaths from "env-paths";
import parseArgsStringToArgv from "string-argv";

export type Backend = "docker" | "http";

export type AppConfig = {
  backend: Backend;
  defaultUrl: string;
  defaultSpeaker: string;
  cacheDir: string;
  dockerContainer: string;
  dockerPort: number;
  dockerImage: string;
  playerBin?: string;
  playerArgs: string[];
  noCache: boolean;
  noAutolaunch: boolean;
};

const DEFAULT_DOCKER_PORT = 50021;

function parseBackend(rawValue: string | undefined): Backend {
  const value = (rawValue ?? "docker").toLowerCase();
  if (value === "docker" || value === "http") return value;
  throw new Error(`ZUNDONE_BACKEND must be "docker" or "http" (got: ${value})`);
}

function parsePort(rawValue: string | undefined, fallback: number, label: string): number {
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be a valid TCP port (got: ${rawValue})`);
  }
  return value;
}

function splitArgs(rawValue: string | undefined): string[] {
  return rawValue ? parseArgsStringToArgv(rawValue) : [];
}

function defaultDockerImage(arch: string): string {
  return arch === "arm64"
    ? "voicevox/voicevox_engine:cpu-arm64-latest"
    : "voicevox/voicevox_engine:cpu-latest";
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dockerPort = parsePort(env.ZUNDONE_DOCKER_PORT, DEFAULT_DOCKER_PORT, "ZUNDONE_DOCKER_PORT");

  return {
    backend: parseBackend(env.ZUNDONE_BACKEND),
    defaultUrl: normalizeBaseUrl(env.VOICEVOX_URL ?? `http://127.0.0.1:${dockerPort}`),
    defaultSpeaker: env.ZUNDONE_SPEAKER ?? "3",
    cacheDir: env.ZUNDONE_CACHE_DIR ?? envPaths("zundone", { suffix: "" }).cache,
    dockerContainer: env.ZUNDONE_DOCKER_CONTAINER ?? "voicevox",
    dockerPort,
    dockerImage: env.ZUNDONE_DOCKER_IMAGE ?? defaultDockerImage(process.arch),
    playerBin: env.ZUNDONE_PLAYER || undefined,
    playerArgs: splitArgs(env.ZUNDONE_PLAYER_ARGS),
    noCache: env.ZUNDONE_NO_CACHE === "1",
    noAutolaunch: env.ZUNDONE_NO_AUTOLAUNCH === "1",
  };
}
