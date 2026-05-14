# Codex × OpenCode ACP 通用委派闭环可交付开发计划（v0.1 草案）

文档版本：`v0.2`  
文档日期：`2026-05-13`  
关联需求：`docs/superpowers/specs/2026-05-13-codex-opencode-acp-通用委派闭环项目需求文档.md`

## 1. 项目与目标

功能名称：`Codex × OpenCode ACP 通用委派闭环桥接能力`

业务目标：
1. 在 Codex 内提供可复用的委派桥接能力，支持“委派 -> 反馈 -> 整改 -> 再委派”的连续闭环。
2. 支持跨进程恢复同一会话，保障长任务不中断。
3. 提供可观测、可追踪、可回滚的工程化交付能力。
4. 交付形态必须是可安装的 Codex 插件（本地目录安装），而不是仅源码模块。

使用对象：
1. Codex 主代理（发起委派与整改）。
2. 项目开发者（查看日志、定位问题、执行回滚）。

当前痛点：
1. 现有验证停留在协议通路可用，缺少稳定的闭环编排层。
2. 会话恢复、幂等、防并发冲突、异常恢复尚未产品化。
3. 缺乏统一交付验收链路，难以证明真实可用。

交付后效果：
1. 可稳定执行多轮连续委派，支持整改循环。
2. 可跨进程恢复会话并延续上下文。
3. 关键错误可定位、可告警、可复盘。
4. 在 Codex Desktop 与 Codex CLI 中可完成插件安装、加载、调用、卸载与重装验证。

不做什么：
1. 不替代 Codex 主代理能力。
2. 不实现 GUI 管理界面。
3. 不改造 OpenCode 核心。
4. 不执行未授权 `git push` 与远程越权写操作。
5. 不做插件商店发布流程（本期仅本地目录安装）。

## 2. 硬约束

1. 文档与沟通均使用中文。
2. 开发或修改代码前必须先汇报方案并获批准。
3. 开发代码必须新建分支，分支前缀默认 `codex/`。
4. 禁止使用 `git worktree`。
5. 未经用户授权禁止执行 `git push`。
6. 用户未要求打包时不得自行打包。
7. 开发完成后必须执行编译与测试门禁。
8. 不能要求用户自行看日志替代问题分析。
9. 不修改 `opencode` 源码，仅通过 ACP 协议对接。

## 3. 范围与非范围

### 3.1 本次交付

1. 委派桥接 MCP Server（统一 API 契约）。
2. ACP 客户端核心（initialize/session/prompt/cancel/config）。
3. 进程监管器（子进程生命周期与僵尸回收）。
4. 会话管理器（new/load/resume/close）。
5. 轮次执行器（run/rework/cancel + stopReason 收敛）。
6. 幂等与去重机制（请求级、事件级）。
7. SQLite 持久化模型（sessions/turns/events/audit）。
8. 审计、日志、指标与告警。
9. 发布与回滚 Runbook。
10. 自动化测试体系（unit/integration/e2e/delivery）。
11. Codex 插件打包目录（`.codex-plugin/plugin.json` + 插件入口 + 元数据）。
12. 本地目录安装与卸载验证（Desktop/CLI）。

### 3.2 本次不交付

1. 图形化运维界面。
2. 多租户权限中台。
3. OpenCode 模型供应商管理。
4. 跨机器共享存储（本期维持单机 SQLite）。

## 4. 交付完成定义

只有同时满足以下条件，才判定交付完成：

1. `session/init` 成功率 >= 99%。
2. `turn/run` 获取 `stopReason` 成功率 >= 98%。
3. 支持跨进程恢复后继续整改轮次。
4. 会话内模型切换成功率 >= 99%。
5. 异常请求错误码准确率 = 100%。
6. 僵尸 ACP 进程数持续为 0。
7. 业务交付测试全部通过。
8. 编译通过，且无阻断级测试失败。
9. 插件本地目录安装测试通过（Desktop 与 CLI 至少各 1 次）。
10. 插件卸载与重装一致性测试通过（无残留状态污染）。
11. 插件入口暴露的委派能力可完成 DS-01 ~ DS-06 全链路。

## 5. 业务交付场景

### DS-01 初始化并建立委派会话

**业务目标：**
Codex 可以创建或恢复可用委派会话并获得可操作句柄。

**前置条件：**
1. `opencode acp` 可执行。
2. 状态目录和日志目录可写。

**输入数据：**
- `workspace_path`: `D:/repo/demo`
- `session_alias`: `task-20260513-001`
- `session_strategy`: `auto`

**操作步骤：**
1. 调用 `POST /v1/delegate/session/init`。
2. 桥接器执行 `initialize`。
3. 根据策略执行 `session/new` 或 `session/load/resume`。
4. 返回 `bridge_session_id` 与当前配置。

**期望输出：**
1. `success=true`。
2. 返回 `bridge_session_id`、`acp_session_id`。
3. `delegate_sessions` 写入成功。

**数据校验：**
1. `delegate_sessions.session_alias` 唯一。
2. `status=READY`。

**失败处理：**
1. 超时返回 `ACP_INIT_TIMEOUT`。
2. 不支持 `load` 时回退 `new` 并记录审计。

**对应开发任务：**
Task 01、Task 03、Task 05、Task 07、Task 09。

### DS-02 首轮委派并收敛到 stopReason

**业务目标：**
发起首轮任务并稳定拿到轮次完成结果。

**前置条件：**
1. DS-01 已成功。
2. 会话状态为 `READY`。

**输入数据：**
- `idempotency_key`: `turn-0001`
- `prompt_text`: `请分析模块并给出修复建议`

**操作步骤：**
1. 调用 `POST /v1/delegate/turn/run`。
2. 桥接器写入 turn 记录并发起 `session/prompt`。
3. 采集 `session/update` 事件流。
4. 收到响应并写入 `stopReason` 与 usage。

**期望输出：**
1. 返回 `turn_id`。
2. `stop_reason=end_turn`（或其他明确终止原因）。
3. `delegate_turns.status=COMPLETED`。

**数据校验：**
1. `turn_seq` 自增。
2. `delegate_events` 顺序写入，无乱序覆盖。

**失败处理：**
1. 超时标记 `PROMPT_EXEC_FAILED`。
2. 会话并发冲突返回 `TURN_ALREADY_RUNNING`。

**对应开发任务：**
Task 04、Task 06、Task 07、Task 08、Task 09。

### DS-03 整改轮次连续闭环

**业务目标：**
基于上一轮结果连续发起整改并保持上下文。

**前置条件：**
1. DS-02 至少完成 1 轮。
2. 同一 `bridge_session_id` 可用。

**输入数据：**
- `idempotency_key`: `turn-0002`
- `rework_prompt_text`: `请给出可执行补丁和验证步骤`

**操作步骤：**
1. 调用 `POST /v1/delegate/turn/rework`。
2. 复用会话上下文执行 `session/prompt`。
3. 重复 run/rework 循环 10 轮。

**期望输出：**
1. 连续 10 轮不中断。
2. 每轮有明确 `stopReason`。

**数据校验：**
1. `turn_seq` 连续无跳号。
2. 轮次幂等键不冲突。

**失败处理：**
1. 同幂等键不同请求体返回 `IDEMPOTENCY_CONFLICT`。
2. 会话异常时触发恢复逻辑后继续下一轮。

**对应开发任务：**
Task 05、Task 06、Task 07、Task 09、Task 10。

### DS-04 跨进程恢复并继续任务

**业务目标：**
桥接进程重启后可恢复历史会话并继续整改。

**前置条件：**
1. 已存在持久化会话记录。
2. 桥接器被重启。

**输入数据：**
- `workspace_path + session_alias`

**操作步骤：**
1. 重启桥接器。
2. 再次调用 `session/init`。
3. 命中历史映射并 `load/resume`。
4. 发起 `turn/rework`。

**期望输出：**
1. `session_mode=loaded` 或 `resumed`。
2. 整改轮次可继续执行。

**数据校验：**
1. `bridge_session_id` 与 `session_alias` 映射稳定。
2. 恢复过程写入审计日志。

**失败处理：**
1. `load` 失败回退 `new` 并显式返回上下文丢失信息。
2. 恢复失败返回可重试错误码。

**对应开发任务：**
Task 03、Task 05、Task 07、Task 09。

### DS-05 会话模型切换

**业务目标：**
在会话内切换模型并对后续轮次生效。

**前置条件：**
1. 会话状态 `READY`。
2. `configOptions` 可读。

**输入数据：**
- `config_id=model`
- `value=opencode/big-pickle`

**操作步骤：**
1. 调用 `POST /v1/delegate/session/set-config`。
2. 执行 `session/set_config_option`。
3. 发起下一轮 `turn/run` 验证生效。

**期望输出：**
1. `config_options` 返回新模型。
2. 后续轮次按新模型执行。

**数据校验：**
1. `delegate_sessions.current_model` 更新。
2. 审计日志记录模型切换动作。

**失败处理：**
1. 非法模型返回 `CONFIG_VALUE_INVALID`。
2. 不可重试错误不触发自动重试。

**对应开发任务：**
Task 04、Task 05、Task 07、Task 09。

### DS-06 轮次取消与资源释放

**业务目标：**
可取消运行中轮次，并在任务结束后关闭会话清理资源。

**前置条件：**
1. 存在运行中 turn。
2. `bridge_session_id` 有效。

**输入数据：**
- `POST /v1/delegate/turn/cancel`
- `POST /v1/delegate/session/close`

**操作步骤：**
1. 触发 `turn/cancel`。
2. 等待 `session/cancel` 收敛。
3. 调用 `session/close`。
4. 校验子进程与句柄释放。

**期望输出：**
1. 取消完成 P95 <= 5s。
2. 会话关闭成功且可幂等重复关闭。

**数据校验：**
1. `delegate_turns.status=CANCELLED`。
2. `delegate_sessions.status=CLOSED`。

**失败处理：**
1. 无活动轮次返回 `NO_ACTIVE_TURN`。
2. 关闭失败返回 `SESSION_CLOSE_FAILED` 并可重试。

**对应开发任务：**
Task 02、Task 05、Task 06、Task 09。

### DS-07 插件本地目录安装与加载

**业务目标：**
最终产物可作为 Codex 插件在本地目录安装，并可被加载与调用。

**前置条件：**
1. 插件目录包含 `.codex-plugin/plugin.json`。
2. 插件依赖安装完成，入口可执行。

**输入数据：**
- 本地插件根目录路径
- 插件标识与版本号

**操作步骤：**
1. 通过 Codex Desktop 执行本地目录安装。
2. 通过 Codex CLI 执行本地目录安装。
3. 检查插件是否加载成功并可见。
4. 调用 `delegate.session.init` 与 `delegate.turn.run` 进行冒烟验证。

**期望输出：**
1. 安装成功，无 schema 校验错误。
2. 插件工具注册可见。
3. 委派基础能力可调用。

**数据校验：**
1. 插件清单字段完整（id/name/version/entrypoint）。
2. 日志中存在插件加载成功记录。

**失败处理：**
1. manifest 不合法时报结构化错误并阻断安装。
2. 插件加载失败时输出定位信息（入口、依赖、权限）。

**对应开发任务：**
Task 08、Task 11、Task 12。

### DS-08 插件卸载、重装与回滚验证

**业务目标：**
插件在卸载、重装、版本回滚后依然保持可用与状态一致。

**前置条件：**
1. DS-07 已成功安装并调用。
2. 存在可回滚上一版本插件包。

**输入数据：**
- 当前版本插件目录
- 上一稳定版本插件目录

**操作步骤：**
1. 卸载当前插件。
2. 重装当前版本并执行 `session/init -> turn/run`。
3. 回滚到上一版本并复测委派闭环。

**期望输出：**
1. 卸载后无脏注册残留。
2. 重装后能力恢复正常。
3. 回滚版本 10 分钟内恢复可用。

**数据校验：**
1. 卸载后工具不可见，重装后恢复可见。
2. 回滚后关键指标恢复到稳定阈值内。

**失败处理：**
1. 回滚失败触发应急流程并保留诊断日志。
2. 必须执行完整复测后才能声明恢复。

**对应开发任务：**
Task 10、Task 11、Task 12。

## 6. 自测命令

交付前必须执行：

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:plugin-install
npm run test:plugin-e2e
npm run test:delivery
npm run build
```

通过标准：
1. 业务交付场景 DS-01 ~ DS-08 全部通过。
2. 单元、集成、端到端测试全通过。
3. 插件安装/卸载/重装测试通过。
4. 编译成功。

## 7. 失败修复与复测机制

若任一命令失败，必须执行以下闭环：

1. 停止声明完成。
2. 在 `fix_bug_work/` 新建失败记录文件。
3. 记录失败场景、输入、期望、实际、根因、修复方案。
4. 完成修复后先复跑失败用例。
5. 再复跑完整业务交付测试（`npm run test:delivery`）。
6. 最后复跑完整门禁命令组。
7. 全部通过后才能进入交付完成说明。

失败记录模板：

```markdown
# 问题名称-1

## 失败场景
## 输入数据
## 期望结果
## 实际结果
## 根因分析
## 修复方案
## 复测命令
## 复测结果
```

## 8. 技术设计与模块边界

### 8.1 模块划分

1. `src/mcp-tools`：工具契约、参数校验、错误映射。
2. `src/session`：会话生命周期、轮次编排、状态机。
3. `src/acp-client`：JSON-RPC 封装、会话方法、事件流处理。
4. `src/process`：`opencode acp` 子进程监管与恢复。
5. `src/store`：SQLite 持久化与迁移。
6. `src/observability`：日志、审计、指标、告警。
7. `.codex-plugin`：插件元数据、入口映射、安装声明。

### 8.2 调用链约束

1. 允许：`mcp-tools -> session -> acp-client/process/store`。
2. 禁止：`mcp-tools` 直接管理子进程。
3. 禁止：`store` 反向依赖 `session`。
4. 禁止：`acp-client` 引入业务语义与 UI 逻辑。

### 8.3 数据流

用户委派请求 -> MCP Tool -> 会话管理与幂等判定 -> ACP prompt/update -> 事件落盘 -> 轮次收敛 -> 结果返回 -> 审计与指标上报

### 8.4 错误传播

参数错误 -> 请求级错误码直接返回。  
协议错误 -> 标记 `ACP_PROTOCOL_ERROR` + 自动重连。  
进程错误 -> 自动拉起 + 恢复映射 + 告警。  
存储错误 -> 标记 `STORE_WRITE_FAILED` + 短期内存降级。

## 9. API、数据模型与配置

### 9.1 API 合约

本次实现以下接口：
1. `POST /v1/delegate/session/init`
2. `POST /v1/delegate/turn/run`
3. `POST /v1/delegate/turn/rework`
4. `POST /v1/delegate/session/set-config`
5. `POST /v1/delegate/turn/cancel`
6. `POST /v1/delegate/session/close`

统一响应字段：`request_id`、`success`、`data|error`。

关键错误码：
`INVALID_REQUEST`、`SESSION_NOT_FOUND`、`TURN_ALREADY_RUNNING`、`IDEMPOTENCY_CONFLICT`、`CONFIG_VALUE_INVALID`、`RATE_LIMITED`、`PROMPT_EXEC_FAILED`、`ACP_PROTOCOL_ERROR`、`ACP_PROCESS_UNAVAILABLE`、`ACP_INIT_TIMEOUT`。

### 9.2 数据模型

1. `delegate_sessions`：会话映射、模型配置、状态、错误。
2. `delegate_turns`：轮次生命周期、幂等键、stopReason、usage。
3. `delegate_events`：流式事件序列与原始 payload。
4. `delegate_audit_logs`：请求审计、动作、结果码。

### 9.3 配置与环境变量

必填环境变量：
1. `OPENCODE_BIN_PATH`
2. `ACP_BRIDGE_STATE_DIR`
3. `ACP_BRIDGE_LOG_DIR`
4. `ACP_BRIDGE_LOG_LEVEL`
5. `ACP_BRIDGE_TURN_TIMEOUT_MS`
6. `ACP_BRIDGE_MAX_PARALLEL_SESSIONS`
7. `ACP_BRIDGE_ALLOWED_WORKSPACES`
8. `OPENCODE_CONFIG_CONTENT`

### 9.4 插件清单契约

必须包含并校验：
1. `.codex-plugin/plugin.json`。
2. 插件基础字段：`id`、`name`、`version`、`description`。
3. 入口与能力映射字段：插件入口脚本、MCP 工具暴露声明。
4. 兼容性字段：支持 `Codex Desktop` 与 `Codex CLI` 的本地安装模式说明。

## 10. 开发任务拆分

### Task 01: 初始化项目骨架与工程门禁

**目标：**
建立 Node.js 20 + TypeScript 工程骨架与测试脚本。

**对应交付场景：**
DS-01。

**文件：**
- 新增：`package.json`
- 新增：`tsconfig.json`
- 新增：`vitest.config.ts`
- 新增：`src/index.ts`
- 新增：`tests/setup.ts`

**实施步骤：**
1. 初始化依赖与脚本命令。
2. 配置 TypeScript 与测试框架。
3. 建立目录结构。

**验证命令：**
`npm run typecheck`、`npm run test:unit`

### Task 02: 实现 ACP 进程监管器

**目标：**
实现 `opencode acp` 启停、健康检查、僵尸回收。

**对应交付场景：**
DS-06。

**文件：**
- 新增：`src/process/acp-process-supervisor.ts`
- 新增：`src/process/process-health.ts`
- 新增测试：`tests/unit/process-supervisor.test.ts`

**实施步骤：**
1. 封装子进程启动与退出监听。
2. 实现僵尸检测和回收。
3. 暴露健康状态查询。

**验证命令：**
`npm run test:unit -- process-supervisor`

### Task 03: 实现 ACP 客户端核心

**目标：**
实现 NDJSON JSON-RPC 通信与 `initialize/session/*` 方法封装。

**对应交付场景：**
DS-01、DS-04。

**文件：**
- 新增：`src/acp-client/ndjson-transport.ts`
- 新增：`src/acp-client/jsonrpc-client.ts`
- 新增：`src/acp-client/session-api.ts`
- 新增测试：`tests/unit/acp-client-transport.test.ts`

**实施步骤：**
1. 实现请求-响应关联与超时控制。
2. 实现 `initialize/new/load/resume/prompt/cancel/set_config_option`。
3. 实现协议错误检测。

**验证命令：**
`npm run test:unit -- acp-client`

### Task 04: 实现事件采集与轮次执行器

**目标：**
实现 `turn/run` 与 `turn/rework` 的流式采集和 stopReason 收敛。

**对应交付场景：**
DS-02、DS-03、DS-05。

**文件：**
- 新增：`src/session/turn-runner.ts`
- 新增：`src/session/event-collector.ts`
- 新增测试：`tests/integration/turn-runner.integration.test.ts`

**实施步骤：**
1. 实现轮次状态机迁移。
2. 实现事件顺序写入。
3. 实现 usage 与 summary 生成。

**验证命令：**
`npm run test:integration -- turn-runner`

### Task 05: 实现会话管理与模型切换

**目标：**
实现会话生命周期与 `session/set-config`。

**对应交付场景：**
DS-01、DS-03、DS-04、DS-05、DS-06。

**文件：**
- 新增：`src/session/session-manager.ts`
- 新增：`src/session/session-state-machine.ts`
- 新增测试：`tests/integration/session-manager.integration.test.ts`

**实施步骤：**
1. 管理 `new/load/resume/close`。
2. 实现会话可恢复映射。
3. 实现配置项变更与合法性校验。

**验证命令：**
`npm run test:integration -- session-manager`

### Task 06: 实现幂等、防并发与取消机制

**目标：**
保证单会话单轮并发，支持幂等去重与取消收敛。

**对应交付场景：**
DS-02、DS-03、DS-06。

**文件：**
- 新增：`src/session/idempotency-guard.ts`
- 新增：`src/session/turn-cancel.ts`
- 新增测试：`tests/unit/idempotency-guard.test.ts`

**实施步骤：**
1. 幂等键一致性校验与冲突处理。
2. 会话并发锁与释放。
3. `session/cancel` 收敛处理。

**验证命令：**
`npm run test:unit -- idempotency`

### Task 07: 实现持久化与审计落盘

**目标：**
实现 SQLite 模型、迁移、仓储接口与审计日志。

**对应交付场景：**
DS-01、DS-02、DS-03、DS-04、DS-05。

**文件：**
- 新增：`src/store/sqlite.ts`
- 新增：`src/store/migrations/001_init.sql`
- 新增：`src/store/repositories/*.ts`
- 新增测试：`tests/integration/store.integration.test.ts`

**实施步骤：**
1. 建立四张核心表。
2. 实现事务化写入。
3. 实现审计链路与查询接口。

**验证命令：**
`npm run test:integration -- store`

### Task 08: 实现 MCP Tool 层与 API 契约

**目标：**
对外暴露稳定工具接口并统一错误映射。

**对应交付场景：**
DS-01 ~ DS-06。

**文件：**
- 新增：`src/mcp-tools/delegate-tools.ts`
- 新增：`src/mcp-tools/schemas.ts`
- 新增测试：`tests/integration/mcp-tools.integration.test.ts`

**实施步骤：**
1. 定义请求/响应 schema。
2. 接入会话与轮次服务。
3. 落地错误码字典与限流策略。

**验证命令：**
`npm run test:integration -- mcp-tools`

### Task 09: 可观测与告警

**目标：**
实现结构化日志、指标聚合与阈值告警。

**对应交付场景：**
DS-01 ~ DS-06。

**文件：**
- 新增：`src/observability/logger.ts`
- 新增：`src/observability/metrics.ts`
- 新增：`src/observability/alerts.ts`
- 新增测试：`tests/unit/observability.test.ts`

**实施步骤：**
1. 统一 `request_id` 链路追踪。
2. 统计成功率、时延、错误分布。
3. 实现 P1/P2 阈值告警。

**验证命令：**
`npm run test:unit -- observability`

### Task 10: 业务交付测试与发布回滚 Runbook

**目标：**
建立业务闭环验收与故障回滚操作手册。

**对应交付场景：**
DS-03、DS-04、DS-06、DS-08。

**文件：**
- 新增：`tests/delivery/delegate-loop.delivery.test.ts`
- 新增：`tests/delivery/recovery.delivery.test.ts`
- 新增：`docs/superpowers/runbooks/acp-bridge-release-rollback.md`

**实施步骤：**
1. 编排端到端闭环测试。
2. 编写发布前检查、灰度、回滚步骤。
3. 将门禁绑定 CI。

**验证命令：**
`npm run test:delivery`

### Task 11: 插件封装与本地安装能力

**目标：**
将桥接能力封装为可安装 Codex 插件目录，支持本地目录安装。

**对应交付场景：**
DS-07、DS-08。

**文件：**
- 新增：`.codex-plugin/plugin.json`
- 新增：`src/plugin/index.ts`
- 新增：`docs/superpowers/runbooks/plugin-local-install.md`

**实施步骤：**
1. 定义插件清单与版本策略。
2. 绑定工具入口到插件能力导出。
3. 补充本地安装、卸载、重装说明。

**验证命令：**
`npm run test:plugin-install`

### Task 12: 插件交付验收测试矩阵

**目标：**
建立插件安装、加载、调用、卸载、回滚的一体化验收测试。

**对应交付场景：**
DS-07、DS-08。

**文件：**
- 新增：`tests/plugin/install.plugin.test.ts`
- 新增：`tests/plugin/lifecycle.plugin.test.ts`
- 新增：`tests/plugin/rollback.plugin.test.ts`

**实施步骤：**
1. 落地 PT-01 ~ PT-07 自动化或半自动化脚本。
2. 接入 CI 门禁与本地复测脚本。
3. 形成失败复盘模板与证据收集规范。

**验证命令：**
`npm run test:plugin-e2e`

## 11. 测试策略

1. 单元测试：状态机、幂等、错误映射、协议帧解析。
2. 集成测试：桥接器与真实 `opencode acp` 的会话与轮次行为。
3. 端到端测试：委派-整改-恢复-关闭全链路。
4. 业务交付测试：真实操作序列验证可用性与稳定性。
5. 稳定性测试：20 会话并发、单会话 30 轮整改、8 小时长跑。
6. 插件交付测试：
   1. PT-01 插件清洁安装测试（新环境安装成功）。
   2. PT-02 插件加载与工具注册测试（工具可见、可调用）。
   3. PT-03 插件端到端委派闭环测试（run/rework/close）。
   4. PT-04 插件重启恢复测试（重启后 session 可恢复）。
   5. PT-05 插件内模型切换测试（set-config 生效）。
   6. PT-06 异常与回滚测试（进程异常、协议异常、回滚后可用）。
   7. PT-07 卸载与重装一致性测试（无残留污染）。

最终门禁：`npm run test:plugin-install`、`npm run test:plugin-e2e`、`npm run test:delivery` 全通过后，才允许声明交付完成。

## 12. 需求到验收映射

| 需求 | 开发任务 | 验收场景 | 自动化验证 |
|---|---|---|---|
| 连续多轮委派与整改 | Task 04、Task 05、Task 06 | DS-02、DS-03 | `tests/delivery/delegate-loop.delivery.test.ts` |
| 跨进程会话恢复 | Task 03、Task 05、Task 07 | DS-04 | `tests/delivery/recovery.delivery.test.ts` |
| 会话内模型切换 | Task 05、Task 08 | DS-05 | `tests/integration/session-manager.integration.test.ts` |
| 异常可观测与可回滚 | Task 02、Task 09、Task 10 | DS-06 | `tests/e2e/recover.e2e.test.ts` |
| 错误码准确与幂等防冲突 | Task 06、Task 08 | DS-02、DS-03 | `tests/unit/idempotency-guard.test.ts` |
| 插件可本地安装并加载 | Task 11、Task 12 | DS-07 | `tests/plugin/install.plugin.test.ts` |
| 插件可卸载重装并回滚 | Task 10、Task 11、Task 12 | DS-08 | `tests/plugin/lifecycle.plugin.test.ts` |

## 13. 最终交付清单

- [ ] 代码实现完成。
- [ ] API 契约与错误码实现完成。
- [ ] 数据模型与迁移完成。
- [ ] 单元测试通过。
- [ ] 集成测试通过。
- [ ] 端到端测试通过。
- [ ] 业务交付测试通过。
- [ ] 插件安装测试通过（Desktop + CLI）。
- [ ] 插件卸载/重装/回滚测试通过。
- [ ] 编译通过。
- [ ] 失败记录已闭环处理。
- [ ] Runbook 与相关文档已更新。
- [ ] 插件清单（`.codex-plugin/plugin.json`）已校验通过。
- [ ] 未执行未经授权打包。
- [ ] 未执行未经授权 `git push`。
