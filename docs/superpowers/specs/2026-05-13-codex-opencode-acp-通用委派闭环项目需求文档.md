# 通用 Codex × OpenCode ACP 委派闭环项目需求文档（v0.8 评审版）

文档版本：`v0.8`  
文档日期：`2026-05-13`  
文档状态：`评审版（未冻结）`  
目标版本：`v1.0`  
适用范围：`通用能力（跨项目复用），Windows 首发，后续扩展 macOS/Linux`

## 0. 现状事实（已验证）
1. 本机存在 `opencode`，版本 `1.14.48`，且 `opencode acp` 可启动。
2. ACP `stdio JSON-RPC` 通信可用，已验证 `initialize`、`session/new`、`session/load`、`session/prompt`。
3. `opencode acp` 不支持 `--model` 启动参数；模型可通过配置默认值或会话内 `session/set_config_option` 切换。

## 1. 背景与目标

### 1.1 背景
当前需求是将 OpenCode ACP 能力集成到 Codex 的通用工作流中，实现稳定的任务委派闭环：
1. 下发任务给代理
2. 接收代理反馈
3. 继续下发整改指令
4. 重复以上流程直到达成目标

### 1.2 目标（可量化）
1. 支持单会话连续多轮委派，`session/prompt` 循环不中断。
2. 支持跨进程恢复同一会话（`session/load` 或 `session/resume`）。
3. 支持会话内模型切换，切换成功率 `>= 99%`。
4. 单轮委派从发起到拿到 `stopReason` 成功率 `>= 98%`。
5. 委派桥接层异常可观测，关键失败 100% 可定位。
6. 提供发布与回滚机制，回滚后 10 分钟内恢复可用。

## 2. 非目标（明确不做）
1. 不替代 Codex 原生主代理的推理与执行能力。
2. 不做公网多租户 SaaS 服务，仅做本地/私有运行形态。
3. 不在本期实现图形化管理界面，先提供工具化接口。
4. 不改造 OpenCode 核心实现，仅通过 ACP 标准协议对接。
5. 不自动执行 `git push` 或任何越权远程写操作。

## 3. 范围与术语

### 3.1 范围
| 范围类型 | 内容 |
|---|---|
| In Scope | Codex 内可调用的通用委派桥接能力、ACP 进程管理、会话管理、模型切换、事件流采集、错误与审计日志 |
| Out Scope | 编辑器 UI 插件商店发布流程、OpenCode 自身模型供应商管理、组织级权限中台 |

### 3.2 术语
| 术语 | 定义 |
|---|---|
| ACP | Agent Client Protocol，客户端与代理的 JSON-RPC 协议 |
| MCP | Model Context Protocol，代理访问工具与资源的协议 |
| 委派会话 | Codex 到 OpenCode 的一个持续上下文会话 |
| 委派轮次（Turn） | 一次 `session/prompt` 请求到 `stopReason` 返回的完整周期 |
| 整改轮次 | 基于上一轮结果继续下发修正要求的委派轮次 |
| 桥接器 | 本项目实现的“Codex 调用层 + ACP 客户端层” |

## 4. 架构与模块职责

### 4.1 总体架构
`Codex -> 委派插件入口 -> 委派桥接 MCP Server -> ACP 客户端核心 -> opencode acp 子进程`

### 4.2 模块职责表
| 模块 | 输入 | 输出 | 核心职责 | 失败处理 |
|---|---|---|---|---|
| 委派插件入口 | 用户任务、整改指令 | 标准化工具调用 | 将“委派意图”转为统一 API 调用 | 参数校验失败立即返回 |
| 委派桥接 MCP Server | 工具调用请求 | 工具调用响应 | 对外暴露稳定 API，维护请求上下文 | 返回标准错误码 |
| ACP 客户端核心 | JSON 请求对象 | JSON 响应与事件流 | 管理 `initialize/session/*` 生命周期 | 失败重试或会话降级 |
| 进程监管器 | 启动参数 | 进程句柄与状态 | 启停 `opencode acp`，检测僵尸进程 | 自动回收并记录告警 |
| 会话管理器 | 会话策略与状态 | 会话映射与恢复 | `new/load/resume/close`，保存会话映射 | 回退到 `session/new` |
| 事件采集器 | `session/update` 流 | 结构化事件 | 采集计划、工具调用、消息片段、用量 | 事件丢失触发警报 |
| 配置管理器 | 模型/模式切换请求 | 最新 `configOptions` | 调用 `session/set_config_option` | 不支持时返回不可重试错误 |
| 审计与指标模块 | 请求、响应、异常 | 日志、指标、告警 | 可观测、可追责、可复盘 | 指标写入失败本地降级 |

## 5. 技术选型与约束
| 选型项 | 选择 | 约束 | 演进触发条件 |
|---|---|---|---|
| 运行时 | Node.js 20 + TypeScript | 与 Codex/MCP 生态兼容 | 需要更高并发时可切 Rust |
| ACP 通信 | `stdio` + NDJSON(JSON-RPC 2.0) | 每条消息单行，无嵌入换行 | 未来 ACP HTTP 稳定后可选扩展 |
| 会话持久化 | SQLite + 本地文件目录 | 本地单机场景优先 | 多机共享时迁移到 Postgres |
| 日志策略 | 结构化 JSON 日志 | 严禁落敏感密钥 | 合规要求提高时接 SIEM |
| 进程模型 | 每个活跃桥接器托管单个或受限多个 ACP 进程 | 控制资源占用，防僵尸 | 高并发时引入进程池 |
| 模型选择 | 默认配置 + 会话内配置变更 | `acp` 不支持 `--model` 直传 | 新版本支持后切换启动参数 |

## 6. API 契约（请求/响应示例）

说明：以下为桥接层对 Codex 暴露的统一契约，载体可为 MCP Tool 调用。  
所有接口均返回：`request_id`、`success`、`error`（失败时）。

### 6.1 `POST /v1/delegate/session/init`
用途：初始化或恢复委派会话。

请求示例：
```json
{
  "workspace_path": "D:/repo/demo",
  "session_alias": "task-20260513-001",
  "session_strategy": "auto",
  "preferred_model": "llm-router-openai-responses/gpt-5.4-mini",
  "timeout_ms": 15000
}
```

成功响应示例：
```json
{
  "request_id": "req_01",
  "success": true,
  "data": {
    "bridge_session_id": "bs_01",
    "acp_session_id": "ses_xxx",
    "session_mode": "loaded",
    "current_model": "llm-router-openai-responses/gpt-5.4-mini",
    "config_options": [
      { "id": "model", "currentValue": "llm-router-openai-responses/gpt-5.4-mini" }
    ]
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_01",
  "success": false,
  "error": {
    "code": "ACP_INIT_TIMEOUT",
    "message": "initialize 超时",
    "retryable": true
  }
}
```

幂等键：`workspace_path + session_alias`  
限流规则：每调用方 `20 req/min`

### 6.2 `POST /v1/delegate/turn/run`
用途：发起一轮委派任务。

请求示例：
```json
{
  "bridge_session_id": "bs_01",
  "idempotency_key": "turn-0001",
  "prompt_text": "请分析这个模块并给出修复建议",
  "stream_updates": true,
  "timeout_ms": 120000
}
```

成功响应示例：
```json
{
  "request_id": "req_02",
  "success": true,
  "data": {
    "turn_id": "turn_0001",
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 1000,
      "output_tokens": 220,
      "thought_tokens": 80
    },
    "summary": "返回了3条修复建议"
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_02",
  "success": false,
  "error": {
    "code": "PROMPT_EXEC_FAILED",
    "message": "session/prompt 执行失败",
    "retryable": true
  }
}
```

幂等键：`idempotency_key`（必填，重复提交返回同一轮结果）  
限流规则：每会话并发轮次 `<= 1`，全局并发可配置

### 6.3 `POST /v1/delegate/turn/rework`
用途：基于上一轮结果发整改指令。

请求示例：
```json
{
  "bridge_session_id": "bs_01",
  "idempotency_key": "turn-0002",
  "rework_prompt_text": "请针对第2条建议给出可执行补丁，并补充验证步骤"
}
```

成功响应示例：
```json
{
  "request_id": "req_03",
  "success": true,
  "data": {
    "turn_id": "turn_0002",
    "stop_reason": "end_turn",
    "summary": "输出了补丁方案与验证清单"
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_03",
  "success": false,
  "error": {
    "code": "SESSION_NOT_READY",
    "message": "会话不可用或已关闭",
    "retryable": false
  }
}
```

幂等键：`idempotency_key`  
限流规则：同 `turn/run`

### 6.4 `POST /v1/delegate/session/set-config`
用途：会话级配置变更（重点是模型切换）。

请求示例：
```json
{
  "bridge_session_id": "bs_01",
  "config_id": "model",
  "value": "opencode/big-pickle"
}
```

成功响应示例：
```json
{
  "request_id": "req_04",
  "success": true,
  "data": {
    "config_options": [
      { "id": "model", "currentValue": "opencode/big-pickle" }
    ]
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_04",
  "success": false,
  "error": {
    "code": "CONFIG_VALUE_INVALID",
    "message": "模型值不在候选列表中",
    "retryable": false
  }
}
```

幂等键：`bridge_session_id + config_id + value`  
限流规则：每会话 `30 req/min`

### 6.5 `POST /v1/delegate/turn/cancel`
用途：取消当前轮次（发送 `session/cancel`）。

请求示例：
```json
{
  "bridge_session_id": "bs_01"
}
```

成功响应示例：
```json
{
  "request_id": "req_05",
  "success": true,
  "data": {
    "cancelled": true
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_05",
  "success": false,
  "error": {
    "code": "NO_ACTIVE_TURN",
    "message": "当前无可取消轮次",
    "retryable": false
  }
}
```

幂等键：`bridge_session_id + active_turn_id`  
限流规则：每会话 `10 req/min`

### 6.6 `POST /v1/delegate/session/close`
用途：关闭会话并释放资源。

请求示例：
```json
{
  "bridge_session_id": "bs_01",
  "force": false
}
```

成功响应示例：
```json
{
  "request_id": "req_06",
  "success": true,
  "data": {
    "closed": true
  }
}
```

失败响应示例：
```json
{
  "request_id": "req_06",
  "success": false,
  "error": {
    "code": "SESSION_CLOSE_FAILED",
    "message": "关闭失败",
    "retryable": true
  }
}
```

幂等键：`bridge_session_id`  
限流规则：每会话 `5 req/min`

### 6.7 错误码字典
| HTTP语义 | 业务错误码 | 可重试 | 场景 |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | 否 | 参数缺失或格式错误 |
| 404 | `SESSION_NOT_FOUND` | 否 | 会话不存在 |
| 409 | `TURN_ALREADY_RUNNING` | 否 | 同会话并发轮次冲突 |
| 409 | `IDEMPOTENCY_CONFLICT` | 否 | 幂等键重复但请求体不一致 |
| 422 | `CONFIG_VALUE_INVALID` | 否 | 模型/配置值非法 |
| 429 | `RATE_LIMITED` | 是 | 超过限流阈值 |
| 500 | `PROMPT_EXEC_FAILED` | 是 | 执行失败 |
| 502 | `ACP_PROTOCOL_ERROR` | 是 | 协议帧异常 |
| 503 | `ACP_PROCESS_UNAVAILABLE` | 是 | ACP 进程不可用 |
| 504 | `ACP_INIT_TIMEOUT` | 是 | 初始化或轮次超时 |

## 7. 数据模型（字段含中文作用）

### 7.1 `delegate_sessions`
| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| bridge_session_id | TEXT | 是 | PRIMARY KEY | 桥接层会话主键，供所有接口引用 |
| session_alias | TEXT | 是 | UNIQUE | 业务可读会话别名，支持跨重启恢复 |
| workspace_path | TEXT | 是 | 绝对路径 | 会话对应工作目录 |
| acp_session_id | TEXT | 是 | INDEX | ACP 返回的会话 ID |
| current_model | TEXT | 否 | - | 当前生效模型标识 |
| config_options_json | TEXT | 否 | - | 当前会话配置项快照 |
| process_pid | INTEGER | 否 | - | 对应 ACP 子进程 PID |
| status | TEXT | 是 | `READY` | 会话状态（READY/ACTIVE/CLOSED/ERROR） |
| last_error_code | TEXT | 否 | - | 最近错误码 |
| created_at | DATETIME | 是 | now | 创建时间 |
| updated_at | DATETIME | 是 | now | 更新时间 |

本表核心职责：维护“可恢复、可追踪”的委派会话映射。

### 7.2 `delegate_turns`
| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| turn_id | TEXT | 是 | PRIMARY KEY | 单轮委派主键 |
| bridge_session_id | TEXT | 是 | FK | 所属桥接会话 |
| turn_seq | INTEGER | 是 | INDEX | 会话内轮次序号 |
| turn_type | TEXT | 是 | `run/rework` | 轮次类型（普通委派/整改） |
| idempotency_key | TEXT | 是 | UNIQUE | 幂等去重键 |
| prompt_sha256 | TEXT | 是 | - | 输入内容摘要，用于幂等冲突检测 |
| prompt_text | TEXT | 是 | - | 本轮输入文本 |
| status | TEXT | 是 | `CREATED` | 轮次状态 |
| stop_reason | TEXT | 否 | - | ACP 返回停止原因 |
| usage_json | TEXT | 否 | - | token 使用量与统计 |
| started_at | DATETIME | 否 | - | 开始时间 |
| ended_at | DATETIME | 否 | - | 结束时间 |

本表核心职责：记录每一轮委派生命周期与结果。

### 7.3 `delegate_events`
| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| event_id | TEXT | 是 | PRIMARY KEY | 事件主键 |
| turn_id | TEXT | 是 | FK | 所属轮次 |
| event_seq | INTEGER | 是 | INDEX | 轮次内事件顺序 |
| event_type | TEXT | 是 | - | 事件类型（plan/tool_call/agent_message_chunk 等） |
| payload_json | TEXT | 是 | - | 原始事件载荷 |
| created_at | DATETIME | 是 | now | 事件时间 |

本表核心职责：完整保留流式反馈，支持排障和审计。

### 7.4 `delegate_audit_logs`
| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| audit_id | TEXT | 是 | PRIMARY KEY | 审计记录主键 |
| request_id | TEXT | 是 | INDEX | 请求追踪 ID |
| action | TEXT | 是 | - | 执行动作名称 |
| actor | TEXT | 是 | - | 调用方标识 |
| result_code | TEXT | 是 | - | 执行结果码 |
| detail_json | TEXT | 否 | - | 诊断详情 |
| created_at | DATETIME | 是 | now | 记录时间 |

本表核心职责：形成可追责的操作审计链路。

## 8. 主流程与状态机

### 8.1 主流程
1. 调用 `session/init`，创建或恢复会话。
2. 完成 ACP `initialize` 能力协商。
3. 选择 `session/new` 或 `session/load`/`session/resume`。
4. 返回会话句柄与配置选项。
5. 调用 `turn/run` 发送首轮委派。
6. 持续接收 `session/update` 流式事件。
7. 收到 `session/prompt` 响应并拿到 `stopReason`。
8. 若需整改，调用 `turn/rework`，复用同会话上下文。
9. 达到目标后调用 `session/close` 释放资源。
10. 写入审计、指标、归档日志。

### 8.2 会话状态机
| 事件 | 前置状态 | 目标状态 | 动作 |
|---|---|---|---|
| init_success | NEW | READY | 保存会话映射与配置 |
| first_turn_start | READY | ACTIVE | 标记运行中 |
| turn_completed | ACTIVE | READY | 更新最后结果 |
| turn_failed | ACTIVE | ERROR | 记录错误并触发恢复策略 |
| recover_success | ERROR | READY | 重新绑定会话 |
| close | READY/ACTIVE/ERROR | CLOSED | 关闭会话并清理资源 |

### 8.3 轮次状态机
| 事件 | 前置状态 | 目标状态 | 动作 |
|---|---|---|---|
| create_turn | - | CREATED | 建立轮次记录 |
| send_prompt | CREATED | RUNNING | 发送 `session/prompt` |
| stream_update | RUNNING | RUNNING | 写入事件流 |
| prompt_end_turn | RUNNING | COMPLETED | 记录 `stopReason=end_turn` |
| prompt_cancelled | RUNNING | CANCELLED | 标记取消完成 |
| prompt_failed | RUNNING | FAILED | 记录异常并返回错误 |

## 9. 异常处理策略矩阵
| 异常层级 | 典型场景 | 处理动作 | 是否丢弃记录 | 是否重试 | 记录位置 | 对主流程影响 |
|---|---|---|---|---|---|---|
| 请求级 | 参数不合法 | 直接返回 `INVALID_REQUEST` | 是 | 否 | 审计日志 | 当前请求失败 |
| 轮次级 | `session/prompt` 超时 | 中止轮次并可选重试 | 否 | 是 | turns + audit | 当前轮次失败 |
| 协议级 | 收到非法 JSON 行 | 标记 `ACP_PROTOCOL_ERROR`，重建连接 | 否 | 是 | 系统日志 | 会话短时中断 |
| 会话级 | `session/load` 不支持 | 回退 `session/new` | 否 | 否 | audit | 丢失历史上下文恢复 |
| 进程级 | ACP 进程异常退出 | 自动拉起并恢复映射 | 否 | 是 | process log | 暂时不可用 |
| 配置级 | 模型值非法 | 返回 `CONFIG_VALUE_INVALID` | 是 | 否 | audit | 不影响已有轮次 |
| 取消级 | 用户取消轮次 | 发 `session/cancel` 并等待 `cancelled` | 否 | 否 | events + turns | 当前轮次结束 |

## 10. 幂等与去重规则
1. `session/init` 幂等键：`workspace_path + session_alias`。
2. `turn/run` 与 `turn/rework` 必须带 `idempotency_key`。
3. 同幂等键重复请求：
   1. 请求体一致：返回已有结果或进行中状态。
   2. 请求体不一致：返回 `IDEMPOTENCY_CONFLICT`。
4. 事件去重键：`turn_id + event_seq + payload_hash`。
5. 会话关闭操作幂等，重复关闭返回成功态（`closed=true`）。

## 11. 测试策略（unit/integration/e2e/并发）

### 11.1 单元测试
1. JSON-RPC 编解码与 NDJSON 帧处理。
2. 会话与轮次状态机迁移逻辑。
3. 幂等冲突判定与去重逻辑。
4. 错误码映射与重试策略。

### 11.2 集成测试
1. 桥接器 + 真实 `opencode acp` 的 `initialize/new/prompt/close`。
2. `load/resume` 能力协商与回退逻辑。
3. `set_config_option(model)` 的成功/失败路径。
4. 取消轮次后 `cancelled` 收敛行为。

### 11.3 端到端测试
1. “委派 -> 收反馈 -> 整改 -> 关闭”完整闭环。
2. 跨进程恢复后继续整改轮次。
3. 连续 10 轮任务上下文保持正确。
4. 异常后自动恢复并继续下一轮。

### 11.4 并发/稳定性测试
1. 20 个会话并发初始化与轮次执行。
2. 高频整改循环（每会话 30 轮）内存与句柄稳定性。
3. 进程异常退出注入后恢复能力。
4. 长时运行 8 小时无僵尸进程泄漏。

## 12. 验收标准（量化）
1. 会话初始化成功率 `>= 99%`。
2. `turn/run` 轮次完成率（得到 `stopReason`）`>= 98%`。
3. P95 首包事件延迟 `<= 3s`。
4. P95 单轮完成时长 `<= 120s`（基于中等任务基准集）。
5. 模型切换成功率 `>= 99%`。
6. 取消操作收敛时间 P95 `<= 5s`。
7. 异常请求错误码准确率 `= 100%`。
8. 僵尸 ACP 进程数目标 `= 0`。

## 13. 发布与回滚 Runbook

### 13.1 发布前检查
1. `opencode --version` 与 `opencode acp --help` 可用。
2. 集成测试与 e2e 全通过。
3. 日志目录可写，状态目录权限正常。
4. 关键环境变量齐全。

### 13.2 发布步骤
1. 部署桥接器二进制/脚本与配置。
2. 启用 MCP 工具注册。
3. 执行健康检查：`initialize -> session/new -> session/prompt -> session/close`。
4. 灰度放量至目标用户。

### 13.3 发布后验证
1. 监控成功率与延迟指标。
2. 抽样执行整改闭环任务。
3. 校验审计日志与事件落盘完整性。

### 13.4 回滚步骤
1. 禁用新版桥接器入口，切回上一版本。
2. 清理异常进程并恢复历史稳定配置。
3. 复测健康检查链路。
4. 记录事故单与根因分析。

## 14. SLO 与告警

### 14.1 SLO
1. 可用性：`delegate` 核心接口月可用性 `>= 99.9%`。
2. 轮次完成：`turn/run` 成功闭环率 `>= 98.5%`。
3. 延迟：P95 轮次完成时长 `<= 120s`。

### 14.2 告警阈值
1. 5 分钟窗口内 `ACP_PROCESS_UNAVAILABLE` 比例 `>= 2%`：P1。
2. 15 分钟窗口内 `PROMPT_EXEC_FAILED` 比例 `>= 5%`：P1。
3. 僵尸进程数量 `> 0` 持续 10 分钟：P1。
4. `IDEMPOTENCY_CONFLICT` 异常增长（较日均 >3 倍）：P2。

## 15. 数据保留与清理策略
1. `delegate_sessions`：保留 30 天。
2. `delegate_turns`：保留 30 天。
3. `delegate_events`：保留 14 天。
4. `delegate_audit_logs`：保留 90 天。
5. 清理策略：每日低峰定时清理，分批删除，失败自动重试一次。
6. 审计要求：清理任务必须写入执行报告与删除计数。

## 16. 环境配置矩阵（dev/staging/prod）
| 维度 | dev | staging | prod |
|---|---|---|---|
| 运行模式 | 本地开发 | 内部验证 | 默认稳定 |
| 日志级别 | DEBUG | INFO | INFO/WARN |
| 并发上限 | 5 会话 | 10 会话 | 20 会话（可配置） |
| 轮次超时 | 180s | 150s | 120s |
| 自动恢复 | 开启 | 开启 | 开启 |
| 告警通道 | 本地控制台 | 团队通知 | 正式告警渠道 |

必填环境变量：
| 变量名 | 作用（中文） |
|---|---|
| `OPENCODE_BIN_PATH` | `opencode` 可执行文件路径 |
| `ACP_BRIDGE_STATE_DIR` | 状态与 SQLite 存储目录 |
| `ACP_BRIDGE_LOG_DIR` | 日志目录 |
| `ACP_BRIDGE_LOG_LEVEL` | 日志级别 |
| `ACP_BRIDGE_TURN_TIMEOUT_MS` | 单轮默认超时 |
| `ACP_BRIDGE_MAX_PARALLEL_SESSIONS` | 最大并发会话数 |
| `ACP_BRIDGE_ALLOWED_WORKSPACES` | 允许的工作目录白名单 |
| `OPENCODE_CONFIG_CONTENT` | OpenCode 启动时注入配置（可含默认模型） |

## 17. 开发实施规范（目录、分层、函数拆分）

### 17.1 目录归属规则
| 目录 | 允许内容 | 禁止内容 |
|---|---|---|
| `src/mcp-tools` | 对外工具契约与参数校验 | ACP 协议细节实现 |
| `src/acp-client` | ACP JSON-RPC 通信与会话方法 | 业务编排 |
| `src/session` | 会话生命周期与状态机 | 直接 IO 协议帧处理 |
| `src/store` | SQLite 读写与迁移 | 业务决策 |
| `src/process` | 子进程管理与健康检查 | API 参数解析 |
| `src/observability` | 日志、指标、告警 | 业务逻辑 |
| `tests/unit` | 纯逻辑测试 | 真实进程依赖 |
| `tests/integration` | 与真实 ACP 的集成测试 | UI 端到端场景 |
| `tests/e2e` | 完整闭环验收 | 单函数细节验证 |

### 17.2 分层调用规则
1. 允许调用链：`mcp-tools -> session -> acp-client/process/store`。
2. 禁止 `mcp-tools` 直接操作子进程。
3. 禁止 `store` 反向调用 `session`。
4. `acp-client` 不得依赖 UI 或业务语义。

### 17.3 函数拆分规则
1. 单函数超过 40 行且含 2 类职责必须拆分。
2. 协议解析与业务决策必须分离。
3. 重试策略必须抽为独立组件并可单测。

### 17.4 异常落地规则
1. 输入校验异常：请求级返回，不写会话错误态。
2. 协议异常：写事件与错误码，触发恢复流程。
3. 进程异常：必须有回收动作与告警。
4. 数据落盘异常：记录 `STORE_WRITE_FAILED` 并降级到内存态短期缓存。

### 17.5 测试门禁规则
1. 新增逻辑必须包含 `unit + integration`。
2. 会话生命周期变更必须补充 `e2e`。
3. CI 任一失败禁止发布。

## 18. 信息缺口登记（必须留痕）
| 问题描述 | 影响范围 | 责任人 | 截止时间 | 临时假设 | 风险等级 |
|---|---|---|---|---|---|
| Codex 侧最终插件封装入口命名 | API 稳定性 | 产品决策人 | T+3 天 | 先用 `delegate.*` 前缀 | 中 |
| 是否需要多用户隔离策略 | 会话安全 | 架构决策人 | T+5 天 | 先按单用户本地运行 | 中 |
| 是否需要远程集中日志 | 运维方案 | 运维决策人 | T+7 天 | 先本地日志 + 文件轮转 | 低 |
| 默认模型优先级策略 | 体验一致性 | 业务决策人 | T+3 天 | 会话优先 > 配置默认 > OpenCode 默认 | 中 |
| 告警通知通道标准 | 监控可达性 | 运维决策人 | T+7 天 | 先控制台 + 文件告警 | 低 |

## 19. 假设管理（可回收）
| 假设内容 | 生效范围 | 失效条件 | 验证时间点 |
|---|---|---|---|
| ACP 协议版本使用 v1 即可满足需求 | 全链路 | OpenCode 升级破坏兼容 | 首次集成测试与每次升级回归 |
| 单机 SQLite 足够支撑当前并发 | 本地运行 | 并发 > 20 会话或 IO 抖动明显 | 压测阶段 |
| 整改循环主要基于文本输入即可 | 委派轮次 | 需要多模态输入（图像/文件块） | 首轮试运行后 |
| 默认使用 `session/load` 恢复历史上下文 | 恢复路径 | 目标 Agent 禁止 load | 集成验收阶段 |

## 20. 需求到验收映射
| 核心需求 | 设计条目 | 实现位置 | 测试用例 | 验收标准 |
|---|---|---|---|---|
| 连续委派整改循环 | 第 8 章 | `session` + `acp-client` | e2e-loop-01 | 连续 10 轮无中断 |
| 跨进程会话恢复 | 第 4/8 章 | `session` | integration-load-01 | 恢复成功率 >=99% |
| 会话模型切换 | 第 6.4 章 | `acp-client` | integration-model-01 | 切换成功率 >=99% |
| 异常可回滚 | 第 9/13 章 | `process` + `observability` | e2e-recover-01 | 10 分钟内恢复可用 |
| 可观测审计 | 第 7/14 章 | `store` + `observability` | integration-audit-01 | 关键请求 100%可追踪 |

## 21. 文档完成定义（DoD）
1. 无 `TBD/TODO` 关键占位项。
2. 第 3 章标准结构全部覆盖。
3. API、数据模型、异常矩阵、状态机、验收指标均可执行。
4. 发布与回滚可由非作者独立执行。
5. 评审通过后升版为 `v1.0` 并冻结。

## 22. 建议配套交付物
1. 错误码手册（独立文档）。
2. 测试计划与验收清单（独立文档）。
3. 运行手册 Runbook（独立文档）。
4. ADR 决策记录（至少 3 份：会话持久化、模型策略、并发模型）。

## 参考依据
1. [OpenCode ACP Support](https://opencode.ai/docs/acp/)
2. [OpenCode Models](https://opencode.ai/docs/models/)
3. [OpenCode Config](https://opencode.ai/docs/config/)
4. [ACP Transports](https://agentclientprotocol.com/protocol/transports)
5. [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
6. [ACP Prompt Turn](https://agentclientprotocol.com/protocol/prompt-turn)
7. [ACP Session Config Options](https://agentclientprotocol.com/protocol/session-config-options)
