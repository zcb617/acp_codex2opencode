import { createHash, randomUUID } from "node:crypto";

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function newBridgeSessionId(): string {
  return `bs_${randomUUID()}`;
}

export function newTurnId(): string {
  return `turn_${randomUUID()}`;
}

export function newEventId(): string {
  return `evt_${randomUUID()}`;
}

export function hashPrompt(promptText: string): string {
  return createHash("sha256").update(promptText, "utf8").digest("hex");
}
