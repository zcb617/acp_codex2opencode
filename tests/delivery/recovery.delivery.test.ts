import { describe, expect, it } from "vitest";
import { CloseSchema, SetConfigSchema } from "../../src/mcp-tools/schemas.js";

describe("DS-04~DS-08 delivery contracts", () => {
  it("should validate config and close payloads", () => {
    const setConfig = SetConfigSchema.parse({
      bridge_session_id: "bs_001",
      config_id: "model",
      value: "opencode/big-pickle"
    });
    expect(setConfig.config_id).toBe("model");

    const close = CloseSchema.parse({
      bridge_session_id: "bs_001",
      force: true
    });
    expect(close.force).toBe(true);
  });
});
