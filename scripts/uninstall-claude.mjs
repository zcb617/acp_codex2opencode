#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "acp-local";
const PLUGIN_VERSION = "0.1.1";
const SKILL_NAMES = ["team-delegate", "ian-think"];

async function main() {
  const claudeRoot = path.join(os.homedir(), ".claude");
  const cacheDir = path.join(claudeRoot, "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME, PLUGIN_VERSION);
  const installedPluginsPath = path.join(claudeRoot, "plugins", "installed_plugins.json");
  const settingsPath = path.join(claudeRoot, "settings.json");
  const claudeSkillRoot = path.join(claudeRoot, "skills");
  const pluginRef = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  console.log("[A/6] 从 settings.json 禁用插件...");
  await mkdir(path.dirname(settingsPath), { recursive: true });
  let settings = {};
  try {
    const raw = await readFile(settingsPath, "utf8");
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }

  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[pluginRef];
  }
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces[MARKETPLACE_NAME];
  }

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  console.log("[B/6] 从 installed_plugins.json 注销插件...");
  let installed = { version: 2, plugins: {} };
  try {
    const raw = await readFile(installedPluginsPath, "utf8");
    installed = JSON.parse(raw);
  } catch {
    // file may not exist
  }
  if (installed.plugins) {
    delete installed.plugins[pluginRef];
  }
  await writeFile(installedPluginsPath, `${JSON.stringify(installed, null, 2)}\n`, "utf8");

  console.log("[C/6] 清理插件 cache...");
  await rm(cacheDir, { recursive: true, force: true });

  console.log("[D/6] 清理旧版 marketplace 残留...");
  const oldMarketplaceRoot = path.join(os.homedir(), ".claude-local", "acp-marketplace");
  await rm(oldMarketplaceRoot, { recursive: true, force: true });

  console.log("[E/6] 清理全局 skills...");
  for (const skillName of SKILL_NAMES) {
    await rm(path.join(claudeSkillRoot, skillName), { recursive: true, force: true });
  }

  console.log("[F/6] 完成。请重启 Claude Code。");
  console.log("CLAUDE-UNINSTALL-COMPLETED");
}

main().catch((error) => {
  console.error("CLAUDE-UNINSTALL-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
