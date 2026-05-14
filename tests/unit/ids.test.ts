import { describe, expect, it } from "vitest";
import { hashPrompt, newBridgeSessionId, newRequestId, newTurnId } from "../../src/shared/ids.js";

describe("shared ids", () => {
  it("should generate prefixed identifiers", () => {
    expect(newRequestId()).toMatch(/^req_/u);
    expect(newBridgeSessionId()).toMatch(/^bs_/u);
    expect(newTurnId()).toMatch(/^turn_/u);
  });

  it("should generate deterministic prompt hash", () => {
    const left = hashPrompt("hello");
    const right = hashPrompt("hello");
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });
});
