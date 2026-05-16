import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { BridgeService } from "../../src/session/bridge-service.js";

function createService(): BridgeService {
  return new BridgeService(
    {
      opencodeBinPath: "opencode",
      stateDir: "D:/tmp/acp-document-gate-test",
      turnTimeoutMs: 30_000,
      workflowSyncWaitMs: 300
    },
    createLogger("ERROR"),
    new MetricsRegistry()
  );
}

describe("document gate quality checks", () => {
  it("should reject planning API section when required contract fields are missing", async () => {
    const service = createService();
    const hacked = service as unknown as {
      collectTurnOutputText: (turnId: string | undefined, summary: string) => Promise<string>;
      evaluateRequiredSections: (
        result: { success: boolean; data: { turn_id: string; summary: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };

    const summary = [
      "## 9. API、数据模型与配置",
      "### POST /api/team-delegate/start",
      "- 请求方法：POST",
      "",
      "## 10. 开发任务拆分",
      "### Task 01: 补齐计划门禁",
      "- 目标：补齐计划门禁。",
      "- 文件范围：src/session/bridge-service.ts",
      "- 实施步骤：1) 增加校验。",
      "- 验证命令：npm run test:unit",
      "- 完成标准：相关测试通过。",
      "- 对应业务交付场景：DS-PLAN-01"
    ].join("\n");

    hacked.collectTurnOutputText = vi.fn(async () => summary);
    const result = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          turn_id: "turn_quality_01",
          summary
        }
      },
      ["API、数据模型与配置", "开发任务拆分"]
    );

    expect(result.passed).toBe(false);
    expect(result.missingSections.some((item) => item.includes("API、数据模型与配置章节缺少字段"))).toBe(true);
  });

  it("should reject task blocks that miss execution fields", async () => {
    const service = createService();
    const hacked = service as unknown as {
      collectTurnOutputText: (turnId: string | undefined, summary: string) => Promise<string>;
      evaluateRequiredSections: (
        result: { success: boolean; data: { turn_id: string; summary: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };

    const summary = [
      "## 9. API、数据模型与配置",
      "- 请求方法：POST",
      "- 路径：/api/team-delegate/start",
      "- 入参：workspace_path, requirement_text",
      "- 出参：workflow_status, required_output_document",
      "- 错误码：FAILED, NEEDS_USER_INPUT",
      "- 幂等规则：同一 task_id 幂等",
      "- 权限/鉴权：仅当前 workspace 生效",
      "- 数据表或实体：delegate_workflow_state",
      "- 环境变量：ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS",
      "",
      "## 10. 开发任务拆分",
      "### Task 01: 修订提示词",
      "- 目标：修订提示词并重试。"
    ].join("\n");

    hacked.collectTurnOutputText = vi.fn(async () => summary);
    const result = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          turn_id: "turn_quality_02",
          summary
        }
      },
      ["API、数据模型与配置", "开发任务拆分"]
    );

    expect(result.passed).toBe(false);
    expect(result.missingSections.some((item) => item.includes("Task 01"))).toBe(true);
  });

  it("should pass when API and task sections contain required details", async () => {
    const service = createService();
    const hacked = service as unknown as {
      collectTurnOutputText: (turnId: string | undefined, summary: string) => Promise<string>;
      evaluateRequiredSections: (
        result: { success: boolean; data: { turn_id: string; summary: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };

    const summary = [
      "## 9. API、数据模型与配置",
      "### delegate_task_execute(action=start)",
      "- 请求方法：MCP Tool 调用（action=start）",
      "- 路径：delegate_task_execute",
      "- 入参：workspace_path, requirement_text, session_alias, start_phase, development_type",
      "- 出参：workflow_status, business_stage, required_output_document, next_action_required",
      "- 错误码：FAILED, NEEDS_USER_INPUT, WORKFLOW_INVALID_TRANSITION",
      "- 幂等规则：同一 task_id + session_alias 不重复创建流程",
      "- 权限/鉴权：只允许已配置工作区",
      "- 数据表或实体：delegate_workflow_state, phase_gates",
      "- 环境变量：ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS, ACP_BRIDGE_TURN_TIMEOUT_MS",
      "",
      "## 10. 开发任务拆分",
      "### Task 01: 增强计划文档门禁",
      "- 目标：拦截空壳计划文档。",
      "- 文件范围：src/session/bridge-service.ts, tests/unit/bridge-document-gate-quality.test.ts",
      "- 实施步骤：1) 增加内容质量校验。2) 在门禁中接入质量校验。3) 新增单元测试。",
      "- 验证命令：npm run test:unit -- tests/unit/bridge-document-gate-quality.test.ts",
      "- 完成标准：质量校验能识别缺失字段，且完整文档可通过门禁。",
      "- 对应业务交付场景：DS-PLAN-01, DS-PLAN-02"
    ].join("\n");

    hacked.collectTurnOutputText = vi.fn(async () => summary);
    const result = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          turn_id: "turn_quality_03",
          summary
        }
      },
      ["API、数据模型与配置", "开发任务拆分"]
    );

    expect(result.passed).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  it("should reject the real erp ai adapter plan that misses strict task-gate structure", async () => {
    const service = createService();
    const hacked = service as unknown as {
      collectTurnOutputText: (turnId: string | undefined, summary: string) => Promise<string>;
      evaluateRequiredSections: (
        result: { success: boolean; data: { turn_id: string; summary: string } },
        requiredSections: string[],
        outputDocumentPath?: string
      ) => Promise<{ passed: boolean; missingSections: string[] }>;
    };

    const realPlanPath = join(process.cwd(), "tests", "2026-05-16-erp-ai-adapter-enhancement-plan.md");
    const realPlan = await readFile(realPlanPath, "utf8");
    hacked.collectTurnOutputText = vi.fn(async () => realPlan);

    const result = await hacked.evaluateRequiredSections(
      {
        success: true,
        data: {
          turn_id: "turn_real_plan_gate",
          summary: realPlan
        }
      },
      ["API、数据模型与配置", "开发任务拆分"]
    );

    expect(result.passed).toBe(false);
    expect(result.missingSections).toContain("开发任务拆分章节缺少 Task 明细（至少一个 `### Task XX`）");
  });
});
