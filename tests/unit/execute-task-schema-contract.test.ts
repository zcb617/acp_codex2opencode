import { describe, expect, it } from "vitest";
import {
  ExecuteTaskPublicSchema,
  ExecuteTaskSchema,
  parseExecuteTaskInput
} from "../../src/mcp-tools/schemas.js";

describe("execute task schema contracts", () => {
  it("should keep a plain object schema for MCP tool exposure", () => {
    const shape = ExecuteTaskPublicSchema.shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(["workspace_path", "action", "requirement_text", "session_alias", "task_id"]));
  });

  it("should keep runtime action-specific validation separate from public schema exposure", () => {
    expect(() =>
      parseExecuteTaskInput({
        workspace_path: "D:/repo/demo",
        session_alias: "delegate-task-001",
        action: "start"
      })
    ).toThrow("start 动作必须提供 requirement_text");

    expect(() =>
      parseExecuteTaskInput({
        workspace_path: "D:/repo/demo",
        action: "status"
      })
    ).toThrow("非 start 动作必须提供 session_alias 或 task_id");

    expect(() =>
      parseExecuteTaskInput({
        workspace_path: "D:/repo/demo",
        session_alias: "delegate-task-001",
        action: "implementation_executor_select"
      })
    ).toThrow("implementation_executor_select 动作必须提供 implementation_executor");
  });

  it("should preserve the runtime schema for existing parser-based callers", () => {
    const parsed = ExecuteTaskSchema.parse({
      workspace_path: "D:/repo/demo",
      requirement_text: "继续这个 BUG 修复",
      session_alias: "delegate-task-001",
      action: "start",
      start_phase: "implementation",
      development_type: "bugfix"
    });

    expect(parsed.action).toBe("start");
    expect(parsed.development_type).toBe("bugfix");
  });
});
