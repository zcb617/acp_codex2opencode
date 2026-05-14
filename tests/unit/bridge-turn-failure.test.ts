import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeService } from "../../src/session/bridge-service.js";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { BridgeError } from "../../src/shared/errors.js";
import { ErrorCodes } from "../../src/shared/error-codes.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("bridge turn failure recovery", () => {
  it("should mark failed turn and release active session on prompt failure", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "acp-turn-fail-"));
    tempDirs.push(stateDir);

    const service = new BridgeService(
      {
        opencodeBinPath: "opencode",
        stateDir,
        turnTimeoutMs: 1000
      },
      createLogger("ERROR"),
      new MetricsRegistry()
    );
    await service.init();

    try {
      const hacked = service as unknown as Record<string, unknown>;
      const store = hacked.store as {
        saveSession: (record: Record<string, unknown>) => Promise<void>;
        findSessionById: (id: string) => Promise<Record<string, unknown> | undefined>;
        findTurnByIdempotency: (sessionId: string, key: string) => Promise<Record<string, unknown> | undefined>;
      };

      const sessionId = "bs_turn_fail_1";
      await store.saveSession({
        bridgeSessionId: sessionId,
        sessionAlias: "turn-fail",
        workspacePath: "D:/repo",
        acpSessionId: "ses_turn_fail_1",
        configOptions: [],
        status: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      hacked.mustApi = () => ({
        prompt: async () => {
          throw new BridgeError(ErrorCodes.ACP_INIT_TIMEOUT, "JSON-RPC 请求超时: session/prompt", true);
        }
      });

      const result = await service.runTurn({
        bridge_session_id: sessionId,
        idempotency_key: "idem-turn-fail-1",
        prompt_text: "test prompt",
        timeout_ms: 1000
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.ACP_INIT_TIMEOUT);

      const turn = await store.findTurnByIdempotency(sessionId, "idem-turn-fail-1");
      expect(turn?.status).toBe("FAILED");
      expect(typeof turn?.endedAt).toBe("string");

      const session = await store.findSessionById(sessionId);
      expect(session?.status).toBe("READY");
      expect(session?.activeTurnId).toBeUndefined();
    } finally {
      await service.shutdown();
    }
  });
});
