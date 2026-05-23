# 实施执行方选择与主会话实施分流设计文档

## 1. 背景与目标

当前团队委派插件已经能完成从一句话需求进入方案制定、计划制定以及实施前门禁校验的业务链路，但在 `planning_approve` 之后，流程会直接进入 ACP 模型确认/选择，并默认把“实施阶段”理解为“继续由 ACP 托管执行”。

这会带来两个业务问题：

1. 插件没有在“计划已经确认，接下来由谁实施”这个真正的业务分叉点停住，用户不能在实施入口显式决定是继续交给 ACP，还是改由主会话接手。
2. 插件当前把“实施”与“ACP 执行闭环”绑定得过紧，导致用户即使只想使用插件完成需求收敛、方案制定、计划制定和实施门禁控制，也必须继续进入 ACP 模型选择与后续委派闭环。

本次设计的目标是把插件的业务定位收敛为两段能力：

1. 从一句话需求推进到方案和计划，并用门禁控制“哪些可以进入下一阶段、哪些不能进入下一阶段”。
2. 在计划确认后，明确停在“实施执行方选择”节点，让用户决定后续实施是继续交给 ACP，还是转由主会话完成。

设计后的业务结果必须满足：

1. `planning_approve` 后不再直接进入 ACP 模型选择，而是先进入“实施执行方选择”。
2. 选择 `ACP 实施` 时，才进入现有 ACP 模型确认/选择以及后续实施闭环。
3. 选择 `主会话实施` 时，插件本次闭环到此结束，后续编码、自动化测试、真实交付测试和失败修复全部由主会话负责，不再回流 ACP。
4. 插件在“主会话实施”路径下要以业务语言明确告知：当前已完成需求、方案、计划和实施入口门禁控制，后续已经转交主会话继续处理。

## 2. 非目标

本次设计明确不做以下内容：

1. 不改动方案制定和计划制定的默认执行规则；它们仍然默认由主会话执行，用户显式选择 ACP 时才进入 ACP。
2. 不改动 ACP 实施路径下现有的持续跟进、无进展决策、真实交付测试、整改闭环和 1-2 分钟跟进节奏。
3. 不引入“主会话实施完成后再回填插件继续交付测试”的中间回流机制。
4. 不把“主会话实施”设计成新的整改入口；一旦用户选择主会话实施，后续全部不再交给 ACP。
5. 不重构 `delegate.session.*` / `delegate.turn.*` 低层协议，也不改变现有 `task_id` / `session_alias` 的基本含义。

## 3. 范围与术语

### 3.1 本次范围

1. 新增“实施执行方选择”业务节点。
2. 调整实施入口前的状态机与动作契约。
3. 调整 README、`team-delegate` skill 和测试，使“插件负责到计划，实施可分流”的业务定位一致。
4. 保证实施门禁仍然先校验计划完整性，再允许进入执行方选择。

### 3.2 术语

- 实施执行方选择：计划确认完成后，插件停住等待用户选择由谁进入实施阶段的业务节点。
- ACP 实施：继续由插件编排 ACP 完成实施、持续跟进、交付测试和整改闭环的路径。
- 主会话实施：用户在实施入口主动选择由主会话继续处理，插件闭环就此结束的路径。
- 插件闭环：由 `delegate.task.execute` 状态机托管的业务流程，包括状态推进、模型闸门、持续跟进、交付测试与整改闭环。

## 4. 架构与模块职责

### 4.1 `src/session/bridge-service.ts`

负责实施入口的业务状态推进。需要新增“实施执行方选择”节点，调整 `planning_approve` 后的分流逻辑，并定义主会话实施时的状态落点与对外业务文案。

### 4.2 `src/mcp-tools/schemas.ts`

负责 `delegate.task.execute` 的动作与参数契约。需要新增“实施执行方选择”动作，并约束该动作只接受允许的执行方枚举值。

### 4.3 `README.md`

负责对外说明插件的业务定位、状态集合、动作集合和真实使用路径。需要把“计划确认后先选择实施执行方”写成正式契约。

### 4.4 `skills/team-delegate/SKILL.md`

负责主会话的业务编排规则。需要把“只有选择 ACP 实施时才进入模型选择”和“选择主会话实施则插件闭环到此结束”的业务规则同步进去，确保真实 Codex CLI 入口按同一逻辑运行。

### 4.5 自动化测试

负责把新的业务分流固定为回归约束，防止未来又把实施入口重新写回“直接选 ACP 模型”。

## 5. 技术选型与约束

1. 继续使用现有 `delegate.task.execute` 高层入口，不引入新工具。
2. 继续使用现有 workflow 持久化机制，不新增数据库表。
3. 继续使用业务导向表达，不把 `workflow_status`、`next_action_required` 作为首屏文案。
4. 继续沿用现有 `TRANSFERRED_TO_MAIN` 终态语义，但要区分两类来源：
   - ACP 异常后被迫转主会话。
   - 用户在实施入口主动选择转主会话实施。
5. 实施门禁仍然必须先校验计划完整性。计划不完整时，不能出现“实施执行方选择”。

## 6. API 契约

### 6.1 `delegate.task.execute(action=planning_approve)`

- 用途：
  - 用户确认计划文档后，进入实施入口。
- 新行为：
  - 不再直接拉起 ACP 实施或 ACP 模型确认。
  - 返回“实施执行方选择”业务节点。

成功响应示例：

```json
{
  "task_id": "task-implementation-choice",
  "session_alias": "task-implementation-choice",
  "workflow_status": "NEEDS_IMPLEMENTATION_EXECUTOR",
  "business_stage": "实施执行方选择",
  "user_message": "当前方案和计划已经确认。下一步需要确定由谁进入实施阶段：你可以选择继续由主会话实施，或交给 ACP 进入委派实施闭环。",
  "next_business_action": "选择实施执行方",
  "next_action_required": ["implementation_executor_select"],
  "default_option": "1",
  "user_options": [
    {
      "option": "1",
      "label": "主会话继续实施（默认）",
      "action": "implementation_executor_select",
      "implementation_executor": "main"
    },
    {
      "option": "2",
      "label": "ACP 委派实施",
      "action": "implementation_executor_select",
      "implementation_executor": "acp"
    }
  ]
}
```

失败响应示例：

```json
{
  "workflow_status": "NEEDS_USER_INPUT",
  "business_stage": "计划修订",
  "user_message": "当前计划文档仍有缺项，不能进入实施执行方选择。",
  "next_action_required": ["planning_feedback"]
}
```

### 6.2 `delegate.task.execute(action=implementation_executor_select)`

- 用途：
  - 在计划确认后提交“主会话实施 / ACP 实施”的用户选择。
- 请求字段：
  - `implementation_executor`: `main` 或 `acp`

请求体示例：

```json
{
  "workspace_path": "/var/work/acp_codex2opencode",
  "session_alias": "task-implementation-choice",
  "action": "implementation_executor_select",
  "implementation_executor": "main"
}
```

成功响应分两类：

1. 选择 `main`

```json
{
  "workflow_status": "TRANSFERRED_TO_MAIN",
  "business_stage": "转主会话实施",
  "user_message": "当前需求、方案、计划和实施前门禁已经完成。你已选择由主会话继续实施，后续编码、自动化测试、真实交付测试和失败修复将全部由主会话负责。",
  "next_business_action": null,
  "next_action_required": null
}
```

2. 选择 `acp`

```json
{
  "workflow_status": "NEEDS_MODEL_CONFIRM",
  "business_stage": "计划实施",
  "user_message": "当前方案和计划已经确认，你已选择交给 ACP 进入实施闭环。请为本次计划实施确认或选择执行模型。",
  "next_action_required": ["model_confirm"]
}
```

失败响应示例：

```json
{
  "code": "INVALID_REQUEST",
  "message": "implementation_executor_select 需要 implementation_executor"
}
```

### 6.3 `delegate.task.execute(action=start, start_phase=implementation)`

- 用途：
  - 当主对话已经确认方案和计划齐备，可直接进入实施入口时使用。
- 新行为：
  - `start` 仍先做实施前计划门禁校验。
  - 门禁通过后，先进入模型闸门，再在模型确认完成后返回“实施执行方选择”。

说明：

1. 之所以仍保留模型闸门在实施入口前，是为了兼容“用户最后选择 ACP 实施时，当前 workflow 已经具备可继续执行的模型上下文”。
2. 但用户可见体验上，实施入口必须先停在“选择由谁实施”，不能把“ACP 模型选择”当成唯一前置问题。

## 7. 数据模型

### 7.1 `TaskWorkflowState` 新增字段

| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| implementationExecutor | `"main" \| "acp"` | 否 | 默认空 | 记录用户在实施入口最终选择由主会话还是 ACP 执行实施。 |
| transferReason | `"implementation_executor_main" \| "acp_session_unavailable" \| "manual_handoff"` | 否 | 默认空 | 区分当前转主会话是用户主动在实施入口选择，还是 ACP 会话不可用等旧场景。 |

- 本表核心职责：
  - 记录当前委派任务在实施入口的执行方选择与转主会话来源，保证对外业务文案与内部状态一致。

### 7.2 对旧快照的兼容

1. 旧 workflow 快照可能没有 `implementationExecutor` 和 `transferReason`。
2. 读取旧快照时，缺失字段按未选择处理，不影响已完成或已终止状态。
3. 只有进入新的实施执行方选择节点后，才会写入这两个字段。

## 8. 主流程与状态机

### 8.1 新状态

新增业务状态：

- `NEEDS_IMPLEMENTATION_EXECUTOR`

业务语义：

- 方案和计划已确认；
- 实施前计划门禁已通过；
- 当前需要用户选择由谁进入实施阶段。

### 8.2 状态迁移

```text
WAITING_PLAN_APPROVAL
  -- planning_approve -->
NEEDS_IMPLEMENTATION_EXECUTOR
  -- implementation_executor_select(main) -->
TRANSFERRED_TO_MAIN

NEEDS_IMPLEMENTATION_EXECUTOR
  -- implementation_executor_select(acp) -->
NEEDS_MODEL_CONFIRM / NEEDS_MODEL_SELECTION
  -- model_confirm/model_select -->
RUNNING_IMPLEMENTATION
```

### 8.3 关键业务规则

1. `planning_approve` 不再直接进入 `RUNNING_IMPLEMENTATION`。
2. `planning_approve` 后必须先返回 `NEEDS_IMPLEMENTATION_EXECUTOR`。
3. 只有用户明确选择 `acp` 时，才允许进入 ACP 模型确认/选择。
4. 用户选择 `main` 时，workflow 直接进入 `TRANSFERRED_TO_MAIN`，且原因必须记录为 `implementation_executor_main`。
5. 选择 `main` 后，不再允许对同一个任务继续调用：
   - `model_confirm`
   - `model_select`
   - `status`
   - `delivery_test_pass`
   - `delivery_test_fail`
   - `remediation_approve`
6. 选择 `main` 后，后续全部业务责任都转交主会话，插件不再对该任务继续托管。

## 9. 异常处理策略矩阵

| 异常层级 | 典型场景 | 处理动作 | 是否丢弃记录 | 是否重试 | 记录位置 | 对主流程影响 |
|---|---|---|---|---|---|---|
| 业务级 | 计划门禁未通过 | 返回 `NEEDS_USER_INPUT/计划修订`，不出现实施执行方选择 | 否 | 否 | workflow 响应体 | 用户先修计划，主流程暂停 |
| 业务级 | `implementation_executor_select` 缺少 `implementation_executor` | 返回参数错误 | 否 | 用户修正后可重试 | 工具错误响应 | 当前动作失败，workflow 保持在选择节点 |
| 业务级 | 在非 `NEEDS_IMPLEMENTATION_EXECUTOR` 状态调用 `implementation_executor_select` | 返回非法状态迁移 | 否 | 否 | workflow 错误响应 | 拒绝越级操作 |
| 系统级 | 选择 `acp` 后模型列表读取失败 | 返回模型选择失败 | 否 | 是 | 系统日志、错误响应 | 无法进入 ACP 实施 |
| 业务级 | 选择 `main` 后又继续尝试走 ACP 状态动作 | 返回“当前任务已转主会话实施” | 否 | 否 | workflow 错误响应 | 防止闭环语义混乱 |

## 10. 幂等与去重规则

1. `planning_approve` 对同一任务只允许把 workflow 推进到一个实施入口节点。
2. `implementation_executor_select` 在同一任务上只允许第一次有效选择生效。
3. 一旦已选择 `main` 并进入 `TRANSFERRED_TO_MAIN`，同一任务不得再重新选择 `acp`。
4. 若用户希望重新回到 ACP 路径，必须从新的任务重新发起，不允许在旧任务上逆转 `TRANSFERRED_TO_MAIN`。

## 11. 测试策略

### 11.1 单元测试

1. `planning_approve` 后返回 `NEEDS_IMPLEMENTATION_EXECUTOR`。
2. `implementation_executor_select(main)` 后返回 `TRANSFERRED_TO_MAIN`，且业务文案明确说明后续全部由主会话负责。
3. `implementation_executor_select(acp)` 后才进入现有模型确认/选择。
4. 非法状态下调用 `implementation_executor_select` 会被拒绝。

### 11.2 集成测试

1. `ExecuteTaskSchema` 支持新动作和新字段。
2. README、skill 与测试契约一致，不再要求“计划确认后直接选 ACP 模型”。

### 11.3 端到端/交付测试

1. 真实 Codex CLI 入口下，计划确认后会先出现“实施执行方选择”。
2. 选择 `主会话继续实施` 后，插件闭环结束，主会话继续处理后续工作。
3. 选择 `ACP 委派实施` 后，仍保持现有 ACP 持续跟进与整改闭环。

### 11.4 并发与稳定性测试

1. 连续重复提交 `planning_approve` 不会生成多个实施执行方选择节点。
2. 连续重复提交 `implementation_executor_select(main)` 不会重复创建后续动作。
3. 已经 `TRANSFERRED_TO_MAIN` 的任务不会再被 `status` 拉起。

## 12. 验收标准

1. 用户在计划确认后，一定先看到“实施执行方选择”，而不是直接看到 ACP 模型选择。
2. 用户选择 `主会话继续实施` 后，插件明确结束闭环，且不再接受后续 ACP 闭环动作。
3. 用户选择 `ACP 委派实施` 后，才进入现有 ACP 模型确认/选择与实施闭环。
4. 实施前计划门禁保持有效；计划缺项时不能出现实施执行方选择。
5. README、skill、schema、bridge-service、测试对“插件负责到计划，实施可分流”的语义保持一致。

## 13. 发布与回滚 Runbook

### 13.1 发布步骤

1. 更新 `bridge-service`、schema、README、skill 与测试。
2. 执行单元测试、交付测试脚本和构建。
3. 本地重新安装插件。
4. 用真实 Codex CLI 跑实施执行方选择链路。

### 13.2 回滚步骤

1. 若发现实施入口分流破坏现有 ACP 实施路径，回滚到本次提交前版本。
2. 回滚后重新验证：
   - 计划确认后是否恢复旧的 ACP 实施入口；
   - 既有持续跟进交付闭环是否恢复。

## 14. SLO 与告警

1. 该改动不引入新的性能 SLO。
2. 关键可观测点是业务分叉是否正确：
   - `planning_approve` 后应出现一次“实施执行方选择”；
   - `implementation_executor_select(main)` 后应落到 `TRANSFERRED_TO_MAIN`；
   - `implementation_executor_select(acp)` 后应落到模型闸门或实施运行态。
3. 若出现“选择主会话实施后仍然允许 delivery_test_pass/fail”或“计划确认后直接跳过选择节点进入模型选择”，视为回归缺陷。

## 15. 数据保留与清理策略

1. `TRANSFERRED_TO_MAIN` 的 workflow 仍按现有终态持久化策略保留。
2. 终态保留的核心意义是保留业务审计证据，证明该任务是在实施入口主动转交主会话，而不是异常失败。
3. 不新增额外清理策略。

## 16. 环境配置矩阵

| 环境 | 入口方式 | 必须验证内容 |
|---|---|---|
| 开发环境 | `vitest` + 本地插件安装 | 状态机、schema、README/skill 契约一致性 |
| 真实 Codex CLI 环境 | 插件安装后自然语言入口 | 计划确认后实施执行方选择、主会话实施分流、ACP 实施分流 |

## 17. 开发实施规范

1. 状态机变更优先落在 `bridge-service.ts`，避免把业务分叉散落到多处判断。
2. schema 必须只暴露必要动作与字段，动作名要直接对应业务语义。
3. README 与 skill 的业务表达必须同步，避免真实交付测试通过不了。
4. 测试必须先固定状态与文案契约，再进入实现。

## 18. 交付测试设计承诺映射

| 设计承诺 | 来源章节 | 项目类型 | 真实入口 | 用例卡 | 证据要求 |
|---|---|---|---|---|---|
| 计划确认后必须先出现实施执行方选择 | 主流程与状态机 / 验收标准 | Codex 插件 | Codex CLI 自然语言团队委派入口 | DT-01 | 入口对话、选择节点响应、业务文案 |
| 选择主会话实施后插件闭环结束 | API 契约 / 状态机 / 异常策略 | Codex 插件 | 选择“主会话继续实施” | DT-02 | 选择前响应、选择后终态响应、禁止后续 ACP 动作证据 |
| 选择 ACP 实施后仍保持原实施闭环 | API 契约 / 测试策略 | Codex 插件 | 选择“ACP 委派实施” | DT-03 | 模型确认响应、运行态响应、持续跟进证据 |

## 19. 上下文恢复说明

当前任务已经确认新的业务边界：

1. 插件的核心价值是把需求推进到方案和计划，并在实施前做门禁控制。
2. 实施阶段不再默认必须继续走 ACP。
3. 用户如果选择主会话实施，插件闭环在实施入口终止，后续全部由主会话处理。
4. 用户如果选择 ACP 实施，才继续进入原有模型闸门与实施闭环。

下一步实施时，需要优先关注：

1. `planning_approve` 后不要直接进入 `RUNNING_IMPLEMENTATION`。
2. `NEEDS_IMPLEMENTATION_EXECUTOR` 与 `implementation_executor_select` 的状态和动作命名要前后一致。
3. `TRANSFERRED_TO_MAIN` 的业务文案要区分“主动转主会话实施”和“ACP 异常被迫接手”。
4. 真实交付测试必须覆盖主会话实施与 ACP 实施两条分流。
