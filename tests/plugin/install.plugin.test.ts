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
const ianThinkSceneFiles = ["产品设计.md", "复制对标.md", "内容创作.md", "选择赛道.md", "营销成交.md", "skill.md"];

const universalDeliveryRequirements = [
  "项目类型只决定",
  "服务器端程序",
  "桌面端程序",
  "APP 端程序",
  "网页端程序",
  "monkeypatch",
  "不 mock 保存逻辑",
  "执行前状态快照",
  "键级",
  "逐项通过",
  "逐项失败",
  "禁止只在对话"
];

const clientUiDesignRequirements = [
  "整体风格",
  "按钮风格",
  "色彩体系",
  "主题色",
  "DPI",
  "截图",
  "录屏"
];

describe("PT-01 plugin install contract", () => {
  it("should provide a valid plugin manifest and mcp config path", async () => {
    const pkgRaw = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    const raw = await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    expect(manifest.name).toBe("acp-codex2opencode");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(manifest.version).toBe(pkg.version);
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
    expect(prompts).toContain("automation_update");
    expect(prompts).toContain("heartbeat");
    expect(prompts).toContain("status=ACTIVE");
    expect(prompts).toContain("没这个能力就别结束当前轮");
    expect(prompts).toContain("到点自动再查");
    expect(prompts).toContain("手动补触发");

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
    expect(skill).toContain("计划确认后必须先选择实施执行方");
    expect(skill).toContain("只有用户明确选择 ACP 实施时才需要选择 ACP 执行模型");
    expect(skill).toContain("主会话继续实施（默认）");
    expect(skill).toContain("ACP 委派实施");
    expect(skill).toContain("禁止把 `workflow_status`");
    expect(skill).toContain("实施阶段必须满足 1-2 分钟持续跟进节奏");
    expect(skill).toContain("禁止提前向用户输出暂无进展");
    expect(skill).toContain("same-turn-hold 保活等待窗口");
    expect(skill).toContain("不得额外输出");
    expect(skill).toContain("保持安静");
    expect(skill).toContain("持续跟进");
    expect(skill).toContain("方案/计划必须落成文件");
    expect(skill).toContain("required_output_document.relative_path");
    expect(skill).toContain("docs/superpowers/specs/<YYYY-MM-DD>-<session_alias>-design.md");
    expect(skill).toContain("docs/superpowers/plans/<YYYY-MM-DD>-<session_alias>-plan.md");
    expect(skill).toContain("计划必须对齐方案来源");
    expect(skill).toContain("design_document_paths");
    expect(skill).toContain("inline_design_from_requirement");
    expect(skill).toContain("allow_timeout_default");
    expect(skill).toContain("decision_source=timeout_default");
    expect(skill).toContain("decision_source=user_selected");
    expect(skill).toContain("<REAL-FOLLOW-UP-FIRST>");
    expect(skill).toContain("当前轮第一优先动作");
    expect(skill).toContain("优先用线程 heartbeat");
    expect(skill).toContain("真实 Codex CLI 会话");
    expect(skill).toContain("保持当前轮活着");
    expect(skill).toContain("automation_update");
    expect(skill).toContain("kind=heartbeat");
    expect(skill).toContain("destination=thread");
    expect(skill).toContain("重新调用 `status`");
    expect(skill).toContain("手动补发消息");
    expect(skill).toContain("手动再点一次");
    expect(skill).toContain("既没有 heartbeat 能力，也无法把当前轮保活");
    expect(skill).toContain("follow_up_runtime_requirement");
    expect(skill).toContain("current_turn_must_stay_open_without_heartbeat");
    expect(skill).toContain("hold_until");
    expect(skill).toContain("交付测试失败必须由主会话制定整改方案和整改计划");
    expect(skill).toContain("必须把完整整改方案和整改计划放入 `feedback_text`");
    expect(skill).toContain("ACP 只执行整改实施");
    expect(skill).toContain("询问用户是否进入 `ian-think` 需求挖掘");
    expect(skill).toContain("满足以下任一条件");
    expect(skill).toContain("输入仅为“方法论文档/参考资料 + 一句话目标”");
    expect(skill).toContain("输入仅为“纯一句话新增需求”");
    expect(skill).toContain("缺少最小业务信息");
    expect(skill).toContain("先任务定位，再判断是否需要需求深挖，再决定是否进入方案");
    expect(skill).toContain("不得直接进入 `design`");
    expect(skill).toContain("是否拦住，不看是不是一句话，也不看字数多少；只看当前信息是否足够支撑下一阶段");
    expect(skill).toContain("只有同时满足以下条件，才允许从入口继续流向 `design`");
    expect(skill).toContain("若为“新功能开发”，至少已经明确：业务目标、范围边界、成功标准、约束、优先级");
    expect(skill).toContain("若为“现有功能升级”，至少已经明确：受影响入口、现有流程范围、相关模块或代码线索、成功标准、约束或优先级");
    expect(skill).toContain("只要缺少上一条任一关键项，就必须先停在任务定位、上下文补充或需求深挖，不得直接进入 `design`");
    expect(skill).toContain("面向用户解释为什么被拦住时，禁止把“因为你这是一句话/多句话”当成主理由");
    expect(skill).toContain("若当前处于“需求补齐/需求深挖前置”，进入原因必须直接点名缺失的关键信息");
    expect(skill).toContain("先判断这是“现有功能升级”还是“新功能开发”");
    expect(skill).toContain("反例（必须判为 `need_user_input`");
    expect(skill).toContain("我给你一个方法论，再补一句‘按这个思路加 AI 功能’。");
    expect(skill).toContain("参考这份资料，帮我优化一下插件。");
    expect(skill).toContain("我要增加一个翻译功能，比如翻译截图里的文字，翻译当前选中行的文字。");
    expect(skill).not.toContain("监控");
    expect(skill).not.toContain("沉默");
    expect(skill).not.toContain("柔性轮询");
    expect(skill).not.toContain("继续轮询");
    expect(skill).not.toContain("沉默窗口");
    expect(skill).not.toContain("沉默监控");
    expect(skill).not.toContain("建议检查时间");

    const mcpServerSource = await readFile(
      join(root, "src", "plugin", "mcp-server.ts"),
      "utf8"
    );
    expect(mcpServerSource).toContain("automation_update");
    expect(mcpServerSource).toContain("kind=heartbeat");
    expect(mcpServerSource).toContain("destination=thread");
    expect(mcpServerSource).toContain("status=ACTIVE");
    expect(mcpServerSource).toContain("不得结束当前轮");
    expect(mcpServerSource).toContain("同一轮保留等待窗口");
    expect(mcpServerSource).toContain("手动补触发");
    expect(mcpServerSource).toContain("follow_up_runtime_requirement");
    expect(mcpServerSource).toContain("current_turn_must_stay_open_without_heartbeat");
    expect(mcpServerSource).toContain("静默保活等待窗口");
    expect(mcpServerSource).toContain("持续跟进中");

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("当前轮的第一优先动作");
    expect(readme).toContain("kind=heartbeat");
    expect(readme).toContain("destination=thread");
    expect(readme).toContain("status=ACTIVE");
    expect(readme).toContain("不得结束当前轮");
    expect(readme).toContain("手动补发消息");
    expect(readme).toContain("同一轮保留等待窗口");
    expect(readme).toContain("follow_up_runtime_requirement");
    expect(readme).toContain("current_turn_must_stay_open_without_heartbeat");
    expect(readme).toContain("静默保活等待窗口");
    expect(readme).toContain("持续跟进中");
  });

  it("should clear only this plugin cache in install and uninstall scripts", async () => {
    const installScript = await readFile(join(root, "scripts", "install-local.mjs"), "utf8");
    const uninstallScript = await readFile(join(root, "scripts", "uninstall-local.mjs"), "utf8");

    for (const script of [installScript, uninstallScript]) {
      expect(script).toContain(".codex");
      expect(script).toContain("plugins");
      expect(script).toContain("cache");
      expect(script).toContain("acp-local");
      expect(script).toContain("acp-codex2opencode");
    }
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

  it("should package ian-think skill with all required scene files", async () => {
    const ianThinkRoot = join(root, "skills", "ian-think");
    await expect(access(join(ianThinkRoot, "SKILL.md"))).resolves.toBeUndefined();

    for (const sceneFile of ianThinkSceneFiles) {
      await expect(access(join(ianThinkRoot, "scenes", sceneFile))).resolves.toBeUndefined();
    }
  });

  it("should require design-aligned delivery evidence in all guide docs", async () => {
    const guideDirs = [
      join(root, "docs"),
      join(root, "skills", "team-delegate", "docs")
    ];

    for (const guideDir of guideDirs) {
      for (const guideFile of guideFiles) {
        const guide = await readFile(join(guideDir, guideFile), "utf8");
        expect(guide).toMatch(/设计方案|设计承诺/u);
        for (const requirement of universalDeliveryRequirements) {
          expect(guide).toContain(requirement);
        }
      }
    }
  });

  it("should require client UI visual design in feature and bugfix design guides", async () => {
    const designGuideFiles = [
      "可交付开发设计文档编写指南-v0.1.md",
      "可交付BUG修改设计文档编写指南-v0.1.md"
    ];
    const guideDirs = [
      join(root, "docs"),
      join(root, "skills", "team-delegate", "docs")
    ];

    for (const guideDir of guideDirs) {
      for (const guideFile of designGuideFiles) {
        const guide = await readFile(join(guideDir, guideFile), "utf8");
        for (const requirement of clientUiDesignRequirements) {
          expect(guide).toContain(requirement);
        }
      }
    }
  });

  it("should require planning guides to align plans with design sources", async () => {
    const planningGuideFiles = [
      "可交付开发计划编写指南-v0.1.md",
      "可交付BUG修改计划编写指南-v0.1.md"
    ];
    const guideDirs = [
      join(root, "docs"),
      join(root, "skills", "team-delegate", "docs")
    ];

    for (const guideDir of guideDirs) {
      for (const guideFile of planningGuideFiles) {
        const guide = await readFile(join(guideDir, guideFile), "utf8");
        expect(guide).toContain("必须基于已经确认");
        expect(guide).toContain("必须读取对应的设计文档文件路径");
        expect(guide).toContain("以用户提供");
        expect(guide).toContain("必须写明");
      }
    }
  });
});
