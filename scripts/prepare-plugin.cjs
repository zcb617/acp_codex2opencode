const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const distEntry = path.join(root, "dist", "plugin", "mcp-server.js");
const manifest = path.join(root, ".codex-plugin", "plugin.json");
const mcpConfig = path.join(root, ".mcp.json");

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

assertFile(distEntry);
assertFile(manifest);
assertFile(mcpConfig);

console.log("plugin package preparation check passed");
