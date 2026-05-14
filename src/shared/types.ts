export type SessionStatus = "READY" | "ACTIVE" | "CLOSED" | "ERROR";

export type TurnStatus = "CREATED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type TurnType = "run" | "rework";

export interface DelegateSessionRecord {
  bridgeSessionId: string;
  sessionAlias: string;
  workspacePath: string;
  acpSessionId: string;
  currentModel?: string;
  configOptions: Array<{ id: string; currentValue: string }>;
  processPid?: number;
  status: SessionStatus;
  lastErrorCode?: string;
  activeTurnId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DelegateTurnRecord {
  turnId: string;
  bridgeSessionId: string;
  turnSeq: number;
  turnType: TurnType;
  idempotencyKey: string;
  promptSha256: string;
  promptText: string;
  status: TurnStatus;
  stopReason?: string;
  usage?: TokenUsage;
  startedAt?: string;
  endedAt?: string;
}

export interface DelegateEventRecord {
  eventId: string;
  turnId: string;
  eventSeq: number;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface DelegateAuditRecord {
  auditId: string;
  requestId: string;
  action: string;
  actor: string;
  resultCode: string;
  detail?: unknown;
  createdAt: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
}

export interface BridgeResult<T> {
  request_id: string;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
