import type { Logger } from "../observability/logger.js";
import { JsonRpcClient } from "./jsonrpc-client.js";

export interface AcpInitializeResult {
  capabilities?: Record<string, unknown>;
}

export interface AcpSessionOpenResult {
  sessionId: string;
  configOptions?: Array<{ id: string; currentValue: string }>;
}

export interface AcpPromptResult {
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    input_tokens?: number;
    outputTokens?: number;
    output_tokens?: number;
    thoughtTokens?: number;
    thought_tokens?: number;
  };
  summary?: string;
}

export type SessionUpdateHandler = (eventType: string, payload: unknown) => void;

interface PermissionOption {
  optionId?: unknown;
  kind?: unknown;
}

export class AcpSessionApi {
  private readonly rpc: JsonRpcClient;

  private readonly logger: Logger;

  private updateHandler?: SessionUpdateHandler;

  public constructor(rpc: JsonRpcClient, logger: Logger) {
    this.rpc = rpc;
    this.logger = logger;
    this.rpc.onRequest(async (method, params) => this.handleRpcRequest(method, params));
    this.rpc.onNotification((method, params) => {
      if (method === "session/update" && params && typeof params === "object") {
        const obj = params as Record<string, unknown>;
        let eventType = "unknown";
        if (typeof obj.type === "string") {
          eventType = obj.type;
        } else if (obj.update && typeof obj.update === "object") {
          const update = obj.update as Record<string, unknown>;
          if (typeof update.sessionUpdate === "string") {
            eventType = update.sessionUpdate;
          }
        }
        this.updateHandler?.(eventType, params);
      }
    });
  }

  public onSessionUpdate(handler: SessionUpdateHandler): void {
    this.updateHandler = handler;
  }

  public start(): void {
    this.rpc.start();
  }

  public async initialize(timeoutMs: number): Promise<AcpInitializeResult> {
    const result = await this.rpc.request<AcpInitializeResult>(
      "initialize",
      {
        protocolVersion: 1
      },
      timeoutMs
    );
    this.logger.info("acp.initialize.ok");
    return result;
  }

  public async newSession(
    cwd: string,
    mcpServers: string[],
    timeoutMs: number
  ): Promise<AcpSessionOpenResult> {
    return this.rpc.request<AcpSessionOpenResult>(
      "session/new",
      {
        cwd,
        mcpServers
      },
      timeoutMs
    );
  }

  public async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: string[],
    timeoutMs: number
  ): Promise<AcpSessionOpenResult> {
    return this.rpc.request<AcpSessionOpenResult>(
      "session/load",
      {
        sessionId,
        cwd,
        mcpServers
      },
      timeoutMs
    );
  }

  public async resumeSession(
    sessionId: string,
    cwd: string,
    timeoutMs: number
  ): Promise<AcpSessionOpenResult> {
    return this.rpc.request<AcpSessionOpenResult>(
      "session/resume",
      {
        sessionId,
        cwd
      },
      timeoutMs
    );
  }

  public async prompt(
    sessionId: string,
    promptText: string,
    timeoutMs: number
  ): Promise<AcpPromptResult> {
    return this.rpc.request<AcpPromptResult>(
      "session/prompt",
      {
        sessionId,
        prompt: [
          {
            type: "text",
            text: promptText
          }
        ]
      },
      timeoutMs
    );
  }

  public async cancel(sessionId: string): Promise<{ cancelled: boolean }> {
    await this.rpc.notify("session/cancel", { sessionId });
    // ACP 规范里 cancel 为通知，无响应体；这里返回本地确认。
    return { cancelled: true };
  }

  public async close(sessionId: string, timeoutMs: number): Promise<{ closed: boolean }> {
    return this.rpc.request<{ closed: boolean }>("session/close", { sessionId }, timeoutMs);
  }

  public async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
    timeoutMs: number
  ): Promise<{ configOptions: Array<{ id: string; currentValue: string }> }> {
    return this.rpc.request<{ configOptions: Array<{ id: string; currentValue: string }> }>(
      "session/set_config_option",
      {
        sessionId,
        configId,
        value
      },
      timeoutMs
    );
  }

  private async handleRpcRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== "session/request_permission") {
      throw new Error(`Unsupported ACP request: ${method}`);
    }
    return this.buildPermissionResponse(params);
  }

  private buildPermissionResponse(params: unknown): {
    outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  } {
    const options =
      params && typeof params === "object" && Array.isArray((params as Record<string, unknown>).options)
        ? ((params as Record<string, unknown>).options as PermissionOption[])
        : [];

    const selectedOptionId = this.selectAllowOption(options);
    if (!selectedOptionId) {
      this.logger.warn("acp.permission.no_allow_option");
      return {
        outcome: { outcome: "cancelled" }
      };
    }

    this.logger.info("acp.permission.auto_approved", {
      optionId: selectedOptionId
    });
    return {
      outcome: {
        outcome: "selected",
        optionId: selectedOptionId
      }
    };
  }

  private selectAllowOption(options: PermissionOption[]): string | undefined {
    const preferKinds = ["allow_once", "allow_always"];
    for (const targetKind of preferKinds) {
      const candidate = options.find(
        (item) => typeof item?.optionId === "string" && item.kind === targetKind
      );
      if (candidate && typeof candidate.optionId === "string") {
        return candidate.optionId;
      }
    }

    const byOptionId = options.find((item) => {
      if (typeof item?.optionId !== "string") {
        return false;
      }
      return item.optionId.toLowerCase().includes("allow");
    });
    if (byOptionId && typeof byOptionId.optionId === "string") {
      return byOptionId.optionId;
    }

    const first = options.find((item) => typeof item?.optionId === "string");
    return first?.optionId as string | undefined;
  }
}
