import type { AppConfig } from "./config.js";
import { KNOWN_SPEAKERS } from "./constants.js";
import { dockerEnsureRunning } from "./docker.js";
import { EngineDownError, getErrorCode, getErrorMessage } from "./errors.js";

const NORMAL_STYLE_NAME = "ノーマル";

export type SpeakerStyle = {
  id: number;
  name: string;
};

export type Speaker = {
  name: string;
  styles: SpeakerStyle[];
};

export type SynthesizeInput = {
  text: string;
  speakerId: number;
  rate?: number;
  pitch?: number;
  volume?: number;
  intonation?: number;
};

export type VersionProbeResult = {
  ok: boolean;
  version?: string;
  error?: string;
};

type VoicevoxClientOptions = {
  baseUrl: string;
  autostartAllowed: boolean;
  autostartQuiet: boolean;
};

function isConnectionRefused(error: unknown): boolean {
  const message = getErrorMessage(error);
  return getErrorCode(error) === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(message);
}

export async function probeVersion(baseUrl: string): Promise<VersionProbeResult> {
  try {
    const response = await fetch(`${baseUrl}/version`);
    if (!response.ok) {
      return {
        ok: false,
        error: `${response.status} ${response.statusText}`,
      };
    }

    const text = (await response.text()).trim().replace(/^"|"$/g, "");
    return { ok: true, version: text || "unknown" };
  } catch (error) {
    return { ok: false, error: getErrorCode(error) ?? getErrorMessage(error) };
  }
}

export class VoicevoxClient {
  private autostartTried = false;

  constructor(
    private readonly config: AppConfig,
    private readonly options: VoicevoxClientOptions,
  ) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  private async fetchRaw(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (isConnectionRefused(error)) {
        throw new EngineDownError(`VOICEVOX engine is unreachable at ${url}`);
      }
      throw new Error(`request failed: ${getErrorMessage(error)}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${init?.method ?? "GET"} ${url} returned ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
      );
    }

    return response;
  }

  private async tryAutostart(url: string): Promise<void> {
    if (this.config.backend !== "docker") {
      throw new EngineDownError(
        `VOICEVOX engine is unreachable at ${url} and backend=${this.config.backend} cannot start it`,
      );
    }

    const result = await dockerEnsureRunning(this.config, url, {
      autoCreate: true,
      quiet: this.options.autostartQuiet,
    });
    if (!result.ok) {
      throw new EngineDownError(result.reason ?? "failed to start docker backend");
    }

    if (!this.options.autostartQuiet) {
      process.stderr.write("engine started via docker\n");
    }
  }

  private async fetchWithRecovery(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchRaw(url, init);
    } catch (error) {
      if (
        !(error instanceof EngineDownError) ||
        !this.options.autostartAllowed ||
        this.config.noAutolaunch ||
        this.autostartTried
      ) {
        throw error;
      }

      this.autostartTried = true;
      await this.tryAutostart(url);
      return await this.fetchRaw(url, init);
    }
  }

  async getSpeakers(): Promise<Speaker[]> {
    const response = await this.fetchWithRecovery(`${this.baseUrl}/speakers`);
    return (await response.json()) as Speaker[];
  }

  async resolveSpeakerId(input: string): Promise<number> {
    const trimmed = String(input).trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);

    const known = KNOWN_SPEAKERS[trimmed];
    if (known !== undefined) return known;

    const speakers = await this.getSpeakers();
    const [nameQuery, styleQuery] = trimmed.includes(":") ? trimmed.split(":", 2) : [trimmed, null];

    for (const speaker of speakers) {
      if (speaker.name === nameQuery || speaker.name.includes(nameQuery)) {
        if (styleQuery) {
          const style = speaker.styles.find((item) => item.name === styleQuery);
          if (style) return style.id;
          continue;
        }

        const normal = speaker.styles.find((item) => item.name === NORMAL_STYLE_NAME);
        const fallback = normal ?? speaker.styles[0];
        if (fallback) return fallback.id;
        continue;
      }
    }

    for (const speaker of speakers) {
      for (const style of speaker.styles) {
        if (style.name === trimmed || `${speaker.name}(${style.name})` === trimmed) {
          return style.id;
        }
      }
    }

    throw new Error(`speaker "${input}" was not found; try "zundone list"`);
  }

  async synthesize(input: SynthesizeInput): Promise<Buffer> {
    const queryUrl = `${this.baseUrl}/audio_query?speaker=${input.speakerId}&text=${encodeURIComponent(input.text)}`;
    const queryResponse = await this.fetchWithRecovery(queryUrl, { method: "POST" });
    const query = (await queryResponse.json()) as Record<string, unknown>;

    if (input.rate !== undefined) query.speedScale = input.rate;
    if (input.pitch !== undefined) query.pitchScale = input.pitch;
    if (input.volume !== undefined) query.volumeScale = input.volume;
    if (input.intonation !== undefined) query.intonationScale = input.intonation;

    const synthResponse = await this.fetchWithRecovery(`${this.baseUrl}/synthesis?speaker=${input.speakerId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav",
      },
      body: JSON.stringify(query),
    });

    return Buffer.from(await synthResponse.arrayBuffer());
  }
}
