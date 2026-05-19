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

### F. 重启 Codex

关闭并重新打开 Codex（Desktop 或 CLI 均可）。

### G. 验证安装完成

1. 插件列表可见并启用 `acp-codex2opencode`（显示名 `ACP Delegate Bridge`）。
2. 技能文件存在：
   - `~/.codex/skills/team-delegate/SKILL.md`
   - `~/.codex/skills/ian-think/SKILL.md`
3. 四份指南存在：
   - `~/.codex/skills/team-delegate/docs/可交付开发设计文档编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付开发计划编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付BUG修改设计文档编写指南-v0.1.md`
   - `~/.codex/skills/team-delegate/docs/可交付BUG修改计划编写指南-v0.1.md`
4. 工具可见：
   - `delegate.task.execute`
   - `delegate.session.init`
   - `delegate.turn.run`
   - `delegate.turn.rework`
   - `delegate.session.set-config`
   - `delegate.turn.cancel`
   - `delegate.session.close`

### H. 真实 Codex CLI 交付验证入口

1. 打开真实 Codex CLI，并确认当前会话已经加载刚安装的插件。
2. 使用真实业务语言发起团队委派，例如：

```text
帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。过程中有进展就告诉我，没动静太久再问我是否接手。
```

3. 如果进入模型确认或模型选择，按本次任务要求选择对应实施模型。
4. 一旦插件返回了下一次跟进时间，必须确认当前宿主线程具备真实 heartbeat 能力：
   - 能实际调用 `automation_update`
   - 创建或刷新参数满足 `kind=heartbeat`、`destination=thread`、`status=ACTIVE`
   - heartbeat 内容只能回到同一个任务闭环重新查状态
5. 如果当前真实宿主没有 `automation_update` 或调用失败，必须直接记录：
   - `当前环境无法建立真实自动跟进`
   - 本次交付测试失败
   - 不允许再口头承诺“我会继续跟进”
6. 禁止把以下动作当成交付验证通过证据：
   - 手动重复触发 `status`
   - 用 `sleep`、`Start-Sleep` 或 shell 阻塞等待冒充 heartbeat
   - 只看内部字段，不观察真实线程是否自动回来
7. heartbeat 前提满足后，按 [docs/团队委派交付测试必过表.md](/var/work/acp_codex2opencode/docs/团队委派交付测试必过表.md) 逐项执行 DT-01 到 DT-13。任一项不通过，本次真实交付验证结论就是失败。

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
