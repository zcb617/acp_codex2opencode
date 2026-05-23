import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("MCP tool schema contract integration", () => {
  it("should expose complete inputSchema for delegate.task.execute via listTools", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "acp-test-"));
    const serverPath = join(import.meta.dirname, "..", "..", "dist", "plugin", "mcp-server.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        ACP_BRIDGE_STATE_DIR: stateDir,
        ACP_BRIDGE_LOG_LEVEL: "ERROR"
      }
    });

    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      const executeTool = tools.tools.find((t) => t.name === "delegate.task.execute");

      expect(executeTool).toBeDefined();
      expect(executeTool!.inputSchema).toBeDefined();
      expect(executeTool!.inputSchema.type).toBe("object");

      const properties = (executeTool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(properties).toHaveProperty("workspace_path");
      expect(properties).toHaveProperty("action");
      expect(properties).toHaveProperty("requirement_text");
      expect(properties).toHaveProperty("session_alias");
      expect(properties).toHaveProperty("task_id");

      const required = (executeTool!.inputSchema as Record<string, unknown>).required as string[] | undefined;
      expect(required).toBeDefined();
      expect(required!).toContain("workspace_path");
    } finally {
      await client.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("should expose complete inputSchema for delegate.task.preflight via listTools", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "acp-test-"));
    const serverPath = join(import.meta.dirname, "..", "..", "dist", "plugin", "mcp-server.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        ACP_BRIDGE_STATE_DIR: stateDir,
        ACP_BRIDGE_LOG_LEVEL: "ERROR"
      }
    });

    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      const preflightTool = tools.tools.find((t) => t.name === "delegate.task.preflight");

      expect(preflightTool).toBeDefined();
      expect(preflightTool!.inputSchema).toBeDefined();
      expect(preflightTool!.inputSchema.type).toBe("object");

      const properties = (preflightTool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(properties).toHaveProperty("workspace_path");
      expect(properties).toHaveProperty("requirement_text");

      const required = (preflightTool!.inputSchema as Record<string, unknown>).required as string[] | undefined;
      expect(required).toBeDefined();
      expect(required!).toContain("workspace_path");
      expect(required!).toContain("requirement_text");
    } finally {
      await client.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
