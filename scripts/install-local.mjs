#!/usr/bin/env node

import { access, constants, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "acp-local";
const MARKETPLACE_DISPLAY_NAME = "ACP Local Plugins";
const LEGACY_MCP_SERVER_ID = "acp_codex2opencode_plugin";
const LEGACY_GLOBAL_SKILL_NAMES = ["team-delegate", "ian-think"];
const GUIDE_FILES = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];
const IAN_THINK_SCENE_FILES = ["产品设计.md", "内容创作.md", "复制对标.md", "选择赛道.md", "营销成交.md", "skill.md"];

function quoteCmdArg(arg) {
  if (/[\s"&|<>^]/.test(arg)) {
    return '"' + arg.replace(/"/g, '""') + '"';
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
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("命令执行失败: " + command + " " + args.join(" "));
  }
}

function runIgnoreError(command, args, cwd) {
  runSpawn(command, args, cwd, "ignore");
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeLegacyGlobalSkillCopies(projectRoot) {
  const legacySkillRoot = path.join(os.homedir(), ".codex", "skills");
  const removedSkillNames = [];

  for (const skillName of LEGACY_GLOBAL_SKILL_NAMES) {
    const sourceSkillFile = path.join(projectRoot, "skills", skillName, "SKILL.md");
    const legacySkillDir = path.join(legacySkillRoot, skillName);
    const legacySkillFile = path.join(legacySkillDir, "SKILL.md");
    const [sourceContents, legacyContents] = await Promise.all([
      readFile(sourceSkillFile, "utf8"),
      readOptionalFile(legacySkillFile)
    ]);

    if (legacyContents === null) {
      continue;
    }
    if (legacyContents !== sourceContents) {
      throw new Error(
        "检测到同名全局技能 " + skillName +
          "，其内容不是本插件可确认的旧版副本。为保护用户自定义内容，安装器不会删除它；" +
          "请先备份或改名 ~/.codex/skills/" + skillName + "，然后重新安装。"
      );
    }

    await rm(legacySkillDir, { recursive: true, force: false });
    removedSkillNames.push(skillName);
  }

  return removedSkillNames;
}

async function main() {
  const skipNpmInstall = hasFlag("--skip-npm-install");
  const skipBuild = hasFlag("--skip-build");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  const marketplaceRoot = path.join(os.homedir(), ".codex-local", "acp-marketplace");
  const marketplacePluginsDir = path.join(marketplaceRoot, "plugins");
  const marketplaceManifestDir = path.join(marketplaceRoot, ".agents", "plugins");
  const marketplaceManifestPath = path.join(marketplaceManifestDir, "marketplace.json");
  const linkedPluginDir = path.join(marketplacePluginsDir, PLUGIN_NAME);
  const sourceTeamDelegateSkillDir = path.join(projectRoot, "skills", "team-delegate");
  const sourceIanThinkSkillDir = path.join(projectRoot, "skills", "ian-think");
  const pluginRef = PLUGIN_NAME + "@" + MARKETPLACE_NAME;

  console.log("[A/8] 检查前置条件...");
  await access(path.join(projectRoot, ".codex-plugin", "plugin.json"), constants.F_OK);
  await access(path.join(projectRoot, ".mcp.json"), constants.F_OK);
  await access(path.join(projectRoot, "package.json"), constants.F_OK);
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

  console.log("[C/8] 清理旧版 Codex 安装残留...");
  runIgnoreError("codex", ["plugin", "remove", pluginRef], projectRoot);
  runIgnoreError("codex", ["mcp", "remove", LEGACY_MCP_SERVER_ID], projectRoot);
  runIgnoreError("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME], projectRoot);
  await rm(marketplaceRoot, { recursive: true, force: true });

  console.log("[D/8] 生成本地 Marketplace...");
  await mkdir(marketplacePluginsDir, { recursive: true });
  await mkdir(marketplaceManifestDir, { recursive: true });
  await symlink(projectRoot, linkedPluginDir, process.platform === "win32" ? "junction" : "dir");
  const manifest = {
    name: MARKETPLACE_NAME,
    interface: { displayName: MARKETPLACE_DISPLAY_NAME },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "local", path: "./plugins/" + PLUGIN_NAME },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Coding"
      }
    ]
  };
  await writeFile(marketplaceManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("[E/8] 注册 Marketplace...");
  run("codex", ["plugin", "marketplace", "add", marketplaceRoot], projectRoot);

  console.log("[F/8] 安装并启用插件...");
  run("codex", ["plugin", "add", pluginRef], projectRoot);

  console.log("[G/8] 迁移已确认的旧版全局技能副本...");
  const removedSkillNames = await removeLegacyGlobalSkillCopies(projectRoot);
  if (removedSkillNames.length > 0) {
    console.log("已移除旧版全局技能副本: " + removedSkillNames.join(", "));
  }

  console.log("[H/8] 安装校验...");
  await access(path.join(projectRoot, "dist", "plugin", "mcp-server.js"), constants.F_OK);
  await access(marketplaceManifestPath, constants.F_OK);
  run("codex", ["plugin", "list"], projectRoot);

  console.log("INSTALLATION-COMPLETED");
}

main().catch((error) => {
  console.error("INSTALLATION-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
