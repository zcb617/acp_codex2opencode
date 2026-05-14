import { BridgeError } from "../shared/errors.js";
import { ErrorCodes } from "../shared/error-codes.js";
import type { Logger } from "../observability/logger.js";
import { NdjsonTransport } from "./ndjson-transport.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotificationRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type JsonRpcId = number | string | null;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcAgentRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;

export class JsonRpcClient {
  private readonly transport: NdjsonTransport;

  private readonly logger: Logger;

  private nextId = 1;

  private notificationHandler?: NotificationHandler;

  private requestHandler?: RequestHandler;

  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }
  >();

  public constructor(transport: NdjsonTransport, logger: Logger) {
    this.transport = transport;
    this.logger = logger;
  }

  public start(): void {
    this.transport.start((message) => {
      this.handleIncoming(message);
    });
  }

  public onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  public onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  public async request<T>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            ErrorCodes.ACP_INIT_TIMEOUT,
            `JSON-RPC 请求超时: ${method}`,
            true
          )
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });
    });

    await this.transport.send(payload);
    return promise;
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    const payload: JsonRpcNotificationRequest = {
      jsonrpc: "2.0",
      method,
      params
    };
    await this.transport.send(payload);
  }

  private handleIncoming(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    const asObject = message as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(asObject, "id");
    if (typeof asObject.method === "string" && hasId) {
      void this.handleRequest(asObject as unknown as JsonRpcAgentRequest);
      return;
    }

    if (typeof asObject.id === "number") {
      this.handleResponse(asObject as unknown as JsonRpcResponse);
      return;
    }

    if (typeof asObject.method === "string") {
      const notification = asObject as unknown as JsonRpcNotification;
      this.notificationHandler?.(notification.method, notification.params);
      return;
    }

    this.logger.warn("acp.rpc.unknown_message", { message: asObject });
  }

  private async handleRequest(request: JsonRpcAgentRequest): Promise<void> {
    if (!this.requestHandler) {
      await this.sendErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }

    try {
      const result = await this.requestHandler(request.method, request.params);
      await this.transport.send({
        jsonrpc: "2.0",
        id: request.id,
        result: result ?? {}
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("acp.rpc.request_handler_failed", {
        method: request.method,
        message
      });
      await this.sendErrorResponse(request.id, -32603, message);
    }
  }

  private async sendErrorResponse(id: JsonRpcId, code: number, message: string): Promise<void> {
    await this.transport.send({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message
      }
    });
  }

  private handleResponse(response: JsonRpcResponse): void {
    const holder = this.pending.get(response.id);
    if (!holder) {
      this.logger.warn("acp.rpc.response_without_pending", { id: response.id });
      return;
    }

    clearTimeout(holder.timeout);
    this.pending.delete(response.id);

    if (response.error) {
      holder.reject(
        new BridgeError(
          ErrorCodes.PROMPT_EXEC_FAILED,
          response.error.message,
          true,
          response.error.data
        )
      );
      return;
    }

    holder.resolve(response.result);
  }
}
