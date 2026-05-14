import { describe, expect, it } from "vitest";
import { ExecuteTaskSchema, InitSessionSchema, ReworkTurnSchema, RunTurnSchema } from "../../src/mcp-tools/schemas.js";

describe("DS-01~DS-03 delivery contracts", () => {
  it("should validate init and multi-turn payloads", () => {
    const init = InitSessionSchema.parse({
      workspace_path: "D:/repo/demo",
      session_alias: "task-20260513-001",
      session_strategy: "auto"
    });
    expect(init.session_strategy).toBe("auto");

    const run = RunTurnSchema.parse({
      bridge_session_id: "bs_001",
      idempotency_key: "turn-001",
      prompt_text: "请分析模块并给出建议"
    });
    expect(run.idempotency_key).toBe("turn-001");

    const rework = ReworkTurnSchema.parse({
      bridge_session_id: "bs_001",
      idempotency_key: "turn-002",
      rework_prompt_text: "请补充验证步骤"
    });
    expect(rework.rework_prompt_text).toContain("验证");

    const execute = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "把登录模块重构为可测试结构",
      session_alias: "delegate-task-001",
      action: "start",
      start_phase: "design",
      start_phase_reason: "上下文无设计文档，需从设计开始",
      design_planning_executor: "acp",
      max_rework_rounds: 2,
      auto_close: true
    });
    expect(execute.requirement_text).toContain("重构");
    expect(execute.design_planning_executor).toBe("acp");
  });

  it("should enforce action-specific workflow fields", () => {
    expect(() =>
      ExecuteTaskSchema.parse({
        workspace_path: "D:/repo/demo",
        requirement_text: "需求",
        action: "design_feedback"
      })
    ).toThrow();

    const feedback = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "需求",
      session_alias: "delegate-task-001",
      action: "design_feedback",
      feedback_text: "补充异常处理矩阵"
    });
    expect(feedback.action).toBe("design_feedback");
    expect(feedback.feedback_text).toContain("异常处理");

    const status = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "需求",
      session_alias: "delegate-task-001",
      action: "status"
    });
    expect(status.action).toBe("status");

    const continueWait = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "需求",
      session_alias: "delegate-task-001",
      action: "continue_wait"
    });
    expect(continueWait.action).toBe("continue_wait");

    const handoff = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "需求",
      session_alias: "delegate-task-001",
      action: "handoff_to_main"
    });
    expect(handoff.action).toBe("handoff_to_main");
  });
});
