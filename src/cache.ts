import { randomBytes, createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CacheKeyInput = {
  text: string;
  speakerId: number;
  rate?: number;
  pitch?: number;
  volume?: number;
  intonation?: number;
};

export type CacheInfo = {
  dir: string;
  count: number;
  bytes: number;
};

export type CacheClearResult = {
  removed: number;
  bytes: number;
};

export class WavCache {
  constructor(private readonly cacheDir: string) {}

  get dir(): string {
    return this.cacheDir;
  }

  buildKey(input: CacheKeyInput): string {
    const payload = JSON.stringify({
      v: 1,
      ...input,
      rate: input.rate ?? null,
      pitch: input.pitch ?? null,
      volume: input.volume ?? null,
      intonation: input.intonation ?? null,
    });

    return createHash("sha256").update(payload).digest("hex");
  }

  async lookup(key: string): Promise<string | null> {
    const filePath = join(this.cacheDir, `${key}.wav`);
    try {
      await access(filePath, fsConstants.R_OK);
      return filePath;
    } catch {
      return null;
    }
  }

  async store(key: string, wav: Buffer): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true });
    const filePath = join(this.cacheDir, `${key}.wav`);
    const tempPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tempPath, wav);
    await rename(tempPath, filePath);
    return filePath;
  }

  async clear(): Promise<CacheClearResult> {
    let removed = 0;
    let bytes = 0;

    try {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        if (!entry.endsWith(".wav") && !entry.endsWith(".tmp")) continue;
        const filePath = join(this.cacheDir, entry);
        try {
          const info = await stat(filePath);
          bytes += info.size;
          await rm(filePath);
          removed += 1;
        } catch {
          // Skip files that disappeared mid-cleanup.
        }
      }
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    }

    return { removed, bytes };
  }

  async info(): Promise<CacheInfo> {
    let count = 0;
    let bytes = 0;

    try {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        if (!entry.endsWith(".wav")) continue;
        try {
          bytes += (await stat(join(this.cacheDir, entry))).size;
          count += 1;
        } catch {
          // Skip files that disappeared mid-scan.
        }
      }
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    }

    return { dir: this.cacheDir, count, bytes };
  }
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
