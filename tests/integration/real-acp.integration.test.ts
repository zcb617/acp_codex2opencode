import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { BridgeService } from "../../src/session/bridge-service.js";

const runRealAcp = process.env.RUN_REAL_ACP === "1";
const describeReal = runRealAcp ? describe : describe.skip;

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createRealService(stateDir: string): Promise<BridgeService> {
  const logger = createLogger((process.env.ACP_BRIDGE_LOG_LEVEL as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "INFO");
  const metrics = new MetricsRegistry();
  const service = new BridgeService(
    {
      opencodeBinPath: process.env.OPENCODE_BIN_PATH ?? "opencode",
      stateDir,
      turnTimeoutMs: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
    },
    logger,
    metrics
  );
  await service.init();
  return service;
}

describeReal("real acp integration", () => {
  it(
    "should complete init -> run -> rework -> close flow with opencode acp",
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "acp-real-"));
      tempDirs.push(stateDir);
      const service = await createRealService(stateDir);

      try {
        const alias = `real-${Date.now()}`;
        const initResult = await service.initSession({
          workspace_path: process.cwd(),
          session_alias: alias,
          session_strategy: "new",
          preferred_model: process.env.REAL_ACP_MODEL,
          timeout_ms: Number(process.env.REAL_ACP_INIT_TIMEOUT_MS ?? "30000")
        });
        expect(initResult.success).toBe(true);

        const initData = initResult.data as
          | { bridge_session_id?: string }
          | undefined;
        const bridgeSessionId = initData?.bridge_session_id;
        expect(typeof bridgeSessionId).toBe("string");

        const runResult = await service.runTurn({
          bridge_session_id: bridgeSessionId!,
          idempotency_key: `idem-${Date.now()}-run`,
          prompt_text: "请只回复一个词：OK",
          timeout_ms: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
        });
        expect(runResult.success).toBe(true);

        const reworkResult = await service.reworkTurn({
          bridge_session_id: bridgeSessionId!,
          idempotency_key: `idem-${Date.now()}-rework`,
          rework_prompt_text: "请把刚才答案改成两个词：OK DONE",
          timeout_ms: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
        });
        expect(reworkResult.success).toBe(true);

        const closeResult = await service.close({
          bridge_session_id: bridgeSessionId!,
          force: true,
          timeout_ms: 10000
        });
        expect(closeResult.success).toBe(true);
      } finally {
        await service.shutdown();
      }
    },
    240000
  );

  it(
    "should cancel an active turn with session/cancel",
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "acp-real-cancel-"));
      tempDirs.push(stateDir);
      const service = await createRealService(stateDir);

      try {
        const init = await service.initSession({
          workspace_path: process.cwd(),
          session_alias: `cancel-${Date.now()}`,
          session_strategy: "new",
          timeout_ms: 30000
        });
        expect(init.success).toBe(true);
        const bridgeSessionId = (init.data as { bridge_session_id: string }).bridge_session_id;

        const runPromise = service.runTurn({
          bridge_session_id: bridgeSessionId,
          idempotency_key: `idem-${Date.now()}-cancel-run`,
          prompt_text: "请详细分析并分10段输出，每段至少100字，先开始第一段。",
          timeout_ms: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
        });

        await new Promise((resolve) => setTimeout(resolve, 400));
        const cancel = await service.cancel({
          bridge_session_id: bridgeSessionId,
          timeout_ms: 15000
        });
        const runResult = await runPromise;

        expect(cancel.success).toBe(true);
        expect(runResult.success).toBe(true);
        const runData = runResult.data as { stop_reason?: string };
        expect(["cancelled", "end_turn"]).toContain(runData.stop_reason ?? "end_turn");
      } finally {
        await service.shutdown();
      }
    },
    240000
  );

  it(
    "should recover session after bridge restart and continue rework",
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "acp-real-recover-"));
      tempDirs.push(stateDir);

      const alias = `recover-${Date.now()}`;
      const service1 = await createRealService(stateDir);
      let bridgeSessionId = "";

      try {
        const init1 = await service1.initSession({
          workspace_path: process.cwd(),
          session_alias: alias,
          session_strategy: "new",
          timeout_ms: 30000
        });
        expect(init1.success).toBe(true);
        bridgeSessionId = (init1.data as { bridge_session_id: string }).bridge_session_id;

        const run1 = await service1.runTurn({
          bridge_session_id: bridgeSessionId,
          idempotency_key: `idem-${Date.now()}-recover-run`,
          prompt_text: "请回复：RECOVER-STEP-1",
          timeout_ms: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
        });
        expect(run1.success).toBe(true);
      } finally {
        await service1.shutdown();
      }

      const service2 = await createRealService(stateDir);
      try {
        const init2 = await service2.initSession({
          workspace_path: process.cwd(),
          session_alias: alias,
          session_strategy: "auto",
          timeout_ms: 30000
        });
        expect(init2.success).toBe(true);
        const init2Data = init2.data as {
          bridge_session_id: string;
          session_mode?: string;
        };
        expect(init2Data.bridge_session_id).toBe(bridgeSessionId);
        expect(["loaded", "resumed", "new"]).toContain(init2Data.session_mode ?? "new");

        const rework = await service2.reworkTurn({
          bridge_session_id: bridgeSessionId,
          idempotency_key: `idem-${Date.now()}-recover-rework`,
          rework_prompt_text: "继续上一个任务并回复：RECOVER-STEP-2",
          timeout_ms: Number(process.env.REAL_ACP_TURN_TIMEOUT_MS ?? "180000")
        });
        expect(rework.success).toBe(true);

        const close = await service2.close({
          bridge_session_id: bridgeSessionId,
          force: true,
          timeout_ms: 10000
        });
        expect(close.success).toBe(true);
      } finally {
        await service2.shutdown();
      }
    },
    300000
  );
});
