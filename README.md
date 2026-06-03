# ACP Codex2OpenCode Plugin

一个可本地安装的 Codex 插件，用于把 OpenCode ACP 委派流程做成可落地的业务闭环：从方案、计划、实施到交付测试与整改，统一通过工具编排推进。

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [工作流概览](#工作流概览)
- [快速开始](#快速开始)
- [使用方式](#使用方式)
- [自动跟进约束必须遵守](#自动跟进约束必须遵守)
- [工具清单](#工具清单)
- [配置说明](#配置说明)
- [开发与测试](#开发与测试)
- [项目结构](#项目结构)
- [文档导航](#文档导航)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 项目简介

本插件面向需要“团队委派”能力的开发流程，目标是解决两类问题：

1. 委派流程容易跳步骤，缺少阶段闸门和用户确认。
2. 实施完成后容易误判“已交付”，缺少真实业务入口测试与失败整改闭环。

插件通过 `delegate.task.execute` 提供高层入口，默认配合 `team-delegate` 和 `ian-think` 两个技能，按业务语义推进，不要求用户手填底层协议参数。

## 核心特性

- 单入口高层编排：统一走 `delegate.task.execute`，避免直接拼装低层会话调用。
- 阶段化推进：支持 `design`、`planning`、`implementation`、`need_user_input` 四种起始阶段。
- 开发类型分流：支持 `feature`、`bugfix`、`need_user_input`，并映射对应的设计/计划指南。
- 实施执行方选择：计划确认后先选“主会话实施”或“ACP 实施”，再决定是否需要模型确认。
- 交付闭环：实施完成后必须进入真实交付测试，失败后进入整改方案/计划与复测链路。
- 本地安装友好：提供一键安装与卸载脚本，并自动注入插件、技能与兜底 MCP 配置。

## 工作流概览

```text
需求输入
  -> 起始阶段判定 + 开发类型判定
  -> 方案/计划阶段（按闸门确认）
  -> 实施执行方选择（主会话或 ACP）
  -> ACP 实施（可选）
  -> 真实业务交付测试
  -> 通过: 完成
  -> 失败: 整改方案与计划 -> 整改实施 -> 复测
```

## 快速开始

### 环境要求

- Node.js >= 20
- npm
- Codex CLI（可执行 `codex --version`）或 Claude Code CLI（可执行 `claude --version`）

> **注意**：Claude Code 安装需要 `claude` 命令在 PATH 中可用。如果尚未安装，请先前往 [Claude Code 官网](https://claude.ai/code) 安装。

### Codex 安装

```bash
npm run plugin:install-local
```

看到 `INSTALLATION-COMPLETED` 后，重启 Codex。

安装脚本会自动完成以下动作：

1. 构建插件并注册本地 marketplace。
2. 启用插件并写入 `~/.codex/config.toml`。
3. 安装 `team-delegate` 与 `ian-think` 到 `~/.codex/skills/`。
4. 注入 `[mcp_servers.acp_codex2opencode_plugin]` 兜底配置。

### Claude Code 安装

安装前请确认 Claude Code 已可用：

```bash
claude --version
```

在 Claude Code 对话中执行以下命令：

```bash
/plugin marketplace add zcb617/acp_codex2opencode
/plugin install acp-codex2opencode@acp-codex2opencode
/reload-plugins
```

安装完成后，进入插件目录安装 npm 依赖（注意替换 `<版本号>` 为实际安装的版本）：

```bash
cd ~/.claude/plugins/cache/acp-codex2opencode/acp-codex2opencode/<版本号>
npm install
```

然后重启 Claude Code：

```bash
/reload-plugins
```

> **注意**：Claude Code 插件系统目前不会自动安装 npm 依赖，需要手动执行上述步骤。

**Claude Code 版本要求**：建议 `claude >= 0.2.x`，以确保 MCP 工具和技能系统兼容。如果安装后发现工具未加载，请尝试升级 Claude Code 到最新版本。

### 卸载

**Codex：**

```bash
npm run plugin:uninstall-local
```

**Claude Code：**

```bash
/plugin uninstall acp-codex2opencode@acp-codex2opencode
/reload-plugins
```

### 安装验证

**Codex：**

重启后执行以下命令确认插件和工具已加载：

```bash
codex tool list | findstr delegate
```

应看到 `delegate.task.execute` 等工具。

**Claude Code：**

安装完成后执行 `/reload-plugins`，然后在对话中输入 `/tools`，在列表中查找以 `delegate.` 开头的工具。若未出现，请检查：

1. `/plugin` 中 Installed 页是否显示 `acp-codex2opencode`。
2. `/plugin` 中 Errors 页是否有加载错误。
3. 尝试重新执行 `/plugin install acp-codex2opencode@acp-codex2opencode` 和 `/reload-plugins`。

## 使用方式

### Codex CLI

安装并重启后，在 Codex CLI 使用自然语言发起任务，例如：

```text
帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。
```

### Claude Code

在 Claude Code 中同样使用自然语言发起任务，例如：

```text
帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。
```

Claude Code 会自动识别并调用插件暴露的 `delegate.task.execute` 工具。

实践建议：

1. 需求不清晰时，先走 `need_user_input`，必要时触发 `ian-think` 做需求挖掘。
2. 方案与计划阶段先确认再推进，不要跨阶段跳转。
3. 计划确认后先选择实施执行方；只有选择 ACP 实施，才进入模型确认/选择。

## 自动跟进约束必须遵守

以下规则是本插件运行闭环的核心约束：

1. 只要返回了下一次跟进时间，当前轮的第一优先动作是安排“自动回来”。
2. 优先调用 `automation_update`，并确保 `kind=heartbeat`、`destination=thread`、`status=ACTIVE`。
3. 如果当前宿主不支持该能力，主会话不得结束当前轮，必须在同一轮保留等待窗口并到点后重查状态。
4. 禁止结束当前轮后再靠手动补发消息、手动重复触发 `status` 等方式冒充自动跟进。
5. 如果返回 `follow_up_runtime_requirement`，必须按契约执行，尤其是 `current_turn_must_stay_open_without_heartbeat`。
6. 运行态没有新进展且未进入用户决策阶段时，应静默保活等待窗口，不要反复输出“持续跟进中”。

## 工具清单

- `delegate.task.execute`：高层委派入口（推荐）
- `delegate.session.init`：初始化或恢复会话
- `delegate.turn.run`：发起一轮执行
- `delegate.turn.rework`：基于上一轮发起整改
- `delegate.session.set-config`：设置会话配置（如模型）
- `delegate.turn.cancel`：取消当前轮次
- `delegate.session.close`：关闭会话并释放资源

## 配置说明

默认 MCP 配置文件：`./.mcp.json`

关键环境变量如下：

- `OPENCODE_BIN_PATH`：OpenCode 可执行文件路径（默认 `opencode`）
- `ACP_BRIDGE_STATE_DIR`：运行态数据目录（默认 `./runtime`）
- `ACP_BRIDGE_LOG_DIR`：日志目录
- `ACP_BRIDGE_LOG_LEVEL`：日志等级
- `ACP_BRIDGE_TURN_TIMEOUT_MS`：轮次超时（默认 `86400000`）
- `ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS`：首次同步等待窗口（默认 `180000`）
- `ACP_BRIDGE_MAX_PARALLEL_SESSIONS`：最大并行会话数
- `ACP_BRIDGE_ALLOWED_WORKSPACES`：允许的工作区白名单
- `OPENCODE_CONFIG_CONTENT`：传给 OpenCode 的默认配置内容

## 开发与测试

### 常用命令

```bash
npm install
npm run build
npm run typecheck
npm test
```

### 分层测试

```bash
npm run test:unit
npm run test:integration
npm run test:delivery
npm run test:plugin-install
npm run test:plugin-e2e
```

### 真实 ACP 联调

默认会跳过真实 `opencode acp`。如需执行真实联调：

```bash
RUN_REAL_ACP=1 npm run test:integration -- tests/integration/real-acp.integration.test.ts
```

## 项目结构

```text
.
├── .codex-plugin/            # Codex 插件清单
├── .claude-plugin/           # Claude Code 插件清单
├── docs/                     # 项目文档与交付规范
├── skills/                   # 随插件分发的技能
├── scripts/                  # 安装/卸载/打包脚本
├── src/                      # TypeScript 源码
├── tests/                    # 自动化测试
├── dist/                     # 构建产物
├── .mcp.json                 # Codex MCP 配置
└── mcp-servers.json          # Claude Code MCP 配置
```

## 文档导航

- 安装运行手册：`docs/superpowers/runbooks/plugin-local-install.md`
- 交付测试必过表：`docs/团队委派交付测试必过表.md`
- 设计与计划指南（项目内）：`docs/可交付*.md`
- 设计与计划指南（技能分发）：`skills/team-delegate/docs/`

## 贡献指南

1. 先阅读 `AGENTS.md` 和相关 `docs/` 规范。
2. 提交前至少完成与改动相关的自动化测试。
3. 涉及委派流程变更时，补充真实业务入口的交付验证记录。

## 许可证

MIT，见 `LICENSE`。
