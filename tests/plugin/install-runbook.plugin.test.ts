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
    expect(runbook).toContain("ian-think");
    expect(runbook).toContain("~/.codex/skills/team-delegate/docs/");
    expect(runbook).toContain("~/.codex/skills/ian-think/SKILL.md");
    expect(runbook).toContain("不能读取用户项目目录下的 `docs/` 或 `docs/superpowers/`");
    expect(runbook).toContain("OPENCODE_CONFIG_CONTENT");
    expect(runbook).toContain("86400000");
    expect(runbook).toContain("ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS=180000");
    expect(runbook).toContain("首次同步等待 3 分钟");
    expect(runbook).toContain("[mcp_servers.acp_codex2opencode_plugin]");
    expect(runbook).toContain("真实 Codex CLI 交付验证入口");
    expect(runbook).toContain("帮我用团队委派流程完成这个开发任务");
    expect(runbook).toContain("automation_update");
    expect(runbook).toContain("kind=heartbeat");
    expect(runbook).toContain("destination=thread");
    expect(runbook).toContain("status=ACTIVE");
    expect(runbook).toContain("当前环境无法建立真实自动跟进");
    expect(runbook).toContain("手动重复触发 `status`");
    expect(runbook).toContain("docs/团队委派交付测试必过表.md");
    expect(runbook).not.toContain("npm run skill:install-local");
  });

  it("should treat heartbeat availability as a delivery-test gate in the must-pass table", async () => {
    const checklist = await readFile(
      join(root, "docs", "团队委派交付测试必过表.md"),
      "utf8"
    );

    expect(checklist).toContain("Heartbeat 前置门禁");
    expect(checklist).toContain("automation_update");
    expect(checklist).toContain("kind=heartbeat");
    expect(checklist).toContain("destination=thread");
    expect(checklist).toContain("status=ACTIVE");
    expect(checklist).toContain("DT-01、DT-02、DT-05、DT-12、DT-13 一律判失败");
    expect(checklist).toContain("当前环境无法建立真实自动跟进");
    expect(checklist).toContain("禁止再对用户承诺“我会继续跟进”");
    expect(checklist).toContain("手动重复触发 `status`");
    expect(checklist).toContain("sleep");
    expect(checklist).toContain("Start-Sleep");
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
