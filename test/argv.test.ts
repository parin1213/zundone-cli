import { describe, expect, it } from "vitest";

import { normalizeCliArgs } from "../src/argv.js";

describe("normalizeCliArgs", () => {
  it("drops a pnpm-style leading separator", () => {
    expect(normalizeCliArgs(["--", "--help"])).toEqual(["--help"]);
  });

  it("leaves normal args untouched", () => {
    expect(normalizeCliArgs(["engine", "status"])).toEqual(["engine", "status"]);
  });
});
