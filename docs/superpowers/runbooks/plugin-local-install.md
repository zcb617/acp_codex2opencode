# ACP Codex2OpenCode 插件安装 Runbook

## 三步快速安装（推荐）

1. 打开终端并进入插件目录。
2. 执行安装命令：

```bash
npm run plugin:install-local
```

3. 看到 `INSTALLATION-COMPLETED` 后重启 Codex。

说明：该命令在 Windows / macOS / Linux 一致可用，不需要手动判断安装选项。

## 线性安装步骤（A 到 G）

### A. 检查前置条件

```bash
node -v
npm -v
codex --version
```

### B. 进入插件目录

```bash
cd <your-path>/acp_codex2opencode
```

### C. 安装依赖

```bash
npm install
```

### D. 构建插件包

```bash
npm run prepare:plugin
```

### E. 自动安装到 Codex（核心步骤）

```bash
npm run plugin:install-local
```

该命令会同时完成插件安装以及 `team-delegate`、`ian-think` 两个技能安装（目标：`~/.codex/skills/`）。
四份 Design / Planning 指南会随技能安装到 `~/.codex/skills/team-delegate/docs/`，运行时必须读取这里的插件指南，不能读取用户项目目录下的 `docs/` 或 `docs/superpowers/` 作为指南。
同时会写入 MCP 兜底配置（`[mcp_servers.acp_codex2opencode_plugin]`），并注入：

1. `OPENCODE_CONFIG_CONTENT={"permission":"allow","model":"llm-router-openai-compatible/kimi-for-roo"}`  
2. 默认轮次超时 `ACP_BRIDGE_TURN_TIMEOUT_MS=86400000`（24 小时）
3. 同步等待窗口 `ACP_BRIDGE_WORKFLOW_SYNC_WAIT_MS=180000`（首次同步等待 3 分钟）

脚本完成后，`codex plugin list` 必须已经显示 `acp-codex2opencode@acp-local installed, enabled`。如果没有达到这个状态，本次安装视为失败，不能只看 `INSTALLATION-COMPLETED`。

### F. 重启 Codex

关闭并重新打开 Codex（Desktop 或 CLI 均可）。

### G. 验证安装完成

1. 执行 `codex plugin list`，确认 `acp-codex2opencode@acp-local` 显示为 `installed, enabled`。
2. 技能文件存在：
   - `~/.codex/skills/team-delegate/SKILL.md`
   - `~/.codex/skills/ian-think/SKILL.md`
3. plugin cache 已刷新：
   - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`
   - 重装后如果需要验证 plugin cache 是否已刷新，请检查缓存目录中的 `skills/team-delegate/SKILL.md` 是否包含：
     - `计划确认后必须先选择实施执行方`
     - `只有用户明确选择 ACP 实施时才需要选择 ACP 执行模型`
4. 四份指南存在：
   - `~/.codex/skills/team-delegate/docs/可交付开发设计文档编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付开发计划编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付BUG修改设计文档编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付BUG修改计划编写指南-v0.1.md`
5. 工具可见：
   - `delegate.task.execute`
   - `delegate.session.init`
   - `delegate.turn.run`
   - `delegate.turn.rework`
   - `delegate.session.set-config`
   - `delegate.turn.cancel`
   - `delegate.session.close`

### H. 真实 Codex CLI 交付验证入口

1. 使用默认方式正常启动真实 Codex CLI，并确认当前会话已经加载刚安装的插件。
   - 不使用额外 profile
   - 不使用临时 `-c` 配置覆盖
2. 使用真实业务语言发起团队委派，例如：

```text
帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。过程中有进展就告诉我，没动静太久再问我是否接手。
```

3. 如果进入模型确认或模型选择，按本次任务要求选择对应实施模型。
4. 一旦插件返回了下一次跟进时间，必须确认当前宿主线程具备真实的自动回来路径：
   - 若能实际调用 `automation_update`，创建或刷新参数满足 `kind=heartbeat`、`destination=thread`、`status=ACTIVE`
   - 若当前宿主没有 `automation_update`，但这是一条持续运行的真实 Codex CLI 会话，则主会话不能结束当前轮，必须在同一轮里保留等待窗口并到点后自动回到同一个任务闭环重新查状态
5. 只有在“既没有 heartbeat，也没有同轮自动续跑”时，才直接记录：
   - `当前环境无法建立真实自动跟进`
   - 本次交付测试失败
   - 不允许再口头承诺“我会继续跟进”
6. 禁止把以下动作当成交付验证通过证据：
   - 在当前轮已经结束后再手动重复触发 `status`
   - 人工补发消息、再次点击“再跟踪”或其他人工补触发动作
   - 只看内部字段，不观察真实线程是否自动回来
7. 自动回来路径确认后，按 [docs/团队委派交付测试必过表.md](/var/work/acp_codex2opencode/docs/团队委派交付测试必过表.md) 逐项执行 DT-01 到 DT-13。任一项不通过，本次真实交付验证结论就是失败。

## 卸载步骤

```bash
npm run plugin:uninstall-local
```

执行后会清理：

1. marketplace 注册与目录
2. `plugins."acp-codex2opencode@acp-local"` 配置节
3. `[mcp_servers.acp_codex2opencode_plugin]` 兜底配置节
4. `~/.codex/skills/team-delegate`
5. `~/.codex/skills/ian-think`

执行后重启 Codex。

## 回滚步骤

1. 卸载当前插件版本（执行 `npm run plugin:uninstall-local`）。
2. 安装上一稳定版本目录（可先切换到上一稳定提交版本）。
3. 重新执行安装命令（`npm run plugin:install-local`）。
4. 重复“G. 验证安装完成”确认恢复。
