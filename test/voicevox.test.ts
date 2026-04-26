import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";
import { probeVersion, VoicevoxClient } from "../src/voicevox.js";

const NORMAL_STYLE_NAME = "ノーマル";

const wavPayload = Buffer.from(
  "524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000",
  "hex",
);

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

afterEach(() => {
  delete process.env.ZUNDONE_BACKEND;
  delete process.env.ZUNDONE_NO_AUTOLAUNCH;
});

describe("VOICEVOX HTTP client", () => {
  it("probes version, resolves speakers, and synthesizes audio", async () => {
    let speakersRequested = 0;

    const server = await withServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify("test-engine"));
        return;
      }

      if (url.pathname === "/speakers") {
        speakersRequested += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              name: "TestSpeaker",
              styles: [
                { id: 42, name: NORMAL_STYLE_NAME },
                { id: 43, name: "Happy" },
              ],
            },
          ]),
        );
        return;
      }

      if (url.pathname === "/audio_query") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ speedScale: 1, pitchScale: 0, volumeScale: 1, intonationScale: 1 }));
        return;
      }

      if (url.pathname === "/synthesis") {
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wavPayload);
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });

    try {
      const config = readConfig({
        ZUNDONE_BACKEND: "http",
        ZUNDONE_NO_AUTOLAUNCH: "1",
      });
      const client = new VoicevoxClient(config, {
        baseUrl: server.url,
        autostartAllowed: false,
        autostartQuiet: true,
      });

      const version = await probeVersion(server.url);
      expect(version).toEqual({ ok: true, version: "test-engine" });

      expect(await client.resolveSpeakerId("zundamon")).toBe(3);
      expect(speakersRequested).toBe(0);

      expect(await client.resolveSpeakerId("TestSpeaker:Happy")).toBe(43);
      expect(speakersRequested).toBe(1);

      const wav = await client.synthesize({
        text: "test",
        speakerId: 43,
        rate: 1.2,
      });
      expect(wav.equals(wavPayload)).toBe(true);
    } finally {
      await server.close();
    }
  });
});
