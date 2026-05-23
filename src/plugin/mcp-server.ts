import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLogger } from "../observability/logger.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { ExecuteTaskPublicSchema, PreflightTaskSchema } from "../mcp-tools/schemas.js";
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
    "delegate.task.preflight",
    {
      description:
        "高层入口预检：先完成起始阶段和开发类型的最小判定，再决定是否进入 delegate.task.execute(action=start)。如果信息不足，返回业务化缺失项和补充动作，避免空参数或越级调用。",
      inputSchema: PreflightTaskSchema
    },
    async (args) => toToolResponse(await tools.preflightTask(args))
  );

  server.registerTool(
    "delegate.task.execute",
    {
      description:
        "高层委派入口：按业务阶段推进方案、计划、实施、交付测试和整改闭环；实施完成后必须等待真实业务交付测试，通过后才完成；失败后由主会话生成整改方案和整改计划，用户确认后通过 remediation_approve 交给 ACP 执行整改并复测。只要插件返回了下一次跟进时间，主会话就必须把“下一次自动回来”真正安排好：优先调用 `automation_update` 为当前线程创建、刷新或取消 `kind=heartbeat` 的真实后续唤醒（`mode=create`/`update`/`delete`、`kind=heartbeat`、`destination=thread`、`status=ACTIVE`）；如果当前真实 Codex CLI 宿主没有这个工具，就不得结束当前轮，必须在同一轮保留等待窗口并到点后自动回到同一个任务闭环重新检查状态。返回 payload 中的 `follow_up_runtime_requirement` 会明确说明：没有 heartbeat 时当前轮是否必须继续保活（`current_turn_must_stay_open_without_heartbeat`）、至少保活到哪个时间点（`hold_until`）、到点后在同一任务闭环里重新执行什么动作（`recheck_action`），以及默认继续等待场景在重查状态后是否还要执行 `post_recheck_timeout_default_action=continue_wait`。运行态只要 next_action_required 仍包含 status，就必须继续按 follow_up_policy 持续跟进；如果运行态当前没有新进展且尚未进入 NEEDS_USER_DECISION，主会话必须静默保活等待窗口，不得反复输出“持续跟进中”之类的等待提示；当 NEEDS_USER_DECISION 允许超时默认继续时，也必须保留真实的 60 秒决策窗口，并在超时后重新检查状态再按 timeout_default 恢复等待。禁止结束当前轮后再依赖用户手动补触发或口头承诺冒充自动继续；只有进入非运行态，或 NEEDS_USER_DECISION 且 next_action_required 不包含 continue_wait 时，才停止持续跟进并向用户输出 user_message。",
      inputSchema: ExecuteTaskPublicSchema
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
