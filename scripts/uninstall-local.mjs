#!/usr/bin/env node

import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "acp-local";
const LEGACY_MCP_SERVER_ID = "acp_codex2opencode_plugin";

function quoteCmdArg(arg) {
  if (/[\s"&|<>^]/.test(arg)) {
    return '"' + arg.replace(/"/g, '""') + '"';
  }
  return arg;
}

function runIgnoreError(command, args, cwd) {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args].map(quoteCmdArg).join(" ");
    spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], { cwd, stdio: "ignore" });
    return;
  }
  spawnSync(command, args, { cwd, stdio: "ignore" });
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  const marketplaceRoot = path.join(os.homedir(), ".codex-local", "acp-marketplace");
  const pluginRef = PLUGIN_NAME + "@" + MARKETPLACE_NAME;

  console.log("[A/4] 卸载 Codex 插件...");
  runIgnoreError("codex", ["plugin", "remove", pluginRef], projectRoot);

  console.log("[B/4] 清理旧版全局 MCP 残留...");
  runIgnoreError("codex", ["mcp", "remove", LEGACY_MCP_SERVER_ID], projectRoot);

  console.log("[C/4] 移除本地 Marketplace 注册...");
  runIgnoreError("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME], projectRoot);

  console.log("[D/4] 清理本安装器创建的 Marketplace 目录...");
  await rm(marketplaceRoot, { recursive: true, force: true });

  console.log("UNINSTALL-COMPLETED");
}

main().catch((error) => {
  console.error("UNINSTALL-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
