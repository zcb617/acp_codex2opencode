import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

describe("PT-02/PT-03 plugin lifecycle contract", () => {
  it("should register all required delegate tools", async () => {
    const source = await readFile(join(root, "src", "plugin", "mcp-server.ts"), "utf8");

    const expectedTools = [
      "delegate.task.preflight",
      "delegate.task.execute",
      "delegate.session.init",
      "delegate.turn.run",
      "delegate.turn.rework",
      "delegate.session.set-config",
      "delegate.turn.cancel",
      "delegate.session.close"
    ];

    for (const toolName of expectedTools) {
      expect(source).toContain(`"${toolName}"`);
    }
  });
});
