import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("derives the default url from the docker port", () => {
    const config = readConfig({
      ZUNDONE_DOCKER_PORT: "50031",
    });

    expect(config.defaultUrl).toBe("http://127.0.0.1:50031");
    expect(config.dockerPort).toBe(50031);
  });

  it("respects environment overrides", () => {
    const config = readConfig({
      VOICEVOX_URL: "http://remote-host:50021/",
      ZUNDONE_BACKEND: "http",
      ZUNDONE_CACHE_DIR: "/tmp/zundone-cache",
      ZUNDONE_PLAYER: "ffplay",
      ZUNDONE_PLAYER_ARGS: "--title \"some value\" -nodisp",
      ZUNDONE_NO_CACHE: "1",
      ZUNDONE_NO_AUTOLAUNCH: "1",
    });

    expect(config.backend).toBe("http");
    expect(config.defaultUrl).toBe("http://remote-host:50021");
    expect(config.cacheDir).toBe("/tmp/zundone-cache");
    expect(config.playerBin).toBe("ffplay");
    expect(config.playerArgs).toEqual(["--title", "some value", "-nodisp"]);
    expect(config.noCache).toBe(true);
    expect(config.noAutolaunch).toBe(true);
  });
});
