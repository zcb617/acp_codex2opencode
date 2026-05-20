import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { BridgeService } from "../../src/session/bridge-service.js";
import { ErrorCodes } from "../../src/shared/error-codes.js";

const START_FROM_DESIGN_REQUIREMENT = "请从设计阶段开始，需求如下：实现一个功能。";

const DESIGN_SECTIONS_TEXT = [
  "背景与目标",
  "非目标",
  "范围与术语",
  "架构与模块职责",
  "技术选型与约束",
  "API 契约",
  "数据模型",
  "主流程与状态机",
  "异常处理策略矩阵",
  "幂等与去重规则",
  "测试策略",
  "验收标准",
  "发布与回滚 Runbook",
  "SLO 与告警",
  "环境配置矩阵",
  "开发实施规范"
].join("\n");

const PLANNING_SECTIONS_TEXT = [
  "项目与目标",
  "硬约束",
  "范围与非范围",
  "交付完成定义",
  "业务交付场景",
  "自测命令",
  "失败修复与复测机制",
  "技术设计与模块边界",
  "API、数据模型与配置",
  "开发任务拆分",
  "测试策略",
  "需求到验收映射",
  "最终交付清单"
].join("\n");

const REQUIREMENT_MINING_PACKAGE = {
  objective: "完成委派插件的需求深挖与后续文档闭环",
  user_ideas: ["先目标对齐，再深挖需求，最后再做方案和计划"],
  business_scenarios: ["用户只给一句话需求时，系统仍能收敛为可执行输入"],
  in_scope: ["需求挖掘门禁", "结构化需求包输入"],
  out_of_scope: ["修改 ACP 协议本身"],
  constraints: ["不能依赖第三方 skill 才能运行", "必须保持现有设计/计划审批门禁"],
  acceptance_criteria: ["未完成需求深挖时不能进入 design/planning"],
  risks: ["用户绕开同一 task_id 重新起任务可能跳过门禁"]
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockBridgeService(options?: {
  workflowSyncWaitMs?: number;
  turnTimeoutMs?: number;
  stateDir?: string;
}): BridgeService {
  const service = new BridgeService(
    {
      opencodeBinPath: "opencode",
      stateDir: options?.stateDir ?? "D:/tmp/acp-workflow-test",
      turnTimeoutMs: options?.turnTimeoutMs ?? 30_000,
      workflowSyncWaitMs: options?.workflowSyncWaitMs ?? 300
    },
    createLogger("ERROR"),
    new MetricsRegistry()
  );

  const hacked = service as unknown as Record<string, unknown>;
  const pendingStartByKey = new Map<string, Record<string, unknown>>();
  hacked.audit = vi.fn(async () => undefined);
  hacked.initSession = vi.fn(async () => ({
    request_id: "req_init",
    success: true,
    data: {
      bridge_session_id: "bs_001"
    }
  }));
  hacked.executeTurn = vi.fn(async (_turnType: string, _bridgeSessionId: string, idemKey: string, prompt: string) => ({
    request_id: `req_${idemKey}`,
    success: true,
    data: {
      turn_id: idemKey,
      stop_reason: "end_turn",
      summary: prompt
    }
  }));
  hacked.enforceDocumentGate = vi.fn(async () => ({
    passed: true,
    attempts: 1,
    missingSections: []
  }));
  hacked.hasDoneSignal = vi.fn(async () => true);
  hacked.close = vi.fn(async () => ({
    request_id: "req_close",
    success: true,
    data: {
      closed: true
    }
  }));
  hacked.cancel = vi.fn(async () => ({
    request_id: "req_cancel",
    success: true,
    data: {
      cancelled: true
    }
  }));
  hacked.selectInitialWorkflowModel = vi.fn(async (workflow: Record<string, unknown>) => {
    workflow.activeModel = "llm-router-openai-compatible/kimi-for-roo";
    workflow.fallbackModels = ["llm-router-openai-responses/gpt-5.4-mini"];
  });
  hacked.setWorkflowAgentMode = vi.fn(async (workflow: Record<string, unknown>, mode: string) => {
    workflow.activeAgentMode = mode;
  });
  hacked.listConfiguredModelsFromOpencode = vi.fn(() => [
    "llm-router-openai-compatible/kimi-for-roo",
    "llm-router-openai-responses/gpt-5.4-mini"
  ]);
  hacked.readWorkspacePreferredModel = vi.fn(async () => "llm-router-openai-compatible/kimi-for-roo");
  hacked.saveWorkspacePreferredModel = vi.fn(async () => undefined);
  hacked.cachePendingStartInput = vi.fn(
    async (workflowKey: string, input: Record<string, unknown>, sessionAlias: string, taskId: string) => {
      pendingStartByKey.set(workflowKey, {
        ...input,
        session_alias: sessionAlias,
        task_id: taskId,
        action: "start"
      });
    }
  );
  hacked.clearPendingStartInput = vi.fn(async (workflowKey: string) => {
    pendingStartByKey.delete(workflowKey);
  });
  hacked.resolveEffectiveStartInput = vi.fn(async (workflowKey: string, input: Record<string, unknown>) => {
    return (pendingStartByKey.get(workflowKey) as Record<string, unknown> | undefined) ?? input;
  });
  hacked.ensureWorkflowRuntimeContext = vi.fn(async () => undefined);
  return service;
}

function mockBridgeServiceWithRuntimeDefaults(): BridgeService {
  const service = new BridgeService(
    {
      opencodeBinPath: "opencode",
      stateDir: "D:/tmp/acp-workflow-test",
      turnTimeoutMs: 30_000
    },
    createLogger("ERROR"),
    new MetricsRegistry()
  );

  const hacked = service as unknown as Record<string, unknown>;
  const pendingStartByKey = new Map<string, Record<string, unknown>>();
  hacked.initSession = vi.fn(async () => ({
    request_id: "req_init",
    success: true,
    data: {
      bridge_session_id: "bs_001"
    }
  }));
  hacked.selectInitialWorkflowModel = vi.fn(async (workflow: Record<string, unknown>) => {
    workflow.activeModel = "llm-router-openai-compatible/kimi-for-roo";
    workflow.fallbackModels = ["llm-router-openai-responses/gpt-5.4-mini"];
  });
  hacked.setWorkflowAgentMode = vi.fn(async (workflow: Record<string, unknown>, mode: string) => {
    workflow.activeAgentMode = mode;
  });
  hacked.cachePendingStartInput = vi.fn(
    async (workflowKey: string, input: Record<string, unknown>, sessionAlias: string, taskId: string) => {
      pendingStartByKey.set(workflowKey, {
        ...input,
        session_alias: sessionAlias,
        task_id: taskId,
        action: "start"
      });
    }
  );
  hacked.clearPendingStartInput = vi.fn(async (workflowKey: string) => {
    pendingStartByKey.delete(workflowKey);
  });
  hacked.resolveEffectiveStartInput = vi.fn(async (workflowKey: string, input: Record<string, unknown>) => {
    return (pendingStartByKey.get(workflowKey) as Record<string, unknown> | undefined) ?? input;
  });
  hacked.ensureWorkflowRuntimeContext = vi.fn(async () => undefined);
  return service;
}

async function startAndConfirmModel(
  service: BridgeService,
  input: {
    workspace_path: string;
    requirement_text: string;
    session_alias: string;
    start_phase?: "design" | "planning" | "implementation" | "need_user_input";
    start_phase_evidence?: string[];
    missing_context?: string[];
    design_planning_executor?: "main" | "acp";
    development_type?: "feature" | "bugfix" | "need_user_input";
  }
): Promise<Awaited<ReturnType<BridgeService["executeTask"]>>> {
  const start = await service.executeTask({
    development_type: "feature",
    ...input,
    action: "start"
  });
  expect(start.success).toBe(true);
  expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MODEL_CONFIRM");

  const confirmed = await service.executeTask({
    development_type: "feature",
    ...input,
    action: "model_confirm",
    model_confirm_choice: "use_saved_model"
  });
  expect(confirmed.success).toBe(true);
  return confirmed;
}

describe("bridge workflow approvals", () => {
  it("should default the first synchronous workflow wait window to 3 minutes", async () => {
    const service = mockBridgeServiceWithRuntimeDefaults();

    const workflow = await (
      service as unknown as {
        startWorkflow: (
          input: Record<string, unknown>,
          sessionAlias: string,
          timeoutMs: number | undefined,
          detectedStartPhase: string,
          detectionEvidence: string[]
        ) => Promise<{ syncWaitMs: number }>;
      }
    ).startWorkflow(
      {
        workspace_path: "D:/workspace",
        requirement_text: "设计和计划已经确认，可以直接进入实施。",
        session_alias: "sync-wait-default",
        start_phase: "implementation",
        development_type: "feature"
      },
      "sync-wait-default",
      undefined,
      "implementation",
      []
    );

    expect(workflow.syncWaitMs).toBe(180_000);
  });

  it("should recognize done status when ACP streams the status marker in fragments", async () => {
    const service = mockBridgeServiceWithRuntimeDefaults();
    const hacked = service as unknown as {
      collectTurnOutputText: () => Promise<string>;
      hasDoneSignal: (result: { success: boolean; data?: { turn_id?: string } }) => Promise<boolean>;
    };
    hacked.collectTurnOutputText = vi.fn(async () => "STAT\nUS\n:\n D\nONE");

    await expect(
      hacked.hasDoneSignal({
        success: true,
        data: {
          turn_id: "turn_fragmented_done"
        }
      })
    ).resolves.toBe(true);
  });

  it("should keep design in the main session without asking for an ACP model", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-business-design",
      action: "start",
      start_phase: "design",
      start_phase_reason: "用户还没有方案，需要先制定方案。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MAIN_DESIGN");
    expect((start.data as { business_stage: string }).business_stage).toBe("方案制定");
    expect((start.data as { next_business_action: string }).next_business_action).toContain("主会话");
    const outputDocument = (
      start.data as { required_output_document: { phase: string; relative_path: string; absolute_path: string; rule: string } }
    ).required_output_document;
    expect(outputDocument.phase).toBe("design");
    expect(outputDocument.relative_path).toContain("docs/superpowers/specs");
    expect(outputDocument.rule).toContain("不允许只在对话");
    expect((start.data as { next_action_required: string[] }).next_action_required).not.toContain("model_select");
    expect(hacked.listConfiguredModelsFromOpencode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(hacked.initSession as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("should keep planning in the main session without asking for an ACP model", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `以下是方案内容：\n${DESIGN_SECTIONS_TEXT}`,
      session_alias: "task-business-planning",
      action: "start",
      start_phase: "planning",
      start_phase_reason: "当前已经有方案，但还没有计划。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MAIN_PLANNING");
    expect((start.data as { business_stage: string }).business_stage).toBe("计划制定");
    expect((start.data as { next_business_action: string }).next_business_action).toContain("主会话");
    expect((start.data as { planning_source: { source_type: string; rule: string } }).planning_source.source_type).toBe(
      "inline_design_from_requirement"
    );
    expect((start.data as { planning_source: { rule: string } }).planning_source.rule).toContain("用户直接提供");
    expect(JSON.stringify((start.data as { required_output_document: unknown }).required_output_document)).toContain(
      "docs/superpowers/plans"
    );
    expect((start.data as { next_action_required: string[] }).next_action_required).not.toContain("model_select");
    expect(hacked.listConfiguredModelsFromOpencode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(hacked.initSession as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("should restore cached requirement_text for model_confirm continuation", async () => {
    const service = mockBridgeService();

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-cached-model-confirm",
      action: "start",
      start_phase: "design",
      start_phase_reason: "用户还没有方案，需要先制定方案。",
      development_type: "feature",
      design_planning_executor: "acp"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MODEL_CONFIRM");

    const confirmed = await service.executeTask({
      workspace_path: "D:/repo",
      session_alias: "task-cached-model-confirm",
      action: "model_confirm",
      model_confirm_choice: "use_saved_model"
    });

    expect(confirmed.success).toBe(true);
    expect((confirmed.data as { workflow_status: string }).workflow_status).toBe("WAITING_DESIGN_APPROVAL");
  });

  it("should require planning to read referenced design document paths", async () => {
    const service = mockBridgeService();

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "请根据 docs/superpowers/specs/2026-05-14-task-business-design-design.md 制定计划。",
      session_alias: "task-business-planning-from-file",
      action: "start",
      start_phase: "planning",
      start_phase_reason: "当前方案已由主会话生成并保存为文档。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    const planningSource = (
      start.data as { planning_source: { source_type: string; design_document_paths: string[]; rule: string } }
    ).planning_source;
    expect(planningSource.source_type).toBe("design_document_path");
    expect(planningSource.design_document_paths.join("\n")).toContain("2026-05-14-task-business-design-design.md");
    expect(planningSource.rule).toContain("先读取这些方案文档");
  });

  it("should extract only the markdown path when planning text contains prose around a Windows path", async () => {
    const service = mockBridgeService();

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text:
        "这里是计划入口，不写代码。主会话已经生成方案文件，路径是：E:\\users\\zhangcb\\temp\\provided-design.md，请根据它制定计划。",
      session_alias: "task-business-planning-from-windows-file",
      action: "start",
      start_phase: "planning",
      start_phase_reason: "当前方案已由主会话生成并保存为文档。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    const planningSource = (
      start.data as { planning_source: { source_type: string; design_document_paths: string[] } }
    ).planning_source;
    expect(planningSource.source_type).toBe("design_document_path");
    expect(planningSource.design_document_paths).toEqual(["E:\\users\\zhangcb\\temp\\provided-design.md"]);
  });

  it("should ask for a model with business-oriented wording only when entering implementation", async () => {
    const service = mockBridgeService();

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `方案：\n${DESIGN_SECTIONS_TEXT}\n\n计划：\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-business-implementation",
      action: "start",
      start_phase: "implementation",
      start_phase_reason: "当前已经有方案和计划，用户确认可以进入实施。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MODEL_CONFIRM");
    expect((start.data as { business_stage: string }).business_stage).toBe("计划实施");
    expect((start.data as { user_message: string }).user_message).toContain("当前已经有了");
    expect((start.data as { user_message: string }).user_message).toContain("计划实施");
    expect((start.data as { user_message: string }).user_message).toContain("选择执行模型");
  });

  it("should block implementation start when referenced plan document fails strict gate", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;
    const invalidPlanPath = join(process.cwd(), "tests", "2026-05-16-erp-ai-adapter-enhancement-plan.md");

    const start = await service.executeTask({
      workspace_path: process.cwd(),
      requirement_text: `方案和计划都已经确认，直接进入实施。计划文档在 ${invalidPlanPath}。`,
      session_alias: "task-implementation-plan-gate-fail",
      action: "start",
      start_phase: "implementation",
      start_phase_reason: "用户明确要求直接实施。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((start.data as { business_stage: string }).business_stage).toBe("计划修订");
    expect((start.data as { user_message: string }).user_message).toContain("计划文档");
    expect((start.data as { next_business_action: string }).next_business_action).toContain("指南");
    expect((start.data as { missing_sections: string[] }).missing_sections.some((item) => item.includes("Task 明细"))).toBe(
      true
    );
    expect(
      (start.data as {
        document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
      }).document_revision_instruction.guide_relative_path
    ).toBe("docs/可交付开发计划编写指南-v0.1.md");
    expect(
      (start.data as {
        document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
      }).document_revision_instruction.document_type
    ).toBe("planning");
    expect(
      (start.data as {
        document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
      }).document_revision_instruction.development_type
    ).toBe("feature");
    expect(hacked.listConfiguredModelsFromOpencode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(hacked.initSession as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("should block implementation start by plan gate even when restoring existing workflow", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;
    const invalidPlanPath = join(process.cwd(), "tests", "2026-05-16-erp-ai-adapter-enhancement-plan.md");
    hacked.restoreExistingWorkflowForStart = vi.fn(async () => ({
      bridgeSessionId: "bs_existing",
      stage: "RUNNING_IMPLEMENTATION"
    }));

    const start = await service.executeTask({
      workspace_path: process.cwd(),
      requirement_text: `方案和计划都已经确认，直接进入实施。计划文档在 ${invalidPlanPath}。`,
      session_alias: "task-implementation-plan-gate-restore-existing",
      action: "start",
      start_phase: "implementation",
      start_phase_reason: "已有实施流程，需要在继续前重新校验计划。",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((start.data as { business_stage: string }).business_stage).toBe("计划修订");
    expect((start.data as { missing_sections: string[] }).missing_sections.some((item) => item.includes("Task 明细"))).toBe(
      true
    );
    expect(hacked.listConfiguredModelsFromOpencode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(hacked.initSession as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("should include the correct design guideline when a design document needs revision", async () => {
    const cases = [
      {
        developmentType: "bugfix" as const,
        sessionAlias: "task-design-guide-bugfix",
        expectedGuide: "docs/可交付BUG修改设计文档编写指南-v0.1.md"
      },
      {
        developmentType: "feature" as const,
        sessionAlias: "task-design-guide-feature",
        expectedGuide: "docs/可交付开发设计文档编写指南-v0.1.md"
      }
    ];

    for (const testCase of cases) {
      const service = mockBridgeService();
      const start = await startAndConfirmModel(service, {
        workspace_path: "D:/repo",
        requirement_text: START_FROM_DESIGN_REQUIREMENT,
        session_alias: testCase.sessionAlias,
        start_phase: "design",
        design_planning_executor: "acp",
        development_type: testCase.developmentType
      });

      expect((start.data as { workflow_status: string }).workflow_status).toBe("WAITING_DESIGN_APPROVAL");
      expect((start.data as { business_stage: string }).business_stage).toBe("方案确认");
      expect((start.data as { next_business_action: string }).next_business_action).toContain("指南");
      expect(
        (start.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.guide_relative_path
      ).toBe(testCase.expectedGuide);
      expect(
        (start.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.document_type
      ).toBe("design");
      expect(
        (start.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.development_type
      ).toBe(testCase.developmentType);
    }
  });

  it("should include the correct planning guideline when a plan document needs revision", async () => {
    const cases = [
      {
        developmentType: "bugfix" as const,
        sessionAlias: "task-plan-guide-bugfix",
        expectedGuide: "docs/可交付BUG修改计划编写指南-v0.1.md"
      },
      {
        developmentType: "feature" as const,
        sessionAlias: "task-plan-guide-feature",
        expectedGuide: "docs/可交付开发计划编写指南-v0.1.md"
      }
    ];

    for (const testCase of cases) {
      const service = mockBridgeService();
      await startAndConfirmModel(service, {
        workspace_path: "D:/repo",
        requirement_text: START_FROM_DESIGN_REQUIREMENT,
        session_alias: testCase.sessionAlias,
        start_phase: "design",
        design_planning_executor: "acp",
        development_type: testCase.developmentType
      });

      const planning = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: START_FROM_DESIGN_REQUIREMENT,
        session_alias: testCase.sessionAlias,
        action: "design_approve"
      });

      expect(planning.success).toBe(true);
      expect((planning.data as { workflow_status: string }).workflow_status).toBe("WAITING_PLAN_APPROVAL");
      expect((planning.data as { business_stage: string }).business_stage).toBe("计划确认");
      expect((planning.data as { next_business_action: string }).next_business_action).toContain("指南");
      expect(
        (planning.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.guide_relative_path
      ).toBe(testCase.expectedGuide);
      expect(
        (planning.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.document_type
      ).toBe("planning");
      expect(
        (planning.data as {
          document_revision_instruction: { guide_relative_path: string; document_type: string; development_type: string };
        }).document_revision_instruction.development_type
      ).toBe(testCase.developmentType);
    }
  });

  it("should block planning approve before design approve", async () => {
    const service = mockBridgeService();
    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-001",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("WAITING_DESIGN_APPROVAL");
    expect((start.data as { current_model?: string }).current_model).toBe(
      "llm-router-openai-compatible/kimi-for-roo"
    );
    expect((start.data as { current_agent_mode?: string }).current_agent_mode).toBeUndefined();

    const invalid = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-001",
      action: "planning_approve"
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.code).toBe(ErrorCodes.WORKFLOW_INVALID_TRANSITION);
  });

  it("should require delivery test after design and planning approvals", async () => {
    const service = mockBridgeService();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-002",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const planning = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-002",
      action: "design_approve"
    });
    expect(planning.success).toBe(true);
    expect((planning.data as { workflow_status: string }).workflow_status).toBe("WAITING_PLAN_APPROVAL");

    const implementationDone = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-002",
      action: "planning_approve"
    });
    expect(implementationDone.success).toBe(true);
    expect((implementationDone.data as { workflow_status: string }).workflow_status).toBe("RUNNING_IMPLEMENTATION");
    expect((implementationDone.data as { current_model?: string }).current_model).toBe(
      "llm-router-openai-compatible/kimi-for-roo"
    );
    expect((implementationDone.data as { current_agent_mode?: string }).current_agent_mode).toBeUndefined();
    expect((implementationDone.data as { next_action_required: string[] }).next_action_required).toEqual(["status"]);

    const implementationStatus = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-002",
      action: "status"
    });
    expect(implementationStatus.success).toBe(true);
    expect((implementationStatus.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");

    const delivered = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-002",
      action: "delivery_test_pass",
      feedback_text: "真实业务交付测试通过"
    });
    expect(delivered.success).toBe(true);
    expect((delivered.data as { workflow_status: string }).workflow_status).toBe("COMPLETED");
    expect((delivered.data as { workflow_completed: boolean }).workflow_completed).toBe(true);
  });

  it("should not let a short action timeout kill delegated implementation turns", async () => {
    const service = mockBridgeService({ turnTimeoutMs: 86_400_000 });
    const input = {
      workspace_path: "D:/repo",
      requirement_text: "设计和计划已经确认，直接进入实施。创建 delivery-result.md。",
      session_alias: "task-short-timeout",
      start_phase: "implementation" as const,
      development_type: "feature" as const
    };

    const start = await service.executeTask({
      ...input,
      action: "start"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MODEL_CONFIRM");

    const done = await service.executeTask({
      ...input,
      action: "model_confirm",
      model_confirm_choice: "use_saved_model",
      timeout_ms: 30_000
    });

    expect(done.success).toBe(true);
    expect((done.data as { workflow_status: string }).workflow_status).toBe("RUNNING_IMPLEMENTATION");
    expect((done.data as { next_action_required: string[] }).next_action_required).toEqual(["status"]);
    const status = await service.executeTask({
      ...input,
      action: "status"
    });
    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
    const executeTurn = (service as unknown as { executeTurn: ReturnType<typeof vi.fn> }).executeTurn;
    const implementationCall = executeTurn.mock.calls.find((call) => call[2]?.includes("implementation"));
    expect(implementationCall?.[4]).toBe(86_400_000);
  });

  it("should return running status first and then switch to review when phase completes", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 20 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(80);
      workflow.phaseGates = {
        design: {
          passed: true,
          attempts: 1,
          missingSections: []
        }
      };
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-003",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");

    await sleep(120);
    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-003",
      action: "status"
    });
    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("WAITING_DESIGN_APPROVAL");
  });

  it("should require user decision after silence timeout and support continue/handoff actions", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-004",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-004");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1_000;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    let status: Awaited<ReturnType<BridgeService["executeTask"]>> | undefined;
    status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-004",
      action: "status"
    });
    expect(status?.success).toBe(true);
    expect((status?.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");
    expect((status?.data as { next_action_required: string[] }).next_action_required).toEqual([
      "continue_wait",
      "handoff_to_main"
    ]);

    const cont = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-004",
      action: "continue_wait"
    });
    expect(cont.success).toBe(true);
    expect((cont.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const continuedStatus = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-004",
      action: "status"
    });
    expect(continuedStatus.success).toBe(true);
    expect((continuedStatus.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");

    const handoff = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-004",
      action: "handoff_to_main"
    });
    expect(handoff.success).toBe(true);
    expect((handoff.data as { workflow_status: string }).workflow_status).toBe("TRANSFERRED_TO_MAIN");
  });

  it("should require explicit user decision after three consecutive timeout-default continues", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-timeout-default-limit",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-timeout-default-limit");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      workflow!.lastProgressAtMs = Date.now() - 10_000;
      workflow!.nextPollDueAtMs = Date.now() - 1;
      const decision = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: START_FROM_DESIGN_REQUIREMENT,
        session_alias: "task-timeout-default-limit",
        action: "status"
      });

      expect(decision.success).toBe(true);
      expect((decision.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");
      const policy = (decision.data as {
        user_decision_policy: {
          allow_timeout_default: boolean;
          default_action: string;
          timeout_default_after_seconds: number;
          consecutive_timeout_defaults: number;
          consecutive_timeout_default_limit: number;
        };
      }).user_decision_policy;
      expect(policy.allow_timeout_default).toBe(true);
      expect(policy.default_action).toBe("continue_wait");
      expect(policy.timeout_default_after_seconds).toBe(60);
      expect(policy.consecutive_timeout_defaults).toBe(attempt);
      expect(policy.consecutive_timeout_default_limit).toBe(3);

      const continued = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: START_FROM_DESIGN_REQUIREMENT,
        session_alias: "task-timeout-default-limit",
        action: "continue_wait",
        decision_source: "timeout_default"
      } as Parameters<BridgeService["executeTask"]>[0]);
      expect(continued.success).toBe(true);
      expect((continued.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    }

    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;
    const fourthDecision = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-timeout-default-limit",
      action: "status"
    });

    expect(fourthDecision.success).toBe(true);
    expect((fourthDecision.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");
    const fourthPolicy = (fourthDecision.data as {
      user_decision_policy: {
        allow_timeout_default: boolean;
        default_action: string | null;
        consecutive_timeout_defaults: number;
      };
    }).user_decision_policy;
    expect(fourthPolicy.allow_timeout_default).toBe(false);
    expect(fourthPolicy.default_action).toBeNull();
    expect(fourthPolicy.consecutive_timeout_defaults).toBe(3);

    const forbiddenDefault = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-timeout-default-limit",
      action: "continue_wait",
      decision_source: "timeout_default"
    } as Parameters<BridgeService["executeTask"]>[0]);
    expect(forbiddenDefault.success).toBe(false);
    expect(forbiddenDefault.error?.message).toContain("必须由用户明确选择");
  });

  it("should clear timeout-default count after an explicit user selection", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-user-selection-clears-timeout-defaults");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      action: "status"
    });
    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      action: "continue_wait",
      decision_source: "timeout_default"
    } as Parameters<BridgeService["executeTask"]>[0]);

    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;
    const decision = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      action: "status"
    });
    expect((decision.data as { user_decision_policy: { consecutive_timeout_defaults: number } }).user_decision_policy.consecutive_timeout_defaults).toBe(1);

    const userContinued = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      action: "continue_wait",
      decision_source: "user_selected"
    } as Parameters<BridgeService["executeTask"]>[0]);
    expect(userContinued.success).toBe(true);

    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;
    const nextDecision = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-user-selection-clears-timeout-defaults",
      action: "status"
    });
    const nextPolicy = (nextDecision.data as {
      user_decision_policy: { allow_timeout_default: boolean; consecutive_timeout_defaults: number };
    }).user_decision_policy;
    expect(nextPolicy.allow_timeout_default).toBe(true);
    expect(nextPolicy.consecutive_timeout_defaults).toBe(0);
  });

  it("should clear timeout-default count when ACP emits progress", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-clears-timeout-defaults",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-progress-clears-timeout-defaults");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1;
    workflow!.consecutiveTimeoutDefaultContinueCount = 2;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: "ACP 已经返回新的进展。",
      eventCount: 1
    }));

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-clears-timeout-defaults",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    expect(
      (status.data as { user_decision_policy: { consecutive_timeout_defaults: number } }).user_decision_policy
        .consecutive_timeout_defaults
    ).toBe(0);
  });

  it("should restore a waiting workflow after the plugin process restarts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-workflow-recovery-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 5, stateDir });
    await service.init();
    const hacked = service as unknown as Record<string, unknown>;
    let releaseDesign!: () => void;
    hacked.runDesignPhase = vi.fn(
      async (workflow: Record<string, unknown>) =>
        new Promise<void>((resolve) => {
          releaseDesign = () => {
            workflow.stage = "WAITING_DESIGN_APPROVAL";
            resolve();
          };
        })
    );

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-recover-waiting",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-recover-waiting");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1_000;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const decision = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-recover-waiting",
      action: "status"
    });
    expect(decision.success).toBe(true);
    expect((decision.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 5, stateDir });
    await restoredService.init();
    (restoredService as unknown as { ensureWorkflowRuntimeContext: ReturnType<typeof vi.fn> }).ensureWorkflowRuntimeContext =
      vi.fn(async (wf: Record<string, unknown>) => {
        wf.stage = "NEEDS_ACP_SESSION_DECISION";
      });
    const continued = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-recover-waiting",
      action: "continue_wait"
    });

    releaseDesign();
    await service.shutdown();
    await restoredService.shutdown();

    expect(continued.success).toBe(true);
    expect((continued.data as { workflow_status: string }).workflow_status).toBe("NEEDS_ACP_SESSION_DECISION");
    expect((continued.data as { next_action_required: string[] }).next_action_required).toEqual([
      "handoff_to_main",
      "cancel_follow_up"
    ]);
    expect((continued.data as { user_message: string }).user_message).toContain("已结束或不可用");
  });

  it("should keep waiting and return progress when ACP emits output before silence timeout", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: "正在检查项目结构，准备修改状态返回逻辑。",
      eventCount: 1
    }));

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-001",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-progress-001");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-001",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    expect((status.data as { progress_update: { has_new_output: boolean; text: string } }).progress_update).toMatchObject({
      has_new_output: true,
      text: "正在检查项目结构，准备修改状态返回逻辑。"
    });
  });

  it("should ask for user decision only after ACP stays silent beyond the silence timeout", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: "",
      eventCount: 0
    }));

    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-002",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-progress-002");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-002",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");
  });

  it("should expose a decision deadline when timeout-default continue is allowed", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: "",
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-decision-deadline-001",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-decision-deadline-001");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-decision-deadline-001",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");
    const policy = (
      status.data as {
        user_decision_policy: {
          allow_timeout_default: boolean;
          timeout_default_deadline_at: string | null;
          timeout_default_remaining_seconds: number | null;
          decision_prompted_at: string | null;
        };
      }
    ).user_decision_policy;
    expect(policy.allow_timeout_default).toBe(true);
    expect(policy.timeout_default_deadline_at).toEqual(expect.any(String));
    expect(policy.timeout_default_remaining_seconds).not.toBeNull();
    expect(policy.decision_prompted_at).toEqual(expect.any(String));
  });

  it("should auto-continue by timeout_default on a later status poll after the decision window expires", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: "",
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-auto-continue-after-timeout",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-auto-continue-after-timeout");
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 1;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const firstDecision = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-auto-continue-after-timeout",
      action: "status"
    });
    expect(firstDecision.success).toBe(true);
    expect((firstDecision.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_DECISION");

    workflow!.userDecisionTimeoutAtMs = Date.now() - 1;
    workflow!.userDecisionTimeoutAt = new Date(workflow!.userDecisionTimeoutAtMs).toISOString();
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const autoContinued = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-auto-continue-after-timeout",
      action: "status"
    });

    expect(autoContinued.success).toBe(true);
    expect((autoContinued.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    expect(
      (
        autoContinued.data as {
          poll_policy: { consecutive_timeout_defaults: number; last_timeout_default_auto_continue_at: string | null };
        }
      ).poll_policy.consecutive_timeout_defaults
    ).toBe(1);
    expect(
      (
        autoContinued.data as {
          poll_policy: { consecutive_timeout_defaults: number; last_timeout_default_auto_continue_at: string | null };
        }
      ).poll_policy.last_timeout_default_auto_continue_at
    ).toEqual(expect.any(String));
  });

  it("should clear user-decision state when ACP outputs progress while waiting", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: "已完成初步修改，正在运行测试。",
      eventCount: 1
    }));

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-003",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-progress-003");
    expect(workflow).toBeDefined();
    workflow!.stage = "NEEDS_USER_DECISION";
    workflow!.activePhase = "design";
    workflow!.lastProgressAtMs = Date.now() - 1_000;

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-003",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("RUNNING_DESIGN");
    expect((status.data as { progress_update: { text: string } }).progress_update.text).toBe(
      "已完成初步修改，正在运行测试。"
    );
  });

  it("should expose a required 1-2 minute follow-up window instead of a fixed interval", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: "",
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-004",
      start_phase: "design",
      design_planning_executor: "acp"
    });
    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-progress-004");
    expect(workflow).toBeDefined();
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-progress-004",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect(
      (status.data as { follow_up_policy: { interval_min_seconds: number } }).follow_up_policy
        .interval_min_seconds
    ).toBe(60);
    expect(
      (status.data as { follow_up_policy: { interval_max_seconds: number } }).follow_up_policy
        .interval_max_seconds
    ).toBe(120);
    expect((status.data as { follow_up_policy: { guidance: string } }).follow_up_policy.guidance).toContain(
      "必须满足 1-2 分钟持续跟进节奏"
    );
  });

  it("should hold early status checks until the required follow-up time", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(1_000);
      workflow.stage = "WAITING_DESIGN_APPROVAL";
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: "",
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-follow-up-gate",
      start_phase: "design",
      design_planning_executor: "acp"
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get("d:/repo::task-follow-up-gate");
    expect(workflow).toBeDefined();
    workflow!.nextPollDueAtMs = Date.now() + 45;

    const startedAt = Date.now();
    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-follow-up-gate",
      action: "status"
    });

    expect(status.success).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(hacked.collectWorkflowProgressDelta as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("should require user input when context cannot determine start phase", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 20 });
    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "实现需求",
      session_alias: "task-005",
      action: "start",
      start_phase: "need_user_input",
      start_phase_evidence: ["mock-detection:missing-context"],
      missing_context: ["design_doc", "plan_doc"],
      development_type: "feature"
    });
    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((start.data as { next_action_required: string[] }).next_action_required).toEqual([
      "provide_context_then_restart"
    ]);
    expect((start.data as { next_business_action: string }).next_business_action).toContain("ian-think");
    expect((start.data as { next_business_action: string }).next_business_action).toContain("需求挖掘");
    expect((start.data as { requirement_mining: { status: string } }).requirement_mining.status).toBe("required");
  });

  it("should enforce requirement mining package before allowing design after ian-think entry", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 20 });

    const firstStart = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "一句话需求：帮我把插件优化到可交付。",
      session_alias: "task-requirement-mining-gate",
      action: "start",
      start_phase: "need_user_input",
      start_phase_evidence: ["mock-detection:one-sentence-requirement"],
      missing_context: ["设计来源", "业务边界"],
      development_type: "feature"
    });
    expect(firstStart.success).toBe(true);
    expect((firstStart.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");

    const blockedStart = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "现在进入方案阶段。",
      session_alias: "task-requirement-mining-gate",
      action: "start",
      start_phase: "design",
      development_type: "feature"
    });
    expect(blockedStart.success).toBe(true);
    expect((blockedStart.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((blockedStart.data as { business_stage: string }).business_stage).toBe("需求深挖");
    expect((blockedStart.data as { missing_context: string[] }).missing_context).toContain(
      "requirements_package.objective"
    );

    const passedStart = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求深挖完成，进入方案制定。",
      requirements_package: REQUIREMENT_MINING_PACKAGE,
      session_alias: "task-requirement-mining-gate",
      action: "start",
      start_phase: "design",
      start_phase_reason: "需求深挖已完成，开始方案制定。",
      development_type: "feature"
    });
    expect(passedStart.success).toBe(true);
    expect((passedStart.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MAIN_DESIGN");
  });

  it("should not call ACP stage detection when start_phase is missing", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;
    hacked.detectWorkflowEntry = vi.fn(async () => ({
      phase: "design",
      evidence: ["should-not-run"],
      missingContext: []
    }));

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "实现需求",
      session_alias: "task-005-b",
      action: "start",
      start_phase: "need_user_input",
      missing_context: ["start_phase（design/planning/implementation/need_user_input）"],
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((hacked.detectWorkflowEntry as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((hacked.initSession as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("should require development type before choosing an executor or model", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-missing-development-type",
      action: "start",
      start_phase: "design",
      start_phase_reason: "用户还没有方案，需要先制定方案。"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((start.data as { missing_context: string[] }).missing_context).toContain(
      "development_type（feature/bugfix/need_user_input）"
    );
    expect(hacked.initSession).not.toHaveBeenCalled();
  });

  it("should ask for context when development type is explicitly unclear", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-unclear-development-type",
      action: "start",
      start_phase: "design",
      development_type: "need_user_input",
      missing_context: ["请明确这是新增功能还是 BUG 修改"]
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_USER_INPUT");
    expect((start.data as { missing_context: string[] }).missing_context).toContain(
      "请明确这是新增功能还是 BUG 修改"
    );
    expect(hacked.initSession).not.toHaveBeenCalled();
  });

  it("should build feature design and planning prompts with development guides", () => {
    const service = mockBridgeService();
    const hacked = service as unknown as {
      buildDesignPrompt: (workflow: Record<string, unknown>) => string;
      buildPlanningPrompt: (workflow: Record<string, unknown>) => string;
    };

    const featureWorkflow = {
      requirementText: "实现一个功能",
      workspacePath: "D:/repo",
      sessionAlias: "task-feature-doc",
      developmentType: "feature"
    };
    const designPrompt = hacked.buildDesignPrompt(featureWorkflow);
    const planningPrompt = hacked.buildPlanningPrompt(featureWorkflow);

    expect(designPrompt).toContain("插件 skill 自带指南文档");
    expect(designPrompt).toContain("team-delegate");
    expect(designPrompt).toContain("禁止读取用户项目目录下的 docs 或 docs/superpowers");
    expect(designPrompt).toContain("docs/superpowers/specs");
    expect(designPrompt).toContain("必须把完整设计文档正文写入上述文件");
    expect(designPrompt).toContain("指南全文开始");
    expect(designPrompt).toContain("你必须按照上方指南全文的要求编写");
    expect(designPrompt).toContain("本指南要求输出的不是“想法文档”");
    expect(designPrompt).toContain("可交付开发设计文档编写指南");
    expect(designPrompt).toContain("## 背景与目标");
    expect(designPrompt).toContain("## 开发实施规范");
    expect(planningPrompt).toContain("插件 skill 自带指南文档");
    expect(planningPrompt).toContain("team-delegate");
    expect(planningPrompt).toContain("禁止读取用户项目目录下的 docs 或 docs/superpowers");
    expect(planningPrompt).toContain("docs/superpowers/plans");
    expect(planningPrompt).toContain("必须把完整计划文档正文写入上述文件");
    expect(planningPrompt).toContain("计划必须根据已经确认的方案展开");
    expect(planningPrompt).toContain("方案来源类型：用户在 requirement_text 中提供的方案正文");
    expect(planningPrompt).toContain("指南全文开始");
    expect(planningPrompt).toContain("你必须按照上方指南全文的要求编写");
    expect(planningPrompt).toContain("完整开发计划 = 开发实施计划");
    expect(planningPrompt).toContain("可交付开发计划编写指南");
    expect(planningPrompt).toContain("## 项目与目标");
    expect(planningPrompt).toContain("## 最终交付清单");
  });

  it("should build bugfix design and planning prompts with bugfix guides", () => {
    const service = mockBridgeService();
    const hacked = service as unknown as {
      buildDesignPrompt: (workflow: Record<string, unknown>) => string;
      buildPlanningPrompt: (workflow: Record<string, unknown>) => string;
    };

    const bugfixWorkflow = {
      requirementText: "修复恢复后找不到委派流程的问题",
      workspacePath: "D:/repo",
      sessionAlias: "task-bugfix-doc",
      developmentType: "bugfix"
    };
    const designPrompt = hacked.buildDesignPrompt(bugfixWorkflow);
    const planningPrompt = hacked.buildPlanningPrompt(bugfixWorkflow);

    expect(designPrompt).toContain("插件 skill 自带指南文档");
    expect(designPrompt).toContain("team-delegate");
    expect(designPrompt).toContain("禁止读取用户项目目录下的 docs 或 docs/superpowers");
    expect(designPrompt).toContain("docs/superpowers/specs");
    expect(designPrompt).toContain("必须把完整设计文档正文写入上述文件");
    expect(designPrompt).toContain("指南全文开始");
    expect(designPrompt).toContain("你必须按照上方指南全文的要求编写");
    expect(designPrompt).toContain("Bug 修改设计文档 = 失败事实记录");
    expect(designPrompt).toContain("可交付BUG修改设计文档编写指南");
    expect(designPrompt).toContain("## 失败事实");
    expect(designPrompt).toContain("## 交付测试目标");
    expect(designPrompt).not.toContain("## SLO 与告警");
    expect(planningPrompt).toContain("插件 skill 自带指南文档");
    expect(planningPrompt).toContain("team-delegate");
    expect(planningPrompt).toContain("禁止读取用户项目目录下的 docs 或 docs/superpowers");
    expect(planningPrompt).toContain("docs/superpowers/plans");
    expect(planningPrompt).toContain("必须把完整计划文档正文写入上述文件");
    expect(planningPrompt).toContain("计划必须根据已经确认的方案展开");
    expect(planningPrompt).toContain("方案来源类型：用户在 requirement_text 中提供的方案正文");
    expect(planningPrompt).toContain("指南全文开始");
    expect(planningPrompt).toContain("你必须按照上方指南全文的要求编写");
    expect(planningPrompt).toContain("Bug 修改计划 = 设计承诺落实表");
    expect(planningPrompt).toContain("可交付BUG修改计划编写指南");
    expect(planningPrompt).toContain("## TDD 与红灯测试计划");
    expect(planningPrompt).toContain("## 真实业务交付测试计划");
    expect(planningPrompt).not.toContain("## 最终交付清单");
  });

  it("should validate document gates against the required output document file", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as {
      evaluateRequiredSections: (
        result: { success: boolean; data?: { summary?: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };
    const outputDir = await mkdtemp(join(tmpdir(), "acp-doc-gate-"));
    const outputPath = join(outputDir, "design.md");
    await writeFile(outputPath, DESIGN_SECTIONS_TEXT, "utf8");

    const evaluation = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          summary: "已写入 docs/superpowers/specs/example-design.md\nSTATUS: DESIGN_READY"
        }
      },
      DESIGN_SECTIONS_TEXT.split("\n"),
      outputPath
    );

    expect(evaluation.passed).toBe(true);
    expect(evaluation.missingSections).toEqual([]);
  });

  it("should fail document gates when the required output document is missing", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as {
      evaluateRequiredSections: (
        result: { success: boolean; data?: { summary?: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };
    const outputDir = await mkdtemp(join(tmpdir(), "acp-doc-gate-"));
    const missingPath = join(outputDir, "missing-design.md");

    const evaluation = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          summary: DESIGN_SECTIONS_TEXT
        }
      },
      DESIGN_SECTIONS_TEXT.split("\n"),
      missingPath
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.missingSections).toContain("输出文档文件");
  });

  it("should persist and restore the selected development type", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-development-type-restore-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-development-type-restore",
      start_phase: "implementation",
      development_type: "bugfix"
    });
    await service.shutdown();

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await restoredService.init();
    const startAgain = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-development-type-restore",
      action: "start",
      start_phase: "implementation",
      development_type: "bugfix"
    });
    await restoredService.shutdown();

    expect(startAgain.success).toBe(true);
    expect((startAgain.data as { detected_development_type: string }).detected_development_type).toBe("bugfix");
    const documentProfile = (startAgain.data as {
      document_profile: { guide_source: string; design_guide: string; design_guide_relative_path: string };
    }).document_profile;
    expect(documentProfile.guide_source).toBe("team-delegate skill docs");
    expect(documentProfile.design_guide).toContain("team-delegate");
    expect(documentProfile.design_guide).toContain(
      "可交付BUG修改设计文档编写指南"
    );
    expect(documentProfile.design_guide_relative_path).toBe("docs/可交付BUG修改设计文档编写指南-v0.1.md");
  });

  it("should skip design and start from planning when design doc exists in context", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `以下是设计文档章节：\n${DESIGN_SECTIONS_TEXT}`,
      session_alias: "task-006",
      start_phase: "planning",
      design_planning_executor: "acp"
    });
    expect(start.success).toBe(true);
    expect((start.data as { detected_start_phase: string }).detected_start_phase).toBe("planning");
    expect((start.data as { workflow_status: string }).workflow_status).toBe("WAITING_PLAN_APPROVAL");
  });

  it("should skip to implementation when design and planning docs both exist", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    const start = await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-007",
      start_phase: "implementation"
    });
    expect(start.success).toBe(true);
    expect((start.data as { detected_start_phase: string }).detected_start_phase).toBe("implementation");
    expect((start.data as { workflow_status: string }).workflow_status).toBe("RUNNING_IMPLEMENTATION");
    expect((start.data as { next_action_required: string[] }).next_action_required).toEqual([
      "status"
    ]);
    expect((start.data as { user_message: string }).user_message).toContain("计划实施阶段");

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-007",
      action: "status"
    });
    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
    expect((status.data as { next_action_required: string[] }).next_action_required).toEqual([
      "delivery_test_pass",
      "delivery_test_fail"
    ]);
    expect((status.data as { user_message: string }).user_message).toContain("还不能判定交付完成");
  });

  it("should complete only after delivery test passes", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-delivery-pass",
      start_phase: "implementation"
    });

    const passed = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-delivery-pass",
      action: "delivery_test_pass",
      feedback_text: "真实业务交付测试通过"
    });

    expect(passed.success).toBe(true);
    expect((passed.data as { workflow_status: string }).workflow_status).toBe("COMPLETED");
    expect((passed.data as { delivery_test_passed: boolean }).delivery_test_passed).toBe(true);
  });

  it("should require main session remediation plan after delivery test fails", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-delivery-fail",
      start_phase: "implementation"
    });

    const failed = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-delivery-fail",
      action: "delivery_test_fail",
      feedback_text: "失败位置：CLI；实际表现：直接完成；预期表现：等待交付测试"
    });

    expect(failed.success).toBe(true);
    expect((failed.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");
    expect((failed.data as { next_business_action: string }).next_business_action).toContain(
      "主会话生成整改方案和整改计划"
    );
    expect((failed.data as { pending_remediation_plan?: string }).pending_remediation_plan).toBeUndefined();
    expect((failed.data as { next_action_required: string[] }).next_action_required).toContain(
      "remediation_approve"
    );
  });

  it("should return to delivery test after remediation completes", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-return",
      start_phase: "implementation"
    });

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-return",
      action: "delivery_test_fail",
      feedback_text: "失败位置：CLI；实际表现：直接完成；预期表现：等待交付测试"
    });

    const remediation = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-return",
      action: "remediation_approve",
      feedback_text: "整改方案：修复交付测试失败点。\n整改计划：完成修改后重新执行同一条真实交付测试。"
    });

    expect(remediation.success).toBe(true);
    expect((remediation.data as { workflow_status: string }).workflow_status).toBe("RUNNING_REMEDIATION");
    expect((remediation.data as { next_action_required: string[] }).next_action_required).toEqual(["status"]);

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-return",
      action: "status"
    });
    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
  });

  it("should restore the same task ACP session before remediation after a bridge restart", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-remediation-session-restore-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-session-restore",
      start_phase: "implementation"
    });

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-session-restore",
      action: "delivery_test_fail",
      feedback_text: "首次交付测试失败"
    });
    await service.shutdown();

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await restoredService.init();
    const restoredInit = (restoredService as unknown as { initSession: ReturnType<typeof vi.fn> }).initSession;
    restoredInit.mockClear();
    const remediation = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-session-restore",
      action: "remediation_approve",
      feedback_text: "整改方案：修复交付测试失败点。\n整改计划：完成修改后重新执行同一条真实交付测试。"
    });
    await restoredService.shutdown();

    expect(remediation.success).toBe(true);
    expect(restoredInit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_path: "D:/repo",
        session_alias: "task-remediation-session-restore",
        session_strategy: "auto"
      })
    );
    expect((remediation.data as { workflow_status: string }).workflow_status).toBe("RUNNING_REMEDIATION");
    expect((remediation.data as { next_action_required: string[] }).next_action_required).toEqual(["status"]);
    const status = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-session-restore",
      action: "status"
    });
    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
  });

  it("should ask the user to decide when the same task ACP session cannot be restored", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-remediation-session-fail-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-session-fail",
      start_phase: "implementation"
    });

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-session-fail",
      action: "delivery_test_fail",
      feedback_text: "首次交付测试失败"
    });
    await service.shutdown();

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await restoredService.init();
    (restoredService as unknown as { initSession: ReturnType<typeof vi.fn> }).initSession = vi.fn(async () => ({
      request_id: "req_init_failed",
      success: false,
      error: {
        code: ErrorCodes.SESSION_NOT_READY,
        message: "会话恢复失败",
        retryable: true
      }
    }));

    const remediation = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-session-fail",
      action: "remediation_approve",
      feedback_text: "整改方案：修复交付测试失败点。\n整改计划：完成修改后重新执行同一条真实交付测试。"
    });
    await restoredService.shutdown();

    expect(remediation.success).toBe(true);
    expect((remediation.data as { workflow_status: string }).workflow_status).toBe("NEEDS_ACP_SESSION_DECISION");
    expect((remediation.data as { next_action_required: string[] }).next_action_required).toEqual([
      "handoff_to_main",
      "cancel_follow_up"
    ]);
    expect((remediation.data as { pending_remediation_plan: string }).pending_remediation_plan).toContain(
      "整改方案"
    );
  });

  it("should let the same task be addressed by task_id without repeating session_alias", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-id-addressable-alias",
      start_phase: "implementation"
    });

    const status = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      task_id: "task-id-addressable-alias",
      action: "status"
    } as Parameters<BridgeService["executeTask"]>[0] & { task_id: string });

    expect(status.success).toBe(true);
    expect((status.data as { task_id: string }).task_id).toBe("task-id-addressable-alias");
    expect((status.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
  });

  it("should silently clear other expired task workflows when a new task starts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-expired-task-cleanup-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "old-expired-task",
      start_phase: "implementation"
    });

    const store = (service as unknown as {
      store: {
        findWorkflowByKey: (key: string) => Promise<{
          workflowKey: string;
          workspacePath: string;
          sessionAlias: string;
          bridgeSessionId: string;
          stage: string;
          snapshot: Record<string, unknown>;
          createdAt: string;
          updatedAt: string;
        } | undefined>;
        saveWorkflow: (record: {
          workflowKey: string;
          workspacePath: string;
          sessionAlias: string;
          bridgeSessionId: string;
          stage: string;
          snapshot: Record<string, unknown>;
          createdAt: string;
          updatedAt: string;
        }) => Promise<void>;
      };
    }).store;
    const oldKey = "d:/repo::old-expired-task";
    const oldWorkflow = await store.findWorkflowByKey(oldKey);
    expect(oldWorkflow).toBeDefined();
    await store.saveWorkflow({
      ...oldWorkflow!,
      snapshot: {
        ...oldWorkflow!.snapshot,
        taskId: "old-expired-task"
      },
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    });

    const newer = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "new-current-task",
      action: "start",
      start_phase: "implementation",
      development_type: "feature"
    });

    const oldAfterCleanup = await store.findWorkflowByKey(oldKey);
    await service.shutdown();

    expect(newer.success).toBe(true);
    expect(oldAfterCleanup).toBeUndefined();
  });

  it("should ask user to decide only after three remediation rounds fail", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-limit",
      start_phase: "implementation"
    });

    const firstFailure = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-limit",
      action: "delivery_test_fail",
      feedback_text: "首次交付测试失败"
    });
    expect((firstFailure.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");

    for (const round of [1, 2, 3]) {
      const remediation = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-limit",
        action: "remediation_approve",
        feedback_text: `第 ${round} 次整改方案：修复本轮失败点。\n第 ${round} 次整改计划：修改后复测同一条真实交付链路。`
      });
      expect((remediation.data as { workflow_status: string }).workflow_status).toBe("RUNNING_REMEDIATION");
      expect((remediation.data as { next_action_required: string[] }).next_action_required).toEqual(["status"]);

      const remediationStatus = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-limit",
        action: "status"
      });
      expect(remediationStatus.success).toBe(true);
      expect((remediationStatus.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");

      const failedAgain = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-limit",
        action: "delivery_test_fail",
        feedback_text: `第 ${round} 次整改后仍失败`
      });

      expect(failedAgain.success).toBe(true);
      if (round < 3) {
        expect((failedAgain.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");
      } else {
        expect((failedAgain.data as { workflow_status: string }).workflow_status).toBe(
          "NEEDS_REMEDIATION_DECISION"
        );
        expect((failedAgain.data as { next_action_required: string[] }).next_action_required).toEqual([
          "handoff_to_main",
          "cancel_follow_up"
        ]);
      }
    }
  });

  it("should cancel follow-up work without marking delivery as completed", async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 500 });
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-cancel",
      start_phase: "implementation"
    });

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-cancel",
      action: "delivery_test_fail",
      feedback_text: "首次交付测试失败"
    });

    for (const round of [1, 2, 3]) {
      await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-cancel",
        action: "remediation_approve",
        feedback_text: `第 ${round} 次整改方案：修复本轮失败点。\n第 ${round} 次整改计划：修改后复测同一条真实交付链路。`
      });
      await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-cancel",
        action: "delivery_test_fail",
        feedback_text: `第 ${round} 次整改后仍失败`
      });
    }

    const cancelled = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-cancel",
      action: "cancel_follow_up"
    });

    expect(cancelled.success).toBe(true);
    expect((cancelled.data as { workflow_status: string }).workflow_status).toBe("CANCELLED");
    expect((cancelled.data as { workflow_completed: boolean }).workflow_completed).toBe(false);
  });

  it("should restore remediation decision after restart and allow cancelling follow-up", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-remediation-recovery-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-remediation-restore",
      start_phase: "implementation"
    });

    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-restore",
      action: "delivery_test_fail",
      feedback_text: "首次交付测试失败"
    });

    for (const round of [1, 2, 3]) {
      await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-restore",
        action: "remediation_approve",
        feedback_text: `第 ${round} 次整改方案：修复恢复场景失败点。\n第 ${round} 次整改计划：修改后复测同一条真实交付链路。`
      });
      const failedAgain = await service.executeTask({
        workspace_path: "D:/repo",
        requirement_text: "需求",
        session_alias: "task-remediation-restore",
        action: "delivery_test_fail",
        feedback_text: `第 ${round} 次整改后仍失败`
      });
      expect(failedAgain.success).toBe(true);
    }
    await service.shutdown();

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await restoredService.init();
    const cancelled = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-restore",
      action: "cancel_follow_up"
    });
    await restoredService.shutdown();

    expect(cancelled.success).toBe(true);
    expect((cancelled.data as { workflow_status: string }).workflow_status).toBe("CANCELLED");
    expect((cancelled.data as { workflow_completed: boolean }).workflow_completed).toBe(false);
  });

  it("should restore an existing workflow when start is called with the same alias after restart", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-start-recovery-"));
    const service = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await service.init();
    await startAndConfirmModel(service, {
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-start-restore",
      start_phase: "implementation"
    });
    await service.shutdown();

    const restoredService = mockBridgeService({ workflowSyncWaitMs: 500, stateDir });
    await restoredService.init();
    const startAgain = await restoredService.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
      session_alias: "task-start-restore",
      action: "start",
      start_phase: "implementation",
      development_type: "feature"
    });
    await restoredService.shutdown();

    expect(startAgain.success).toBe(true);
    expect((startAgain.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
    expect((startAgain.data as { next_action_required: string[] }).next_action_required).toEqual([
      "delivery_test_pass",
      "delivery_test_fail"
    ]);
  });

  it("should default to main-session design execution when start phase is design", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: "task-008",
      action: "start",
      start_phase: "design",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MAIN_DESIGN");
    expect((start.data as { default_option: string }).default_option).toBe("1");
    expect(hacked.initSession).not.toHaveBeenCalled();
  });

  it("should default to main-session planning execution when start phase is planning", async () => {
    const service = mockBridgeService();
    const hacked = service as unknown as Record<string, unknown>;

    const start = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: `以下是设计文档章节：\n${DESIGN_SECTIONS_TEXT}`,
      session_alias: "task-009",
      action: "start",
      start_phase: "planning",
      development_type: "feature"
    });

    expect(start.success).toBe(true);
    expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_MAIN_PLANNING");
    expect((start.data as { default_option: string }).default_option).toBe("1");
    expect(hacked.initSession).not.toHaveBeenCalled();
  });
  it('UT-01: should return progress_update.summary when ACP has new output', async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(50);
      workflow.stage = 'WAITING_DESIGN_APPROVAL';
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: 'Completed initial modifications, now running tests.',
      summary: 'Completed initial modifications, now running tests.',
      summaryTruncated: false,
      eventCount: 1
    }));

    await startAndConfirmModel(service, {
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-001',
      start_phase: 'design',
      design_planning_executor: 'acp'
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get('d:/repo::ut-001');
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-001',
      action: 'status'
    });

    expect(status.success).toBe(true);
    const pu = (status.data as { progress_update: { has_new_output: boolean; summary: string } }).progress_update;
    expect(pu.has_new_output).toBe(true);
    expect(pu.summary).toBeDefined();
    expect(typeof pu.summary).toBe('string');
    expect(pu.summary.length).toBeGreaterThan(0);
  });

  it('UT-02: summary should be concise and summary_truncated should reflect length', async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(50);
      workflow.stage = 'WAITING_DESIGN_APPROVAL';
    });
    const longLine = 'A'.repeat(500);
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: longLine,
      summary: longLine.slice(0, 300),
      summaryTruncated: true,
      eventCount: 1
    }));

    await startAndConfirmModel(service, {
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-002',
      start_phase: 'design',
      design_planning_executor: 'acp'
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get('d:/repo::ut-002');
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-002',
      action: 'status'
    });

    expect(status.success).toBe(true);
    const pu = (status.data as { progress_update: { summary: string; summary_truncated: boolean } }).progress_update;
    expect(pu.summary.length).toBeLessThanOrEqual(300);
    expect(pu.summary_truncated).toBe(true);
  });

  it('UT-03: should stay RUNNING_* when silence is below threshold', async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(50);
      workflow.stage = 'WAITING_DESIGN_APPROVAL';
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: '',
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-003',
      start_phase: 'design',
      design_planning_executor: 'acp'
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get('d:/repo::ut-003');
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10_000;
    workflow!.lastProgressAtMs = Date.now() - 100;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-003',
      action: 'status'
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe('RUNNING_DESIGN');
    const nar = (status.data as { next_action_required: string[] }).next_action_required;
    expect(nar).not.toContain('continue_wait');
    expect(nar).not.toContain('handoff_to_main');
  });

  it('UT-04: should enter NEEDS_USER_DECISION when silence exceeds threshold', async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(50);
      workflow.stage = 'WAITING_DESIGN_APPROVAL';
    });
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: '',
      eventCount: 0
    }));

    await startAndConfirmModel(service, {
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-004',
      start_phase: 'design',
      design_planning_executor: 'acp'
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get('d:/repo::ut-004');
    expect(workflow).toBeDefined();
    workflow!.silenceDecisionMs = 10;
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const status = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-004',
      action: 'status'
    });

    expect(status.success).toBe(true);
    expect((status.data as { workflow_status: string }).workflow_status).toBe('NEEDS_USER_DECISION');
    expect((status.data as { next_action_required: string[] }).next_action_required).toEqual([
      'continue_wait',
      'handoff_to_main'
    ]);
  });

  it('UT-05: should clear user-decision window and resume RUNNING when new progress appears after decision', async () => {
    const service = mockBridgeService({ workflowSyncWaitMs: 5 });
    const hacked = service as unknown as Record<string, unknown>;
    hacked.runDesignPhase = vi.fn(async (workflow: Record<string, unknown>) => {
      await sleep(50);
      workflow.stage = 'WAITING_DESIGN_APPROVAL';
    });

    await startAndConfirmModel(service, {
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-005',
      start_phase: 'design',
      design_planning_executor: 'acp'
    });

    const workflowByKey = hacked.workflowByKey as Map<string, Record<string, unknown>>;
    const workflow = workflowByKey.get('d:/repo::ut-005');
    expect(workflow).toBeDefined();

    // First: reach NEEDS_USER_DECISION with no new output
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: false,
      text: '',
      eventCount: 0
    }));
    workflow!.silenceDecisionMs = 1;
    workflow!.lastProgressAtMs = Date.now() - 10_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const decision = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-005',
      action: 'status'
    });
    expect(decision.success).toBe(true);
    expect((decision.data as { workflow_status: string }).workflow_status).toBe('NEEDS_USER_DECISION');
    expect(workflow!.userDecisionPromptedAtMs).toBeDefined();

    // User chooses continue_wait
    const cont = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-005',
      action: 'continue_wait'
    });
    expect(cont.success).toBe(true);
    expect((cont.data as { workflow_status: string }).workflow_status).toBe('RUNNING_DESIGN');

    // Next poll: new output appears
    hacked.collectWorkflowProgressDelta = vi.fn(async () => ({
      hasNewOutput: true,
      text: 'Progress resumed, continuing work.',
      summary: 'Progress resumed, continuing work.',
      summaryTruncated: false,
      eventCount: 1
    }));
    workflow!.lastProgressAtMs = Date.now() - 1_000;
    workflow!.nextPollDueAtMs = Date.now() - 1;

    const resumed = await service.executeTask({
      workspace_path: 'D:/repo',
      requirement_text: START_FROM_DESIGN_REQUIREMENT,
      session_alias: 'ut-005',
      action: 'status'
    });
    expect(resumed.success).toBe(true);
    expect((resumed.data as { workflow_status: string }).workflow_status).toBe('RUNNING_DESIGN');
    expect(workflow!.userDecisionPromptedAtMs).toBeUndefined();
    expect(workflow!.consecutiveTimeoutDefaultContinueCount).toBe(0);
    const pu = (resumed.data as { progress_update: { has_new_output: boolean; summary: string } }).progress_update;
    expect(pu.has_new_output).toBe(true);
    expect(pu.summary.length).toBeGreaterThan(0);
  });

  it('UT-06: skill doc should mention summary usage for concise progress reporting', async () => {
    const fsMod = await import('node:fs/promises');
    const skillText = await fsMod.readFile('skills/team-delegate/SKILL.md', 'utf8');
    expect(skillText).toContain('简短进展总结');
    expect(skillText).toContain('不粘贴完整原始过程');
    expect(skillText).toContain('继续等待，不询问是否接手');
  });
});
