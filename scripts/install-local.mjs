#!/usr/bin/env node

import { access, constants, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_NAME = "acp-codex2opencode";
const MARKETPLACE_NAME = "acp-local";
const MARKETPLACE_DISPLAY_NAME = "ACP Local Plugins";
const SKILL_NAMES = ["team-delegate", "ian-think"];
const MCP_SERVER_ID = "acp_codex2opencode_plugin";
const DEFAULT_WORKFLOW_MODEL = "llm-router-openai-compatible/kimi-for-roo";
const GUIDE_FILES = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];
const IAN_THINK_SCENE_FILES = ["产品设计.md", "复制对标.md", "内容创作.md", "选择赛道.md", "营销成交.md", "skill.md"];
const DEFAULT_OPENCODE_CONFIG_CONTENT = JSON.stringify({
  permission: "allow",
  model: DEFAULT_WORKFLOW_MODEL
});

function quoteCmdArg(arg) {
  if (/[\s"&|<>^]/.test(arg)) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
}

function runSpawn(command, args, cwd, stdio) {
  if (process.platform === "win32") {
    const cmdLine = [command, ...args].map(quoteCmdArg).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd,
      stdio
    });
  }
  return spawnSync(command, args, {
    cwd,
    stdio
  });
}

function run(command, args, cwd) {
  const result = runSpawn(command, args, cwd, "inherit");
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(" ")}`);
  }
}

function runIgnoreError(command, args, cwd) {
  runSpawn(command, args, cwd, "ignore");
}

function runCapture(command, args, cwd) {
  const result = runSpawn(command, args, cwd, "pipe");
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString("utf8").trim() : "";
    throw new Error(
      `命令执行失败: ${command} ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`
    );
  }
  return {
    stdout: result.stdout ? result.stdout.toString("utf8") : "",
    stderr: result.stderr ? result.stderr.toString("utf8") : ""
  };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFlag(flag) {
  return process.argv.includes(flag);
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

function upsertEnabledSection(content, pluginRef, enabled) {
  const { lines, eol } = parseConfig(content);
  const header = sectionHeader(pluginRef);
  const { start, end } = findSection(lines, header);
  const enabledLine = `enabled = ${enabled ? "true" : "false"}`;

  if (start < 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(header, enabledLine);
  } else {
    let enabledIdx = -1;
    for (let idx = start + 1; idx < end; idx += 1) {
      if (/^\s*enabled\s*=/.test(lines[idx])) {
        enabledIdx = idx;
        break;
      }
    }
    if (enabledIdx >= 0) {
      lines[enabledIdx] = enabledLine;
    } else {
      lines.splice(end, 0, enabledLine);
    }
  }

  return lines.join("\n").replace(/\n/g, eol);
}

function upsertSection(lines, header, bodyLines) {
  const { start, end } = findSection(lines, header);
  if (start >= 0) {
    lines.splice(start, end - start);
  }
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push(header, ...bodyLines);
}

function toTomlPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function upsertMcpServerSection(content, options) {
  const { lines, eol } = parseConfig(content);
  const header = `[mcp_servers.${MCP_SERVER_ID}]`;
  const escapedConfigContent = escapeTomlString(options.opencodeConfigContent);
  const envInline =
    `env = { OPENCODE_BIN_PATH = "opencode", ACP_BRIDGE_STATE_DIR = "${options.stateDir}", ` +
    `ACP_BRIDGE_LOG_DIR = "${options.logDir}", ACP_BRIDGE_LOG_LEVEL = "INFO", ` +
    `ACP_BRIDGE_TURN_TIMEOUT_MS = "86400000", ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS = "180000", ACP_BRIDGE_ALLOWED_WORKSPACES = "", ` +
    `OPENCODE_CONFIG_CONTENT = "${escapedConfigContent}" }`;
  upsertSection(lines, header, [
    'command = "node"',
    `args = ["${options.serverEntry}"]`,
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 360",
    envInline
  ]);
  return lines.join("\n").replace(/\n/g, eol);
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
  const pluginCacheRoot = path.join(
    os.homedir(),
    ".codex",
    "plugins",
    "cache",
    MARKETPLACE_NAME,
    PLUGIN_NAME
  );
  const linkedPluginDir = path.join(marketplacePluginsDir, PLUGIN_NAME);
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  const codexSkillRoot = path.join(os.homedir(), ".codex", "skills");
  const sourceTeamDelegateSkillDir = path.join(projectRoot, "skills", "team-delegate");
  const sourceIanThinkSkillDir = path.join(projectRoot, "skills", "ian-think");
  const targetTeamDelegateSkillDir = path.join(codexSkillRoot, "team-delegate");
  const targetIanThinkSkillDir = path.join(codexSkillRoot, "ian-think");
  const mcpServerEntry = toTomlPath(path.join(projectRoot, "dist", "plugin", "mcp-server.js"));
  const bridgeStateDir = toTomlPath(path.join(os.homedir(), ".codex-local", "acp-bridge-runtime"));
  const bridgeLogDir = toTomlPath(path.join(bridgeStateDir, "logs"));
  const pluginRef = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  console.log("[A/10] 检查前置条件...");
  await access(path.join(projectRoot, ".codex-plugin", "plugin.json"), constants.F_OK);
  await access(path.join(projectRoot, "package.json"), constants.F_OK);
  await access(path.join(sourceTeamDelegateSkillDir, "SKILL.md"), constants.F_OK);
  for (const guideFile of GUIDE_FILES) {
    await access(path.join(sourceTeamDelegateSkillDir, "docs", guideFile), constants.F_OK);
  }
  await access(path.join(sourceIanThinkSkillDir, "SKILL.md"), constants.F_OK);
  for (const sceneFile of IAN_THINK_SCENE_FILES) {
    await access(path.join(sourceIanThinkSkillDir, "scenes", sceneFile), constants.F_OK);
  }

  console.log("[B/10] 构建插件...");
  if (!skipNpmInstall) {
    run("npm", ["install"], projectRoot);
  }
  if (!skipBuild) {
    run("npm", ["run", "prepare:plugin"], projectRoot);
  }

  console.log("[C/10] 清理当前插件旧安装状态...");
  runIgnoreError("codex", ["plugin", "remove", pluginRef], projectRoot);
  await rm(pluginCacheRoot, { recursive: true, force: true });

  console.log("[D/10] 生成本地 marketplace...");
  await rm(marketplaceRoot, { recursive: true, force: true });
  await mkdir(marketplacePluginsDir, { recursive: true });
  await mkdir(marketplaceManifestDir, { recursive: true });
  await symlink(
    projectRoot,
    linkedPluginDir,
    process.platform === "win32" ? "junction" : "dir"
  );

  const manifest = {
    name: MARKETPLACE_NAME,
    interface: { displayName: MARKETPLACE_DISPLAY_NAME },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Coding"
      }
    ]
  };
  await writeFile(marketplaceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("[E/10] 注册 marketplace...");
  runIgnoreError("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME], projectRoot);
  run("codex", ["plugin", "marketplace", "add", marketplaceRoot], projectRoot);

  console.log("[F/10] 安装插件到 Codex...");
  run("codex", ["plugin", "add", pluginRef], projectRoot);

  console.log("[G/10] 启用插件...");
  await mkdir(path.dirname(codexConfigPath), { recursive: true });
  let currentConfig = "";
  try {
    currentConfig = await readFile(codexConfigPath, "utf8");
  } catch {
    currentConfig = "";
  }
  const pluginEnabledConfig = upsertEnabledSection(currentConfig, pluginRef, true);
  const mcpUpdatedConfig = upsertMcpServerSection(pluginEnabledConfig, {
    serverEntry: mcpServerEntry,
    stateDir: bridgeStateDir,
    logDir: bridgeLogDir,
    opencodeConfigContent: DEFAULT_OPENCODE_CONFIG_CONTENT
  });
  await writeFile(codexConfigPath, mcpUpdatedConfig, "utf8");

  console.log("[H/10] 安装 team-delegate 与 ian-think 技能到全局目录...");
  await mkdir(codexSkillRoot, { recursive: true });
  for (const skillName of SKILL_NAMES) {
    await rm(path.join(codexSkillRoot, skillName), { recursive: true, force: true });
  }
  await cp(sourceTeamDelegateSkillDir, targetTeamDelegateSkillDir, { recursive: true });
  await cp(sourceIanThinkSkillDir, targetIanThinkSkillDir, { recursive: true });

  console.log("[I/10] 安装校验...");
  await access(path.join(projectRoot, "dist", "plugin", "mcp-server.js"), constants.F_OK);
  await access(marketplaceManifestPath, constants.F_OK);
  await access(path.join(targetTeamDelegateSkillDir, "SKILL.md"), constants.F_OK);
  for (const guideFile of GUIDE_FILES) {
    await access(path.join(targetTeamDelegateSkillDir, "docs", guideFile), constants.F_OK);
  }
  await access(path.join(targetIanThinkSkillDir, "SKILL.md"), constants.F_OK);
  for (const sceneFile of IAN_THINK_SCENE_FILES) {
    await access(path.join(targetIanThinkSkillDir, "scenes", sceneFile), constants.F_OK);
  }
  const pluginListOutput = runCapture("codex", ["plugin", "list"], projectRoot).stdout;
  const installedEnabledPattern = new RegExp(
    `${escapeRegex(pluginRef)}\\s+installed,\\s+enabled\\b`,
    "u"
  );
  if (!installedEnabledPattern.test(pluginListOutput)) {
    throw new Error(
      `插件安装校验失败: 期望 ${pluginRef} 为 installed, enabled，但实际列表为:\n${pluginListOutput.trim()}`
    );
  }

  console.log("[J/10] 完成。请重启 Codex，然后在插件列表确认已启用。");
  console.log("INSTALLATION-COMPLETED");
}

main().catch((error) => {
  console.error("INSTALLATION-FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
