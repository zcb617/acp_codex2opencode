import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const guideFiles = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];

describe("PT-01 plugin install contract", () => {
  it("should provide a valid plugin manifest and mcp config path", async () => {
    const raw = await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    expect(manifest.name).toBe("acp-codex2opencode");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    const promptList = ((manifest.interface as { defaultPrompt?: string[] })?.defaultPrompt) ?? [];
    expect(promptList.length).toBeLessThanOrEqual(3);
    expect(promptList.every((prompt) => prompt.length <= 128)).toBe(true);
    const prompts = promptList.join("\n");
    expect(prompts).toContain("delegate.task.execute");
    expect(prompts).toContain("action=start");
    expect(prompts).toContain("start_phase");
    expect(prompts).toContain("development_type");

    const mcpRaw = await readFile(join(root, ".mcp.json"), "utf8");
    const mcp = JSON.parse(mcpRaw) as {
      mcpServers?: Record<
        string,
        {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        }
      >;
    };
    const server = mcp.mcpServers?.["acp-codex2opencode"];

    expect(server?.command).toBe("node");
    expect(server?.args?.[0]).toBe("./dist/plugin/mcp-server.js");
    expect(server?.env?.ACP_BRIDGE_TURN_TIMEOUT_MS).toBe("86400000");
    expect(server?.env?.ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS).toBe("180000");
    expect(server?.env?.OPENCODE_CONFIG_CONTENT).toContain("\"permission\":\"allow\"");
    expect(server?.env?.OPENCODE_CONFIG_CONTENT).toContain("llm-router-openai-compatible/kimi-for-roo");

    const skill = await readFile(
      join(root, "skills", "team-delegate", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("Design");
    expect(skill).toContain("Planning");
    expect(skill).toContain("委派");
    expect(skill).toContain("delegation");
    expect(skill).toContain("<PHASE-JUDGEMENT-FIRST>");
    expect(skill).toContain("先在主对话内基于上下文判定业务阶段");
    expect(skill).toContain("判定结果必须随 `start_phase` 传入");
    expect(skill).toContain("开发类型");
    expect(skill).toContain("development_type");
    expect(skill).toContain("BUG 修改");
    expect(skill).toContain("禁止在插件内部通过关键词穷举判断开发类型");
    expect(skill).toContain("业务导向");
    expect(skill).toContain("只有计划实施阶段才需要选择 ACP 执行模型");
    expect(skill).toContain("禁止把 `workflow_status`");
    expect(skill).toContain("实施阶段必须满足 1-2 分钟持续跟进节奏");
    expect(skill).toContain("禁止提前向用户输出暂无进展");
    expect(skill).toContain("持续跟进");
    expect(skill).not.toContain("轮询");
    expect(skill).not.toContain("监控");
    expect(skill).not.toContain("沉默");
    expect(skill).not.toContain("柔性轮询");
    expect(skill).not.toContain("继续轮询");
    expect(skill).not.toContain("沉默窗口");
    expect(skill).not.toContain("沉默监控");
    expect(skill).not.toContain("建议检查时间");
  });

  it("should package all design and planning guide docs with the team-delegate skill", async () => {
    const skillDocsDir = join(root, "skills", "team-delegate", "docs");

    for (const guideFile of guideFiles) {
      const guidePath = join(skillDocsDir, guideFile);
      await expect(access(guidePath)).resolves.toBeUndefined();
      const guide = await readFile(guidePath, "utf8");
      expect(guide.trim().length).toBeGreaterThan(1000);
    }
  });
});
