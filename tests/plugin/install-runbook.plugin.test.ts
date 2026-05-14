import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

describe("PT-00 install runbook contract", () => {
  it("should provide zero-branch install instructions", async () => {
    const runbook = await readFile(
      join(root, "docs", "superpowers", "runbooks", "plugin-local-install.md"),
      "utf8"
    );

    expect(runbook).toContain("三步快速安装");
    expect(runbook).toContain("npm run plugin:install-local");
    expect(runbook).toContain("INSTALLATION-COMPLETED");
    expect(runbook).toContain("线性安装步骤（A 到 G）");
    expect(runbook).toContain("team-delegate");
    expect(runbook).toContain("OPENCODE_CONFIG_CONTENT");
    expect(runbook).toContain("86400000");
    expect(runbook).toContain("ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS=180000");
    expect(runbook).toContain("首次同步等待 3 分钟");
    expect(runbook).toContain("[mcp_servers.acp_codex2opencode_plugin]");
    expect(runbook).not.toContain("npm run skill:install-local");
  });

  it("should expose install/uninstall commands in package scripts", async () => {
    const raw = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["plugin:install-local"]).toBe("node scripts/install-local.mjs");
    expect(pkg.scripts?.["plugin:uninstall-local"]).toBe("node scripts/uninstall-local.mjs");
    expect(pkg.scripts?.["skill:install-local"]).toBeUndefined();
    expect(pkg.scripts?.["skill:uninstall-local"]).toBeUndefined();
  });
});
