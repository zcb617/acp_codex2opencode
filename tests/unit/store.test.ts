import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/store/sqlite.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop()!;
    await rm(path, { recursive: true, force: true });
  }
});

describe("sqlite store", () => {
  it("should persist session and turn records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acp-store-"));
    tempDirs.push(dir);
    const store = new SqliteStore(join(dir, "state.db"));
    await store.init();

    try {
      await store.saveSession({
        bridgeSessionId: "bs_1",
        sessionAlias: "alias-1",
        workspacePath: "D:/repo",
        acpSessionId: "ses_1",
        configOptions: [],
        status: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const session = await store.findSessionByAlias("D:/repo", "alias-1");
      expect(session?.bridgeSessionId).toBe("bs_1");

      await store.saveTurn({
        turnId: "turn_1",
        bridgeSessionId: "bs_1",
        turnSeq: 1,
        turnType: "run",
        idempotencyKey: "idem-1",
        promptSha256: "hash",
        promptText: "test",
        status: "COMPLETED"
      });

      const turn = await store.findTurnByIdempotency("bs_1", "idem-1");
      expect(turn?.turnId).toBe("turn_1");
    } finally {
      await store.close();
    }
  });

  it("should initialize store when process cwd is outside plugin root", async () => {
    const dbDir = await mkdtemp(join(tmpdir(), "acp-store-cwd-db-"));
    const cwdDir = await mkdtemp(join(tmpdir(), "acp-store-cwd-run-"));
    tempDirs.push(dbDir, cwdDir);
    const oldCwd = process.cwd();

    const store = new SqliteStore(join(dbDir, "state.db"));
    try {
      process.chdir(cwdDir);
      await store.init();
      await store.saveSession({
        bridgeSessionId: "bs_cwd_1",
        sessionAlias: "alias-cwd-1",
        workspacePath: "D:/repo",
        acpSessionId: "ses_cwd_1",
        configOptions: [],
        status: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const session = await store.findSessionByAlias("D:/repo", "alias-cwd-1");
      expect(session?.bridgeSessionId).toBe("bs_cwd_1");
    } finally {
      process.chdir(oldCwd);
      await store.close();
    }
  });
});
