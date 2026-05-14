import { BridgeError } from "../shared/errors.js";
import { ErrorCodes } from "../shared/error-codes.js";
import { BridgeService } from "../session/bridge-service.js";
import {
  CancelSchema,
  CloseSchema,
  ExecuteTaskSchema,
  InitSessionSchema,
  ReworkTurnSchema,
  RunTurnSchema,
  SetConfigSchema
} from "./schemas.js";

function toToolError(error: unknown): BridgeError {
  if (error instanceof BridgeError) {
    return error;
  }
  return new BridgeError(
    ErrorCodes.INVALID_REQUEST,
    error instanceof Error ? error.message : String(error),
    false
  );
}

export class DelegateTools {
  private readonly service: BridgeService;

  public constructor(service: BridgeService) {
    this.service = service;
  }

  public async initSession(rawInput: unknown): Promise<unknown> {
    const parsed = InitSessionSchema.parse(rawInput);
    return this.service.initSession(parsed);
  }

  public async runTurn(rawInput: unknown): Promise<unknown> {
    const parsed = RunTurnSchema.parse(rawInput);
    return this.service.runTurn(parsed);
  }

  public async reworkTurn(rawInput: unknown): Promise<unknown> {
    const parsed = ReworkTurnSchema.parse(rawInput);
    return this.service.reworkTurn(parsed);
  }

  public async setConfig(rawInput: unknown): Promise<unknown> {
    const parsed = SetConfigSchema.parse(rawInput);
    return this.service.setConfig(parsed);
  }

  public async cancelTurn(rawInput: unknown): Promise<unknown> {
    const parsed = CancelSchema.parse(rawInput);
    return this.service.cancel(parsed);
  }

  public async closeSession(rawInput: unknown): Promise<unknown> {
    const parsed = CloseSchema.parse(rawInput);
    return this.service.close(parsed);
  }

  public async executeTask(rawInput: unknown): Promise<unknown> {
    const parsed = ExecuteTaskSchema.parse(rawInput);
    return this.service.executeTask(parsed);
  }

  public static formatError(error: unknown): { code: string; message: string; retryable: boolean } {
    const bridgeError = toToolError(error);
    return {
      code: bridgeError.code,
      message: bridgeError.message,
      retryable: bridgeError.retryable
    };
  }
}
