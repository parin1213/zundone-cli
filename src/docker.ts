import type { AppConfig } from "./config.js";
import { execa } from "execa";

import { getErrorCode, getErrorMessage } from "./errors.js";

export type DockerContainerStatus = {
  available: boolean;
  exists: boolean;
  running: boolean;
  state?: string;
  error?: string;
};

export type DockerEnsureOptions = {
  autoCreate: boolean;
  quiet: boolean;
};

export type DockerEnsureResult = {
  ok: boolean;
  reason?: string;
};

export type CommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  missing: boolean;
};

function dockerLaunchTarget(anyUrl: string): { ok: true; port: number } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(anyUrl);
  } catch {
    return { ok: false, reason: `VOICEVOX_URL is invalid: ${anyUrl}` };
  }

  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return {
      ok: false,
      reason: `backend=docker requires a local VOICEVOX_URL, got ${url.origin}`,
    };
  }

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: `VOICEVOX_URL must include a valid port: ${anyUrl}` };
  }

  return { ok: true, port };
}

async function waitForEngine(anyUrl: string, timeoutMs = 30_000): Promise<boolean> {
  const origin = new URL(anyUrl).origin;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetch(`${origin}/version`);
      if (response.ok) return true;
    } catch {
      // Ignore transient fetch errors while waiting for the engine.
    }
  }

  return false;
}

async function runDocker(args: string[]): Promise<CommandResult> {
  try {
    const result = await execa("docker", args, { reject: false });
    return {
      ok: result.exitCode === 0,
      code: result.exitCode ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      missing: false,
    };
  } catch (error) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: getErrorMessage(error),
      missing: getErrorCode(error) === "ENOENT",
    };
  }
}

export async function dockerContainerStatus(config: AppConfig): Promise<DockerContainerStatus> {
  const result = await runDocker([
    "ps",
    "-a",
    "--filter",
    `name=^${config.dockerContainer}$`,
    "--format",
    "{{.State}}",
  ]);

  if (result.missing) return { available: false, exists: false, running: false };
  if (!result.ok) {
    return {
      available: true,
      exists: false,
      running: false,
      error: result.stderr.trim() || "failed to query docker state",
    };
  }

  const state = result.stdout.trim().split("\n")[0] || "";
  if (!state) return { available: true, exists: false, running: false };

  return {
    available: true,
    exists: true,
    running: state === "running",
    state,
  };
}

export async function dockerPublishedPort(config: AppConfig): Promise<number | null> {
  const result = await runDocker([
    "inspect",
    "--format",
    '{{with index .NetworkSettings.Ports "50021/tcp"}}{{(index . 0).HostPort}}{{end}}',
    config.dockerContainer,
  ]);

  if (!result.ok) return null;
  const port = result.stdout.trim();
  return port ? Number(port) : null;
}

export async function dockerEnsureRunning(
  config: AppConfig,
  anyUrl: string,
  options: DockerEnsureOptions,
): Promise<DockerEnsureResult> {
  const launchTarget = dockerLaunchTarget(anyUrl);
  if (!launchTarget.ok) return launchTarget;

  const status = await dockerContainerStatus(config);
  if (!status.available) {
    return { ok: false, reason: "docker command is not available" };
  }
  if (status.error) {
    return { ok: false, reason: `failed to query docker state: ${status.error}` };
  }
  if (status.exists) {
    const publishedPort = await dockerPublishedPort(config);
    if (publishedPort && publishedPort !== launchTarget.port) {
      return {
        ok: false,
        reason:
          `container "${config.dockerContainer}" is published on host port ${publishedPort}, ` +
          `but the current URL expects ${launchTarget.port}. ` +
          "Align VOICEVOX_URL / ZUNDONE_DOCKER_PORT or recreate the container.",
      };
    }
  }

  if (!status.exists) {
    if (!options.autoCreate) {
      return {
        ok: false,
        reason: `container "${config.dockerContainer}" does not exist yet`,
      };
    }

    if (!options.quiet) {
      process.stderr.write(
        `Creating docker container "${config.dockerContainer}" from ${config.dockerImage}...\n`,
      );
    }

    const result = await runDocker([
      "run",
      "-d",
      "--restart",
      "unless-stopped",
      "--name",
      config.dockerContainer,
      "-p",
      `${launchTarget.port}:50021`,
      config.dockerImage,
    ]);

    if (!result.ok) {
      return { ok: false, reason: `docker run failed: ${result.stderr.trim()}` };
    }
  } else if (!status.running) {
    if (!options.quiet) {
      process.stderr.write(`Starting docker container "${config.dockerContainer}"...\n`);
    }

    const result = await runDocker(["start", config.dockerContainer]);
    if (!result.ok) {
      return { ok: false, reason: `docker start failed: ${result.stderr.trim()}` };
    }
  }

  const ready = await waitForEngine(anyUrl, 60_000);
  if (!ready) {
    return { ok: false, reason: "engine did not become reachable before timeout" };
  }

  return { ok: true };
}

export async function dockerStop(config: AppConfig): Promise<CommandResult> {
  return await runDocker(["stop", config.dockerContainer]);
}

export async function dockerLogs(config: AppConfig): Promise<CommandResult> {
  return await runDocker(["logs", "--tail", "100", config.dockerContainer]);
}
