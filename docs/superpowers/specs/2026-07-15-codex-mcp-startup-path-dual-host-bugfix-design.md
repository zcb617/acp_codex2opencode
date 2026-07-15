# Codex 插件 MCP 启动路径与双宿主安装修复设计

## 1. 问题摘要

本项目同时面向 Codex 与 Claude Code。当前用户通过本项目的本地安装入口安装 Codex 插件后，打开真实 Codex CLI 会出现 MCP 启动失败，团队委派能力无法作为一个可用的业务能力进入会话。

本次修复目标是让 Codex 只通过插件清单中声明的 MCP 服务启动委派能力，并确保服务从插件安装缓存目录正确找到运行入口；同时迁移由旧版安装器复制到全局目录、会遮蔽插件缓存的同名技能副本。Claude Code 的清单、MCP 配置和安装链路必须保持不变。

修复完成后，用户在真实 Codex CLI 中安装并启用插件、重启或新建任务后，可以用自然语言发起团队委派流程，不再出现 MCP 启动失败或同一服务被重复登记。

## 2. 失败事实

- 触发入口：在项目根目录执行 `npm run plugin:install-local`，随后从非插件目录打开真实 Codex CLI。
- 用户业务语言：`帮我用团队委派流程完成这个开发任务。`
- 实际表现：Codex CLI 输出 `MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`，会话中没有可用的委派 MCP 工具。
- 预期表现：Codex 从已安装插件的缓存目录启动一个委派 MCP 服务，完成初始化并向新任务提供团队委派能力。
- 复现频率：在当前本机安装状态下可复现。
- 证据：
  - `codex mcp list` 同时列出 `acp-codex2opencode` 与 `acp_codex2opencode_plugin` 两个服务；前者的命令参数是相对路径 `./dist/plugin/mcp-server.js` 且 `cwd` 显示为 `-`。
  - 在 `C:\Users\zhang\.codex` 目录按该相对路径启动 Node，报出 `MODULE_NOT_FOUND`，目标文件被解析成 `C:\Users\zhang\.codex\dist\plugin\mcp-server.js`。
  - 当前已安装缓存中的 [`.mcp.json`](../../../.mcp.json) 同样缺少 `cwd`。
  - 以已安装缓存为工作目录对同一个 MCP 服务执行标准握手，结果为 `MCP_HANDSHAKE_OK`，并返回服务名 `acp-codex2opencode`。
- 参考插件 `D:\work\simple-blog\plugins\blog-publisher` 在相对入口参数旁显式使用 `"cwd": "."`，其 `codex mcp get` 显示工作目录已解析到插件缓存根目录。
- 修复后在可丢弃 worktree 的真实 Codex CLI 自然语言入口中，Codex 读取了 `C:\Users\zhang\.codex\skills\team-delegate\SKILL.md`，而不是插件缓存中的同名技能。该文件与仓库 `skills/team-delegate/SKILL.md` 的 SHA-256 完全相同；结合旧安装器曾显式复制该目录的实现，可确认它是旧版安装遗留副本。

## 3. 影响范围

### 受影响范围

- Codex 插件安装后的 MCP 启动与工具发现。
- 用户从 Codex CLI 或桌面应用新任务进入团队委派流程的第一步。
- 本地安装脚本生成的 Codex 配置与缓存状态。
- 同名技能的加载优先级：遗留全局副本会遮蔽已安装插件缓存中的新版技能。

### 不受影响范围

- Claude Code 的 `.claude-plugin/plugin.json`、`mcp-servers.json`、`install-claude.mjs` 与 `uninstall-claude.mjs`。
- 委派 MCP 服务的业务工具定义、ACP 协议实现和工作流状态机。
- 已有 OpenCode 配置、模型选择和业务流程规则。

### 不修复的交付风险

- 用户会在安装成功提示后仍然看到 MCP 启动错误，无法使用核心业务能力。
- 同一个委派服务被重复登记，工具来源和运行状态不确定，后续排障会继续混淆。

## 4. 根因分析

### 4.1 直接原因

Codex 插件的 [`.mcp.json`](../../../.mcp.json) 使用相对入口 `./dist/plugin/mcp-server.js`，但没有设置 `"cwd": "."`。Codex 因而没有插件根目录这一启动上下文；从用户工作目录启动时，相对路径会落到错误位置，进程在 MCP 初始化前退出。

### 4.2 深层原因

本地安装脚本把插件内置 MCP 当作不可靠的“兜底”，又手工写入全局 `[mcp_servers.acp_codex2opencode_plugin]`。这使同一个业务服务同时存在于：

1. 插件清单声明的 `acp-codex2opencode`。
2. 用户全局配置手工写入的 `acp_codex2opencode_plugin`。

这不是 Codex 插件的正常生命周期。插件已经通过 `mcpServers` 字段声明服务，安装器应使用 Marketplace 与 `codex plugin add` 安装、启用和卸载插件，而不是再创建第二个全局服务。

同一旧安装器还会把 `team-delegate` 与 `ian-think` 复制到 `~/.codex/skills/`。Codex 在真实 CLI 中优先读取了前者的全局副本，因此即使新的插件缓存已安装，用户仍可能使用到旧副本而不是本次发布的插件资源。这是目录与安装生命周期残留，不是 Claude Code 或共享 MCP 运行核心的问题。

### 4.3 为什么共享运行核心本身不是根因

以缓存目录作为工作目录启动 `dist/plugin/mcp-server.js`，标准 MCP 客户端握手成功。因此共享 TypeScript 运行核心、MCP SDK、SQLite 初始化和工具注册在正确路径上下文中可以正常工作。本次不需要改动 Claude Code 使用的共同运行代码。

### 4.4 为什么现有测试没有发现

现有 `tests/plugin/install.plugin.test.ts` 只验证 `.mcp.json` 中存在 `command`、相对 `args` 与环境变量，没有断言 `cwd`。安装脚本测试只检查文档与文本片段，也没有从已安装缓存或非插件工作目录进行 MCP 启动/握手验证。因此该套测试可全部通过，却不能证明真实 Codex 安装链路可用。

### 4.5 证据链

1. 真实 Codex CLI 报 MCP 启动失败。
2. Codex 展示的内置服务没有工作目录。
3. 同一相对启动命令在非插件目录稳定报模块找不到。
4. 正常参考插件的同类配置显式设置插件根目录。
5. 将共享服务放入正确缓存工作目录后，标准握手成功。
6. 当前安装器额外写入的全局服务造成重复登记，但不是修复相对路径的正确方式。

## 5. 修复目标与非目标

### 5.1 修复目标

- Codex 插件内置 MCP 服务显式以插件根目录为工作目录启动。
- 本地安装后只保留一个由插件清单管理的 Codex MCP 服务。
- 安装与卸载使用 Codex 的插件命令管理插件生命周期，并清理旧版全局 MCP 登记。
- 仅迁移可被确认是旧安装器原样复制的全局同名技能，避免它们遮蔽插件缓存；不删除内容不同的用户自定义技能。
- 新增回归测试，在缺少工作目录或保留手工全局注册时失败。
- Claude Code 的配置、安装脚本、清单和共享 MCP 运行核心保持兼容且不被改写。

### 5.2 非目标

- 不改变委派业务流程、ACP 协议、模型选择或 OpenCode 配置。
- 不重写 Claude Code 的安装方式。
- 不以目录大迁移替代本次根因修复；当前根目录已经具备 Codex 要求的 `.codex-plugin/plugin.json`、`skills/` 与 `.mcp.json`，问题在启动和安装生命周期。
- 不编造或替换插件发布者、网站、隐私政策等元数据。

## 6. 修复设计

### 6.1 Codex MCP 启动路径

在 `.mcp.json` 的 `acp-codex2opencode` 服务中增加：

```json
"cwd": "."
```

这样 `./dist/plugin/mcp-server.js` 与 `./runtime` 都会相对插件安装缓存根目录解析。该配置与已验证的参考插件一致。

### 6.2 Codex 安装生命周期

调整 `scripts/install-local.mjs`：

1. 构建当前插件。
2. 通过 Codex CLI 移除旧版同名插件安装和旧版全局 MCP 登记（忽略不存在的情况）。
3. 创建并注册本地 Marketplace。
4. 使用 `codex plugin add acp-codex2opencode@acp-local` 安装插件。
5. 在插件安装成功后，检查 `~/.codex/skills/` 中的旧同名技能：仅当其 `SKILL.md` 与本项目对应资源完全一致时才删除该整目录；内容不同则中止并提示用户先处理自定义同名技能，绝不静默删除。
6. 验证插件已由 Codex 管理，而不再直接编辑 `~/.codex/config.toml` 写入第二个 MCP 服务。

调整 `scripts/uninstall-local.mjs`：

1. 使用 `codex plugin remove acp-codex2opencode@acp-local` 卸载插件。
2. 清理旧版全局 MCP 登记，保证从旧安装升级的用户不会继续看到重复服务。
3. 移除本地 Marketplace 注册与本安装器创建的目录。

保留 Marketplace 的本地开发用途，但不把它当作全局 MCP 配置的替代品。

### 6.3 双宿主兼容边界

- 只修改 `.mcp.json`、Codex 本地安装/卸载脚本、相应测试和 Codex 安装文档。
- 不改 `mcp-servers.json`、`.claude-plugin/`、`scripts/install-claude.mjs`、`scripts/uninstall-claude.mjs`。
- `src/plugin/mcp-server.ts` 保持不动；它是两个宿主共享的业务运行核心，已有缓存目录握手已证明其可用。

### 6.4 用户可见行为

用户仍然执行同一条安装命令。安装完成后，用户在 Codex 中只看到一个委派能力入口；新任务可以按业务语言开始团队委派，而不是面对重复 MCP 或启动错误。

### 6.5 错误处理与回退

- 如果 `codex plugin add` 失败，安装脚本必须失败退出，不得输出安装完成。
- 如果旧版全局 MCP 清理失败，安装脚本必须显示明确失败原因，避免新旧双服务共存。
- 如果同名全局技能内容不同于可确认的旧版副本，安装脚本不得删除它；必须失败并说明该目录会遮蔽插件技能，要求用户先备份或改名后再安装。
- 若修复后的真实交付测试失败，记录失败事实，补充本设计和计划后再整改。
- 回退方式：执行更新后的卸载脚本，恢复上一稳定版本的源码与安装脚本，再按标准插件安装命令重新安装。

## 7. 修改范围

- [`.mcp.json`](../../../.mcp.json)：补齐 Codex 插件 MCP 的工作目录。
- [`scripts/install-local.mjs`](../../../scripts/install-local.mjs)：取消手工全局 MCP 注入，改用插件安装命令，并只迁移可确认的旧版全局技能副本。
- [`scripts/uninstall-local.mjs`](../../../scripts/uninstall-local.mjs)：改用插件卸载命令并清理旧版 MCP 残留。
- [`tests/plugin/install.plugin.test.ts`](../../../tests/plugin/install.plugin.test.ts)：新增工作目录与无重复注册断言。
- 新增或调整插件安装回归测试：覆盖安装脚本不再写入全局 MCP 服务。
- [`README.md`](../../../README.md) 与 [`docs/superpowers/runbooks/plugin-local-install.md`](../../runbooks/plugin-local-install.md)：用用户能执行的安装、验证、升级和回退说明替换“全局 MCP 兜底”描述。

## 8. 自动化验证目标

- 红灯：新增测试先断言 `.mcp.json` 包含 `cwd: "."`，当前版本应失败。
- 红灯：新增测试先断言 Codex 安装脚本不再构造 `[mcp_servers.acp_codex2opencode_plugin]`，当前版本应失败。
- 红灯：新增测试先断言安装器不会遗留或盲删同名全局技能副本，旧版安装器应失败。
- 精准回归：执行插件安装配置测试。
- 相关验证：执行 TypeScript 类型检查、插件构建准备和插件生命周期测试。
- 全量验证：执行项目全量测试。
- 安装校验：执行安装脚本后用 `codex plugin list` 与 `codex mcp get acp-codex2opencode` 验证单一插件服务与已解析工作目录。
- Claude 兼容：验证 Claude 专属文件未被本次修改，并保留其原有配置契约。

## 9. 交付测试目标

### DT-01 Codex MCP 启动同链路复测

- 真实入口：在真实 Windows 环境安装当前插件、重启或新建 Codex CLI 任务。
- 真实业务语言：`帮我用团队委派流程完成这个开发任务。`
- 复测链路：从非插件目录的可丢弃 Git worktree 启动 Codex CLI，让 Codex 加载刚安装的插件。
- 期望用户可见结果：没有 MCP startup failed；团队委派能力可被加载并能开始正常的业务阶段判断。
- 辅助证据：`codex plugin list` 显示插件已安装启用；`codex mcp list` 只显示一个本插件委派服务且工作目录已解析到插件缓存。
- 通过标准：真实 CLI 不出现 MCP 启动失败，用户可继续推进委派业务流程。

### DT-02 双宿主边界复测

- 真实入口：检查同一版本源码中的 Claude 插件清单与 MCP 配置。
- 用户业务结果：Claude Code 的用户仍可按既有自然语言进入团队委派能力，不因 Codex 安装修复失去配置文件。
- 辅助证据：Claude 专属清单、MCP 配置和安装脚本无业务性改动；相关检查通过。
- 通过标准：本次变更不修改 Claude 的启动入口和共享运行核心。

### 失败后的闭环

若 DT-01 或 `docs/团队委派交付测试必过表.md` 中任一项失败，必须记录真实 CLI 输出、补充根因判断和回归测试，重新实施并从同一工作树入口复测；不能以静态测试通过替代交付测试。

## 10. 当前推进状态与下一步

- 已完成：真实失败复现、安装状态检查、参考插件路径对照、缓存目录正确工作目录下的 MCP 握手、路径与重复 MCP 修复及其红绿测试、旧版全局技能安全迁移及最终重装复测。
- 当前阶段：本次代码根因已修复并安装为最终缓存版本；真实 worktree CLI 已确认读取插件 cache 中的 `team-delegate`，MCP 服务仅保留一个且握手成功。
- 下一步：当前账户无法使用项目规定的 `gpt-5.3-Codex`，因此需要在支持该模型的 Codex 环境中完成 DT-01 至 DT-13 的严格全流程验收；在此之前不能把完整交付测试标记为通过。
- 不可破坏约束：项目同时服务 Codex 与 Claude Code；Claude 专属文件和共享 MCP 运行核心不在本次修改范围。
