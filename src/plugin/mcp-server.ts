import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLogger } from "../observability/logger.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { DelegateTools } from "../mcp-tools/delegate-tools.js";
import { BridgeService } from "../session/bridge-service.js";

function parseAllowedWorkspaces(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {
    value
  };
}

function toToolResponse(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
} {
  const payload = result as { success?: boolean };
  const text = JSON.stringify(result, null, 2);
  if (payload.success === false) {
    return {
      content: [{ type: "text", text }],
      isError: true,
      structuredContent: toStructuredContent(result)
    };
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: toStructuredContent(result)
  };
}

async function main(): Promise<void> {
  const logger = createLogger((process.env.ACP_BRIDGE_LOG_LEVEL as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "INFO");
  const metrics = new MetricsRegistry();
  const stateDir = process.env.ACP_BRIDGE_STATE_DIR ?? join(process.cwd(), "runtime");
  await mkdir(stateDir, { recursive: true });

  const service = new BridgeService(
    {
      opencodeBinPath: process.env.OPENCODE_BIN_PATH ?? "opencode",
      stateDir,
      turnTimeoutMs: Number(process.env.ACP_BRIDGE_TURN_TIMEOUT_MS ?? "86400000"),
      workflowSyncWaitMs: Number(process.env.ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS ?? "180000"),
      allowedWorkspaces: parseAllowedWorkspaces(process.env.ACP_BRIDGE_ALLOWED_WORKSPACES)
    },
    logger,
    metrics
  );
  await service.init();

  const tools = new DelegateTools(service);
  const server = new McpServer({
    name: "acp-codex2opencode",
    version: "0.1.0"
  });

  server.registerTool(
    "delegate.task.execute",
    {
      description:
        "高层委派入口：每次 start 前先走模型选择流程（历史模型确认或重新选择）；确认模型后主对话传入起始阶段（design/planning/implementation/need_user_input）；Design/Planning 默认主会话执行（可切换 ACP），Implementation 直接委派 ACP；信息不足返回 NEEDS_USER_INPUT；status 查询阶段执行进度；长期运行返回 continue_wait/handoff_to_main 选项",
      inputSchema: z.object({
        workspace_path: z.string(),
        requirement_text: z.string(),
        session_alias: z.string().optional(),
        design_planning_executor: z.enum(["main", "acp"]).optional(),
        model_confirm_choice: z.enum(["use_saved_model", "select_new_model"]).optional(),
        selected_model: z.string().optional(),
        start_phase: z.enum(["design", "planning", "implementation", "need_user_input"]).optional(),
        start_phase_reason: z.string().optional(),
        start_phase_evidence: z.array(z.string()).optional(),
        missing_context: z.array(z.string()).optional(),
        action: z
          .enum([
            "start",
            "model_confirm",
            "model_select",
            "status",
            "continue_wait",
            "handoff_to_main",
            "design_feedback",
            "design_approve",
            "planning_feedback",
            "planning_approve"
          ])
          .optional(),
        feedback_text: z.string().optional(),
        preferred_model: z.string().optional(),
        acceptance_criteria: z.string().optional(),
        max_rework_rounds: z.number().int().min(0).max(10).optional(),
        auto_close: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.executeTask(args))
  );

  server.registerTool(
    "delegate.session.init",
    {
      description: "初始化或恢复委派会话",
      inputSchema: z.object({
        workspace_path: z.string(),
        session_alias: z.string(),
        session_strategy: z.enum(["auto", "new", "load", "resume"]).optional(),
        preferred_model: z.string().optional(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.initSession(args))
  );

  server.registerTool(
    "delegate.turn.run",
    {
      description: "发起一轮委派任务",
      inputSchema: z.object({
        bridge_session_id: z.string(),
        idempotency_key: z.string(),
        prompt_text: z.string(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.runTurn(args))
  );

  server.registerTool(
    "delegate.turn.rework",
    {
      description: "基于上一轮结果发起整改任务",
      inputSchema: z.object({
        bridge_session_id: z.string(),
        idempotency_key: z.string(),
        rework_prompt_text: z.string(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.reworkTurn(args))
  );

  server.registerTool(
    "delegate.session.set-config",
    {
      description: "设置会话配置项，例如模型切换",
      inputSchema: z.object({
        bridge_session_id: z.string(),
        config_id: z.string(),
        value: z.string(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.setConfig(args))
  );

  server.registerTool(
    "delegate.turn.cancel",
    {
      description: "取消当前运行中的轮次",
      inputSchema: z.object({
        bridge_session_id: z.string(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.cancelTurn(args))
  );

  server.registerTool(
    "delegate.session.close",
    {
      description: "关闭会话并释放资源",
      inputSchema: z.object({
        bridge_session_id: z.string(),
        force: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional()
      })
    },
    async (args) => toToolResponse(await tools.closeSession(args))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mcp.server.ready", { stateDir });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
