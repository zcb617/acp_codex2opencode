#!/usr/bin/env node

import { access, constants, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "local-desktop-app-uploads";
const PLUGIN_VERSION = "0.2.0";
const SKILL_NAMES = ["team-delegate", "ian-think"];
const GUIDE_FILES = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];
const IAN_THINK_SCENE_FILES = ["产品设计.md", "复制对标.md", "内容创作.md", "选择赛道.md", "营销成交.md", "skill.md"];

function quoteCmdArg(arg) {
  if (/[\s"&|<>^]/.test(arg)) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
}

function runSpawn(command, args, cwd, stdio) {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args].map(quoteCmdArg).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], { cwd, stdio });
  }
  return spawnSync(command, args, { cwd, stdio });
}

function run(command, args, cwd) {
  const result = runSpawn(command, args, cwd, "inherit");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令执行失败: ${command} ${args.join(" ")}`);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const skipNpmInstall = hasFlag("--skip-npm-install");
  const skipBuild = hasFlag("--skip-build");

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  const claudeRoot = path.join(os.homedir(), ".claude");
  const cacheDir = path.join(claudeRoot, "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME, PLUGIN_VERSION);
  const marketplaceDir = path.join(claudeRoot, "plugins", "marketplaces", MARKETPLACE_NAME);
  const marketplacePluginDir = path.join(marketplaceDir, PLUGIN_NAME);
  const marketplaceManifestDir = path.join(marketplaceDir, ".claude-plugin");
  const installedPluginsPath = path.join(claudeRoot, "plugins", "installed_plugins.json");
  const settingsPath = path.join(claudeRoot, "settings.json");
  const claudeSkillRoot = path.join(claudeRoot, "skills");
  const pluginRef = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  console.log("[A/8] 检查前置条件...");
  await access(path.join(projectRoot, ".claude-plugin", "plugin.json"), constants.F_OK);
  await access(path.join(projectRoot, ".claude-plugin", "marketplace.json"), constants.F_OK);
  await access(path.join(projectRoot, "mcp-servers.json"), constants.F_OK);
  await access(path.join(projectRoot, "package.json"), constants.F_OK);
  const sourceTeamDelegateSkillDir = path.join(projectRoot, "skills", "team-delegate");
  const sourceIanThinkSkillDir = path.join(projectRoot, "skills", "ian-think");
  await access(path.join(sourceTeamDelegateSkillDir, "SKILL.md"), constants.F_OK);
  for (const guideFile of GUIDE_FILES) {
    await access(path.join(sourceTeamDelegateSkillDir, "docs", guideFile), constants.F_OK);
  }
  await access(path.join(sourceIanThinkSkillDir, "SKILL.md"), constants.F_OK);
  for (const sceneFile of IAN_THINK_SCENE_FILES) {
    await access(path.join(sourceIanThinkSkillDir, "scenes", sceneFile), constants.F_OK);
  }

  console.log("[B/8] 构建插件...");
  if (!skipNpmInstall) {
    run("npm", ["install"], projectRoot);
  }
  if (!skipBuild) {
    run("npm", ["run", "prepare:plugin"], projectRoot);
  }

  console.log("[C/8] 安装插件到 Claude Code cache...");
  await rm(cacheDir, { recursive: true, force: true });
  const cacheParentDir = path.dirname(cacheDir);
  await mkdir(cacheParentDir, { recursive: true });
  await symlink(
    projectRoot,
    cacheDir,
    process.platform === "win32" ? "junction" : "dir"
  );

  console.log("[C.1/8] 注册 marketplace 到 marketplaces 目录...");
  await mkdir(marketplaceManifestDir, { recursive: true });
  await rm(marketplacePluginDir, { recursive: true, force: true });
  await symlink(
    projectRoot,
    marketplacePluginDir,
    process.platform === "win32" ? "junction" : "dir"
  );
  const marketplaceManifest = {
    name: MARKETPLACE_NAME,
    version: "1.0.0",
    description: "Locally uploaded plugins via Claude Desktop app",
    owner: { name: "Local User" },
    plugins: [
      {
        name: PLUGIN_NAME,
        version: PLUGIN_VERSION,
        source: `./${PLUGIN_NAME}`
      }
    ]
  };
  await writeFile(
    path.join(marketplaceManifestDir, "marketplace.json"),
    `${JSON.stringify(marketplaceManifest, null, 2)}\n`,
    "utf8"
  );

  console.log("[D/8] 注册插件到 installed_plugins.json...");
  let installed = { version: 2, plugins: {} };
  try {
    const raw = await readFile(installedPluginsPath, "utf8");
    installed = JSON.parse(raw);
  } catch {
    // fresh install
  }
  installed.plugins = installed.plugins || {};
  const now = new Date().toISOString();
  installed.plugins[pluginRef] = [
    {
      scope: "user",
      installPath: cacheDir,
      version: PLUGIN_VERSION,
      installedAt: now,
      lastUpdated: now
    }
  ];
  await writeFile(installedPluginsPath, `${JSON.stringify(installed, null, 2)}\n`, "utf8");

  console.log("[E/8] 启用插件到 settings.json...");
  let settings = {};
  try {
    const raw = await readFile(settingsPath, "utf8");
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins[pluginRef] = true;

  // 清理旧版安装可能残留的非法 extraKnownMarketplaces
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces[MARKETPLACE_NAME];
  }

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  console.log("[F/8] 安装 skills 到全局目录...");
  await mkdir(claudeSkillRoot, { recursive: true });
  for (const skillName of SKILL_NAMES) {
    await rm(path.join(claudeSkillRoot, skillName), { recursive: true, force: true });
  }
  await cp(sourceTeamDelegateSkillDir, path.join(claudeSkillRoot, "team-delegate"), { recursive: true });
  await cp(sourceIanThinkSkillDir, path.join(claudeSkillRoot, "ian-think"), { recursive: true });

  console.log("[G/8] 清理旧版 marketplace 残留...");
  const oldMarketplaceRoot = path.join(os.homedir(), ".claude-local", "acp-marketplace");
  await rm(oldMarketplaceRoot, { recursive: true, force: true });

  console.log("[H/8] 安装校验...");
  await access(path.join(cacheDir, "dist", "plugin", "mcp-server.js"), constants.F_OK);
  await access(path.join(cacheDir, ".claude-plugin", "plugin.json"), constants.F_OK);
  await access(path.join(cacheDir, ".claude-plugin", "marketplace.json"), constants.F_OK);
  await access(path.join(cacheDir, "mcp-servers.json"), constants.F_OK);
  await access(path.join(marketplaceManifestDir, "marketplace.json"), constants.F_OK);
  await access(path.join(marketplacePluginDir, ".claude-plugin", "plugin.json"), constants.F_OK);

  const finalInstalled = JSON.parse(await readFile(installedPluginsPath, "utf8"));
  if (!finalInstalled.plugins?.[pluginRef]) {
    throw new Error("Plugin not registered in installed_plugins.json");
  }
  const finalSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  if (!finalSettings.enabledPlugins?.[pluginRef]) {
    throw new Error("Plugin not enabled in settings.json");
  }

  console.log("[I/8] 完成。请重启 Claude Code。");
  console.log("CLAUDE-INSTALLATION-COMPLETED");
}

main().catch((error) => {
  console.error("CLAUDE-INSTALLATION-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
