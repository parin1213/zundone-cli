import { describe, expect, it } from "vitest";

import { buildCli, createHelpSections } from "../src/cli.js";
import { readConfig } from "../src/config.js";

describe("help output", () => {
  it("mentions the generated dist entrypoint and pnpm build flow", () => {
    const config = readConfig({});
    const helpSections = createHelpSections(config);
    const commands = buildCli(config).commands.map((command) => command.rawName);
    const rendered = helpSections.map((section) => `${section.title}\n${section.body}`).join("\n");

    expect(rendered).toContain("pnpm build");
    expect(rendered).toContain("dist/cli.js");
    expect(commands).toContain("engine [action]");
  });
});
