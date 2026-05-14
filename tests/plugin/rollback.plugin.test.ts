import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

describe("PT-06/PT-07 rollback contract", () => {
  it("should include rollback steps in runbook", async () => {
    const runbook = await readFile(
      join(root, "docs", "superpowers", "runbooks", "plugin-local-install.md"),
      "utf8"
    );

    expect(runbook).toContain("回滚步骤");
    expect(runbook).toContain("卸载当前插件版本");
    expect(runbook).toContain("安装上一稳定版本目录");
  });
});
