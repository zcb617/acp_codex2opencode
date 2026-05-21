#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "acp-local";
const SKILL_NAMES = ["team-delegate", "ian-think"];
const MCP_SERVER_ID = "acp_codex2opencode_plugin";

function runIgnoreError(command, args, cwd) {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args]
      .map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg))
      .join(" ");
    spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd,
      stdio: "ignore"
    });
    return;
  }
  spawnSync(command, args, {
    cwd,
    stdio: "ignore"
  });
}

function sectionHeader(pluginRef) {
  return `[plugins."${pluginRef}"]`;
}

function parseConfig(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return { lines: normalized.split("\n"), eol };
}

function findSection(lines, header) {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return { start: -1, end: -1 };
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[.*\]\s*$/.test(lines[end])) {
    end += 1;
  }
  return { start, end };
}

function removeSectionByHeader(content, header) {
  const { lines, eol } = parseConfig(content);
  const { start, end } = findSection(lines, header);
  if (start < 0) {
    return content;
  }

  lines.splice(start, end - start);
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return `${lines.join("\n").replace(/\n/g, eol)}${eol}`;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  const marketplaceRoot = path.join(os.homedir(), ".codex-local", "acp-marketplace");
  const pluginCacheRoot = path.join(
    os.homedir(),
    ".codex",
    "plugins",
    "cache",
    MARKETPLACE_NAME,
    PLUGIN_NAME
  );
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  const codexSkillRoot = path.join(os.homedir(), ".codex", "skills");
  const pluginRef = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  console.log("[A/5] 禁用并移除 marketplace 注册...");
  runIgnoreError("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME], projectRoot);

  console.log("[B/5] 清理本地 marketplace 目录...");
  await rm(marketplaceRoot, { recursive: true, force: true });

  console.log("[C/5] 清理 Codex 配置中的插件启用节...");
  await mkdir(path.dirname(codexConfigPath), { recursive: true });
  let currentConfig = "";
  try {
    currentConfig = await readFile(codexConfigPath, "utf8");
  } catch {
    currentConfig = "";
  }
  if (currentConfig.length > 0) {
    const pluginHeader = sectionHeader(pluginRef);
    const mcpHeader = `[mcp_servers.${MCP_SERVER_ID}]`;
    const withoutPlugin = removeSectionByHeader(currentConfig, pluginHeader);
    const updatedConfig = removeSectionByHeader(withoutPlugin, mcpHeader);
    await writeFile(codexConfigPath, updatedConfig, "utf8");
  }

  console.log("[D/5] 清理当前插件 cache 与全局技能...");
  await rm(pluginCacheRoot, { recursive: true, force: true });
  for (const skillName of SKILL_NAMES) {
    await rm(path.join(codexSkillRoot, skillName), { recursive: true, force: true });
  }

  console.log("[E/5] 完成。请重启 Codex。");
  console.log("UNINSTALL-COMPLETED");
}

main().catch((error) => {
  console.error("UNINSTALL-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
