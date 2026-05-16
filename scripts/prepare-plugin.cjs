const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const distEntry = path.join(root, "dist", "plugin", "mcp-server.js");
const manifest = path.join(root, ".codex-plugin", "plugin.json");
const mcpConfig = path.join(root, ".mcp.json");
const teamDelegateSkillDir = path.join(root, "skills", "team-delegate");
const ianThinkSkillDir = path.join(root, "skills", "ian-think");
const guideFiles = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];
const ianThinkSceneFiles = [
  "产品设计.md",
  "复制对标.md",
  "内容创作.md",
  "选择赛道.md",
  "营销成交.md",
  "skill.md"
];

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

assertFile(distEntry);
assertFile(manifest);
assertFile(mcpConfig);
assertFile(path.join(teamDelegateSkillDir, "SKILL.md"));
for (const guideFile of guideFiles) {
  assertFile(path.join(teamDelegateSkillDir, "docs", guideFile));
}
assertFile(path.join(ianThinkSkillDir, "SKILL.md"));
for (const sceneFile of ianThinkSceneFiles) {
  assertFile(path.join(ianThinkSkillDir, "scenes", sceneFile));
}

console.log("plugin package preparation check passed");
