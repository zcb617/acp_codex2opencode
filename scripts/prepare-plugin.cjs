const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const distEntry = path.join(root, "dist", "plugin", "mcp-server.js");
const manifest = path.join(root, ".codex-plugin", "plugin.json");
const mcpConfig = path.join(root, ".mcp.json");
const skillDir = path.join(root, "skills", "team-delegate");
const guideFiles = [
  "可交付开发设计文档编写指南-v0.1.md",
  "可交付开发计划编写指南-v0.1.md",
  "可交付BUG修改设计文档编写指南-v0.1.md",
  "可交付BUG修改计划编写指南-v0.1.md"
];

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

assertFile(distEntry);
assertFile(manifest);
assertFile(mcpConfig);
assertFile(path.join(skillDir, "SKILL.md"));
for (const guideFile of guideFiles) {
  assertFile(path.join(skillDir, "docs", guideFile));
}

console.log("plugin package preparation check passed");
