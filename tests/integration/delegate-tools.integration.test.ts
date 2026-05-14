import { describe, expect, it, vi } from "vitest";
import { DelegateTools } from "../../src/mcp-tools/delegate-tools.js";

describe("delegate tools integration", () => {
  it("should pass parsed payload to bridge service", async () => {
    const service = {
      executeTask: vi.fn(async () => ({ request_id: "req_0", success: true, data: { ok: true } })),
      initSession: vi.fn(async () => ({ request_id: "req_1", success: true, data: { ok: true } })),
      runTurn: vi.fn(async () => ({ request_id: "req_2", success: true, data: { ok: true } })),
      reworkTurn: vi.fn(async () => ({ request_id: "req_3", success: true, data: { ok: true } })),
      setConfig: vi.fn(async () => ({ request_id: "req_4", success: true, data: { ok: true } })),
      cancel: vi.fn(async () => ({ request_id: "req_5", success: true, data: { ok: true } })),
      close: vi.fn(async () => ({ request_id: "req_6", success: true, data: { ok: true } }))
    };

    const tools = new DelegateTools(service as never);
    const response = await tools.initSession({
      workspace_path: "D:/repo",
      session_alias: "a1"
    });

    expect(service.initSession).toHaveBeenCalledTimes(1);
    expect((response as { success: boolean }).success).toBe(true);

    const execute = await tools.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "实现一个功能",
      session_alias: "task-001",
      action: "start"
    });
    expect(service.executeTask).toHaveBeenCalledTimes(1);
    expect(service.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "start",
        session_alias: "task-001"
      })
    );
    expect((execute as { success: boolean }).success).toBe(true);

    await tools.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "实现一个功能",
      session_alias: "task-001",
      action: "delivery_test_pass",
      feedback_text: "真实业务交付测试通过"
    });
    expect(service.executeTask).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "delivery_test_pass",
        feedback_text: "真实业务交付测试通过"
      })
    );

    await tools.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "实现一个功能",
      session_alias: "task-001",
      action: "cancel_follow_up"
    });
    expect(service.executeTask).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "cancel_follow_up"
      })
    );
  });
});
