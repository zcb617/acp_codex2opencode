import type { ErrorCode } from "./error-codes.js";

export class BridgeError extends Error {
  public readonly code: ErrorCode;

  public readonly retryable: boolean;

  public readonly detail?: unknown;

  public constructor(code: ErrorCode, message: string, retryable: boolean, detail?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}
