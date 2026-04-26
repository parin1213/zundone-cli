import { execa } from "execa";
import which from "which";

import type { AppConfig } from "./config.js";
import { getErrorMessage } from "./errors.js";

type Player = { kind: "powershell" } | { kind: "command"; bin: string; args: string[] };

const PLAYER_ARGS_BY_BIN: Record<string, string[]> = {
  ffplay: ["-autoexit", "-nodisp", "-loglevel", "quiet"],
  play: ["-q"],
};

export async function resolvePlayer(config: AppConfig): Promise<Player> {
  if (config.playerBin) {
    return {
      kind: "command",
      bin: config.playerBin,
      args: config.playerArgs,
    };
  }

  if (process.platform === "win32") {
    return { kind: "powershell" };
  }

  const candidates =
    process.platform === "darwin"
      ? ["afplay", "paplay", "play", "ffplay"]
      : ["paplay", "aplay", "play", "ffplay"];

  for (const candidate of candidates) {
    if (await which(candidate, { nothrow: true })) {
      return {
        kind: "command",
        bin: candidate,
        args: PLAYER_ARGS_BY_BIN[candidate] ?? [],
      };
    }
  }

  throw new Error(
    "no suitable audio player was found; install afplay/paplay/aplay/play/ffplay or set ZUNDONE_PLAYER",
  );
}

export async function describePlayer(config: AppConfig): Promise<string> {
  try {
    const player = await resolvePlayer(config);
    return player.kind === "powershell"
      ? "PowerShell SoundPlayer"
      : `${player.bin}${player.args.length ? ` ${player.args.join(" ")}` : ""}`;
  } catch (error) {
    return `unavailable (${getErrorMessage(error)})`;
  }
}

export async function playWav(config: AppConfig, filePath: string): Promise<void> {
  const player = await resolvePlayer(config);
  if (player.kind === "powershell") {
    await execa("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`,
    ]);
    return;
  }

  await execa(player.bin, [...player.args, filePath]);
}
