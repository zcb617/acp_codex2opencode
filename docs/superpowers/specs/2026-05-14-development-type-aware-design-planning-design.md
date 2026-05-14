# 开发类型感知的方案与计划流程设计文档

## 背景与目标

当前团队委派插件已经支持由主会话判断起始阶段，再把 `start_phase` 传给 `delegate.task.execute`，插件根据阶段进入方案制定、计划制定或计划实施。

当前缺口是：方案制定和计划制定只有“新增功能/业务流程调整”一种文档规则。用户提出 BUG 修改任务时，插件仍会要求 ACP 或主会话按新增功能指南输出文档，导致 BUG 修改需要的失败事实、根因分析、同链路复测目标和整改闭环缺失。

本次新增“开发类型感知”能力。插件不在内部穷举关键词判断开发类型，而是沿用现有阶段判断模式：主会话的大模型先判断开发类型，插件接收明确结果并选择对应文档规则。

目标结果：

- 主会话在 `start` 前同时判断起始阶段和开发类型。
- 插件接收 `development_type` 后选择新增功能或 BUG 修改文档规则。
- 新增功能继续使用现有可交付开发设计/计划指南。
- BUG 修改使用现有可交付 BUG 修改设计/计划指南。
- 如果开发类型不明确，插件进入上下文补充节点，不猜测、不继续执行。
- 工作流恢复、反馈修订、文档补全和后续阶段都沿用首次确认的开发类型。

## 非目标

- 不在插件中实现关键词穷举分类器。
- 不让插件替代主会话理解自然语言。
- 不改变现有 `start_phase` 阶段判断语义。
- 不取消 Design / Planning 审批节点。
- 不改变实施阶段、交付测试阶段和整改阶段的现有闭环。
- 不新增第三类开发类型；当前只支持新增功能和 BUG 修改。
- 不修改 docs 目录下四份指南的正文规范。

## 范围与术语

### 本次范围

- 增加开发类型入参、校验、状态持久化和响应字段。
- 更新团队委派技能，让主会话在调用 `start` 前判断开发类型。
- 更新 ACP 执行 Design / Planning 时的提示词和文档门禁。
- 更新 Design / Planning 反馈和补全文档提示词。
- 补充单元测试、交付测试和安装产物检查。
- 更新 README 和技能文档中的调用说明。

### 本次不涉及范围

- 不改低层 `delegate.turn.run` / `delegate.turn.rework` 工具协议。
- 不改数据库迁移文件，工作流快照继续以 JSON snapshot 保存新增字段。
- 不改模型选择流程。
- 不改已有交付测试通过/失败动作。

### 术语

| 术语 | 定义 |
|---|---|
| 开发类型 | 本次任务属于新增功能还是 BUG 修改。 |
| `feature` | 新增功能或业务流程调整，使用可交付开发设计/计划指南。 |
| `bugfix` | 修复已有能力的错误表现，使用可交付 BUG 修改设计/计划指南。 |
| `need_user_input` | 主会话无法明确判断类型，需要用户补充上下文。 |
| 文档画像 | 插件内部根据开发类型选择的一组指南、必备章节和提示词规则。 |

## 架构与模块职责

### 主会话职责

主会话继续负责自然语言理解。触发 `team-delegate` 后，主会话必须在调用 `delegate.task.execute(action=start)` 前形成两个明确判断：

- 起始阶段：`design` / `planning` / `implementation` / `need_user_input`
- 开发类型：`feature` / `bugfix` / `need_user_input`

判断不清时，主会话传 `need_user_input` 并写明缺失上下文。

### 插件工具层职责

`src/mcp-tools/schemas.ts` 和 `src/plugin/mcp-server.ts` 负责声明并校验新增入参：

- `development_type`
- `development_type_reason`
- `development_type_evidence`

工具层只做结构校验，不做自然语言分类。

### 工作流服务职责

`src/session/bridge-service.ts` 负责：

- 解析开发类型决策。
- 在 `NEEDS_USER_INPUT` 中返回缺失类型上下文。
- 将开发类型写入 `TaskWorkflowState`。
- 将开发类型写入 workflow snapshot 并在恢复时读回。
- 根据开发类型选择 Design / Planning 提示词。
- 根据开发类型选择必备章节门禁。
- 在业务响应中暴露当前文档画像，帮助主会话使用正确指南。

### 技能文档职责

`skills/team-delegate/SKILL.md` 负责约束主会话：

- 先判断阶段和开发类型，再调用 `start`。
- 新增功能走新增功能指南。
- BUG 修改走 BUG 修改指南。
- 类型不清时只补充上下文，不进入本地开发或 ACP 执行。

## 技术选型与约束

- 继续使用 TypeScript 和现有 zod schema。
- 继续使用 JSON snapshot 持久化工作流状态。
- 不新增运行时依赖。
- 不新增数据库迁移。
- 新增类型必须向后恢复兼容：旧 snapshot 没有开发类型时，恢复为 `feature`，并在状态响应中暴露该兼容来源。
- 新的 `start` 请求没有 `development_type` 时，插件返回 `NEEDS_USER_INPUT`；不默认猜成 `feature`。
- 已启动的 workflow 不能中途切换开发类型；反馈和修订阶段必须沿用 workflow 中保存的类型。

## API 契约

### `delegate.task.execute`

用途：团队委派高层入口。

新增输入字段：

| 字段 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| `development_type` | enum | start 时必填 | `feature` / `bugfix` / `need_user_input` | 主会话判断出的开发类型。 |
| `development_type_reason` | string | 否 | 无 | 主会话判断开发类型的原因。 |
| `development_type_evidence` | string[] | 否 | 空数组 | 支持开发类型判断的上下文证据。 |

示例：新增功能从方案阶段开始。

```json
{
  "workspace_path": "D:/repo",
  "requirement_text": "给插件增加 BUG 修改文档流程",
  "session_alias": "development-type-flow",
  "action": "start",
  "start_phase": "design",
  "start_phase_reason": "当前还没有完整方案",
  "development_type": "feature",
  "development_type_reason": "本次是在插件里新增一种流程能力"
}
```

示例：BUG 修改从方案阶段开始。

```json
{
  "workspace_path": "D:/repo",
  "requirement_text": "修复恢复后找不到委派流程的问题",
  "session_alias": "workflow-recovery-bug",
  "action": "start",
  "start_phase": "design",
  "start_phase_reason": "当前缺少 BUG 修改设计",
  "development_type": "bugfix",
  "development_type_reason": "用户描述的是已有流程恢复失败"
}
```

示例：开发类型不明确。

```json
{
  "workspace_path": "D:/repo",
  "requirement_text": "处理一下团队委派流程",
  "session_alias": "unclear-development-type",
  "action": "start",
  "start_phase": "need_user_input",
  "development_type": "need_user_input",
  "missing_context": [
    "请明确这是新增功能还是修复已有问题"
  ]
}
```

新增响应字段：

| 字段 | 类型 | 字段作用（中文） |
|---|---|---|
| `detected_development_type` | string/null | 插件接收到并采用的开发类型。 |
| `development_type_evidence` | string[] | 类型判断证据。 |
| `document_profile` | object/null | 当前开发类型对应的文档指南和必备章节。 |

`document_profile` 示例：

```json
{
  "development_type": "bugfix",
  "design_guide": "docs/可交付BUG修改设计文档编写指南-v0.1.md",
  "planning_guide": "docs/可交付BUG修改计划编写指南-v0.1.md",
  "design_required_sections": [
    "问题摘要",
    "失败事实",
    "影响范围",
    "根因分析",
    "修复目标与非目标",
    "修复设计",
    "修改范围",
    "自动化验证目标",
    "交付测试目标",
    "风险与回退",
    "上下文恢复说明"
  ],
  "planning_required_sections": [
    "Bug 与设计来源",
    "设计目标覆盖表",
    "实施任务拆分",
    "TDD 与红灯测试计划",
    "自动化验证计划",
    "真实业务交付测试计划",
    "交付测试失败整改记录",
    "设计完成核对清单",
    "上下文恢复说明"
  ]
}
```

失败响应：

```json
{
  "workflow_status": "NEEDS_USER_INPUT",
  "business_stage": "上下文补充",
  "business_reason": "当前信息还不足以判断开发类型。",
  "next_business_action": "补充这是新增功能还是 BUG 修改",
  "missing_context": [
    "development_type（feature/bugfix/need_user_input）"
  ]
}
```

错误码说明：

| 场景 | 结果 | 是否可重试 |
|---|---|---|
| 缺少 `development_type` | 返回 `NEEDS_USER_INPUT` | 是 |
| `development_type=need_user_input` | 返回 `NEEDS_USER_INPUT` | 是 |
| schema 中出现非法枚举值 | zod 校验失败 | 否 |
| 旧 workflow 恢复时缺少开发类型 | 恢复为 `feature` 并继续 | 是 |

## 数据模型

### `ExecuteTaskInput`

| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| `development_type` | `"feature" \| "bugfix" \| "need_user_input"` | start 时必填 | 无 | 表示主会话判断出的开发类型。 |
| `development_type_reason` | string | 否 | 无 | 记录主会话判断开发类型的业务原因。 |
| `development_type_evidence` | string[] | 否 | 空数组 | 记录主会话判断类型的证据。 |

### `TaskWorkflowState`

| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| `developmentType` | `"feature" \| "bugfix"` | 是 | 旧 snapshot 恢复为 `feature` | 决定 Design / Planning 使用哪套指南和门禁。 |
| `developmentTypeEvidence` | string[] | 是 | 空数组 | 保存开发类型判断证据，供恢复和审计使用。 |

本表核心职责：`TaskWorkflowState` 是一次团队委派业务流程的运行状态，开发类型必须和阶段、模型、交付测试状态一起持久化，避免恢复后切回错误文档规则。

### Workflow Snapshot

新增 JSON 字段：

```json
{
  "developmentType": "feature",
  "developmentTypeEvidence": [
    "主会话判定开发类型: feature；理由: 本次新增插件能力"
  ]
}
```

## 主流程与状态机

### 入口判断流程

```text
用户提出团队委派需求
-> 主会话判断 start_phase
-> 主会话判断 development_type
-> 调用 delegate.task.execute(action=start)
-> 插件校验两个判断是否明确
-> 明确则进入对应业务阶段
-> 不明确则进入上下文补充
```

### Design 阶段文档规则

| 开发类型 | 指南 | 必备章节 |
|---|---|---|
| `feature` | `docs/可交付开发设计文档编写指南-v0.1.md` | 背景与目标、非目标、范围与术语、架构与模块职责、技术选型与约束、API 契约、数据模型、主流程与状态机、异常处理策略矩阵、幂等与去重规则、测试策略、验收标准、发布与回滚 Runbook、SLO 与告警、环境配置矩阵、开发实施规范 |
| `bugfix` | `docs/可交付BUG修改设计文档编写指南-v0.1.md` | 问题摘要、失败事实、影响范围、根因分析、修复目标与非目标、修复设计、修改范围、自动化验证目标、交付测试目标、风险与回退、上下文恢复说明 |

### Planning 阶段文档规则

| 开发类型 | 指南 | 必备章节 |
|---|---|---|
| `feature` | `docs/可交付开发计划编写指南-v0.1.md` | 项目与目标、硬约束、范围与非范围、交付完成定义、业务交付场景、自测命令、失败修复与复测机制、技术设计与模块边界、API、数据模型与配置、开发任务拆分、测试策略、需求到验收映射、最终交付清单 |
| `bugfix` | `docs/可交付BUG修改计划编写指南-v0.1.md` | Bug 与设计来源、设计目标覆盖表、实施任务拆分、TDD 与红灯测试计划、自动化验证计划、真实业务交付测试计划、交付测试失败整改记录、设计完成核对清单、上下文恢复说明 |

### 状态迁移

| 事件 | 前置状态 | 目标状态 | 用户可见动作 |
|---|---|---|---|
| 缺少开发类型 | start | `NEEDS_USER_INPUT` | 提示补充新增功能或 BUG 修改。 |
| 开发类型为 `need_user_input` | start | `NEEDS_USER_INPUT` | 提示补充任务类型。 |
| 类型为 `feature` 且阶段为 design | start | `NEEDS_MAIN_DESIGN` 或 `RUNNING_DESIGN` | 使用新增功能设计指南。 |
| 类型为 `bugfix` 且阶段为 design | start | `NEEDS_MAIN_DESIGN` 或 `RUNNING_DESIGN` | 使用 BUG 修改设计指南。 |
| 类型为 `feature` 且阶段为 planning | start | `NEEDS_MAIN_PLANNING` 或 `RUNNING_PLANNING` | 使用新增功能计划指南。 |
| 类型为 `bugfix` 且阶段为 planning | start | `NEEDS_MAIN_PLANNING` 或 `RUNNING_PLANNING` | 使用 BUG 修改计划指南。 |
| 反馈修订 | `WAITING_DESIGN_APPROVAL` / `WAITING_PLAN_APPROVAL` | 对应运行态 | 沿用 workflow 中保存的开发类型。 |
| 恢复 workflow | 已持久化状态 | 原状态或恢复决策状态 | 响应中展示保存的开发类型。 |

## 异常处理策略矩阵

| 异常层级 | 典型场景 | 处理动作 | 是否丢弃记录 | 是否重试 | 记录位置 | 对主流程影响 |
|---|---|---|---|---|---|---|
| 请求级 | `start` 缺少 `development_type` | 返回 `NEEDS_USER_INPUT`，列出缺失字段 | 否 | 是 | audit `task.execute.start.needs-user-input` | 不进入模型选择或 ACP |
| 请求级 | `development_type=need_user_input` | 返回 `NEEDS_USER_INPUT`，沿用 `missing_context` | 否 | 是 | audit | 等待用户补充 |
| 请求级 | 非法开发类型枚举 | schema 校验失败 | 是 | 否 | MCP 工具错误响应 | 请求失败 |
| 文档级 | BUG 修改设计缺少“失败事实” | 文档门禁触发 rework 补全 | 否 | 是 | workflow steps | 不进入审批 |
| 文档级 | BUG 修改计划缺少“TDD 与红灯测试计划” | 文档门禁触发 rework 补全 | 否 | 是 | workflow steps | 不进入审批 |
| 恢复级 | 旧 snapshot 无开发类型 | 默认恢复为 `feature` 并在 evidence 说明兼容恢复 | 否 | 是 | workflow snapshot | 继续旧流程 |
| 系统级 | 持久化 workflow 失败 | 返回现有错误逻辑 | 否 | 是 | logger/audit | 不声明完成 |

## 幂等与去重规则

- 同一 `workspace_path + session_alias` 已存在 workflow 时，重复 `start` 返回已有 workflow 状态，不重新采用新的 `development_type`。
- 已存在 workflow 的开发类型以 snapshot 中的 `developmentType` 为准。
- `model_confirm` 和 `model_select` 使用缓存的 start 输入，必须保留 `development_type`。
- Design / Planning 门禁 rework 的幂等键继续使用现有 `workflow-{workflowId}-{phase}-gate-{attempt}` 格式。
- 反馈修订不允许通过新入参改变开发类型；如果用户要改变类型，必须取消当前流程并重新开始。

## 测试策略

### 单元测试

- `tests/unit/bridge-service-workflow.test.ts`
  - 缺少 `development_type` 时返回 `NEEDS_USER_INPUT`。
  - `development_type=need_user_input` 时返回 `NEEDS_USER_INPUT`。
  - `feature` 类型 Design prompt 使用新增功能设计指南和章节。
  - `bugfix` 类型 Design prompt 使用 BUG 修改设计指南和章节。
  - `feature` 类型 Planning prompt 使用新增功能计划指南和章节。
  - `bugfix` 类型 Planning prompt 使用 BUG 修改计划指南和章节。
  - workflow snapshot 能保存并恢复 `developmentType`。

### 集成测试

- `tests/integration/delegate-tools.integration.test.ts`
  - 工具 schema 接受 `development_type=feature` 和 `bugfix`。
  - 工具 schema 拒绝非法开发类型。

### 插件测试

- `tests/plugin/install.plugin.test.ts`
  - 安装产物中的 skill 包含开发类型判断规则。
  - MCP 工具 schema 包含 `development_type`。

### 交付测试

- `tests/delivery/team-delegate-skill.delivery.test.ts`
  - skill 要求主会话同时判断阶段和开发类型。
  - skill 明确禁止插件用关键词穷举判断类型。
  - skill 明确 BUG 修改必须走 BUG 修改指南。

真实业务交付测试必须从插件安装后的 Codex CLI 入口开始，使用自然语言触发团队委派流程，观察主会话是否会在调用插件前判断开发类型，并在 BUG 修改场景中选择 BUG 修改文档规则。

## 验收标准

- `delegate.task.execute(action=start)` 缺少开发类型时，不进入模型选择，不启动 ACP，返回 `NEEDS_USER_INPUT`。
- 主会话传 `development_type=feature` 时，Design / Planning 使用新增功能指南和新增功能必备章节。
- 主会话传 `development_type=bugfix` 时，Design / Planning 使用 BUG 修改指南和 BUG 修改必备章节。
- Design / Planning 反馈和补全文档仍沿用 workflow 中保存的开发类型。
- workflow 恢复后响应中仍能看到原开发类型。
- `team-delegate` skill 明确要求主会话判断开发类型，且不允许插件关键词穷举。
- 自动化测试通过：`npm run test:unit`、`npm run test:integration`、`npm run test:plugin-install`、`npm run test:delivery`、`npm run build`、`npm run prepare:plugin`。
- 真实业务交付测试通过：自然语言 BUG 修改任务能进入 BUG 修改设计/计划规则，自然语言新增功能任务能进入新增功能设计/计划规则。

## 发布与回滚 Runbook

### 发布步骤

1. 在插件仓库分支完成实现。
2. 执行自动化验证命令。
3. 执行 `npm run prepare:plugin` 生成插件安装产物。
4. 执行 `npm run plugin:install-local` 安装本地插件。
5. 重启或刷新 Codex 使用环境。
6. 在 Codex CLI 中分别验证新增功能任务和 BUG 修改任务。

### 回滚步骤

1. 停止当前 Codex CLI 流程。
2. 使用 git 回退本次分支改动，或切回上一个稳定提交。
3. 执行 `npm run prepare:plugin`。
4. 执行 `npm run plugin:install-local` 重新安装旧产物。
5. 重启或刷新 Codex 使用环境。
6. 使用新增功能场景验证旧流程仍可用。

### 回滚触发条件

- 安装后 skill 无法加载。
- `delegate.task.execute` schema 无法注册。
- 新增功能场景被错误要求 BUG 修改文档。
- BUG 修改场景仍输出新增功能文档规则。
- 已有实施和交付测试闭环出现回归。

## SLO 与告警

| 指标 | 目标 | 采集方式 | 告警条件 |
|---|---|---|---|
| 类型缺失拦截准确率 | 100% | 单元测试和交付测试 | 缺少类型仍进入模型选择 |
| BUG 修改文档门禁覆盖率 | 100% | 单元测试 | BUG 修改缺少关键章节仍通过 |
| 新增功能回归通过率 | 100% | 现有测试 | 现有新增功能测试失败 |
| 安装产物可用性 | 100% | `npm run prepare:plugin` 和安装测试 | 安装产物缺少 skill 或 schema |

## 数据保留与清理策略

- `developmentType` 和 `developmentTypeEvidence` 随 workflow snapshot 保存。
- 保存周期沿用现有 workflow 记录保留策略。
- 不新增独立数据文件。
- 用户取消或完成 workflow 后，清理策略沿用现有 workflow 记录逻辑。
- 旧 snapshot 缺少 `developmentType` 时只在恢复内存态补默认值，不回写迁移历史记录。

## 环境配置矩阵

| 环境 | 配置 | 预期行为 |
|---|---|---|
| dev | 本地源码运行 Vitest | 单元、集成、交付测试覆盖开发类型分流。 |
| local plugin | `npm run plugin:install-local` | Codex 加载更新后的 skill 和 MCP schema。 |
| real CLI | 用户真实 Codex CLI | 主会话能根据自然语言判断开发类型并传给插件。 |
| old workflow snapshot | 缺少 `developmentType` | 恢复为 `feature`，不阻断旧流程。 |

## 开发实施规范

- 所有代码修改在插件仓库 `D:\zhangcb\my_wiki\coding\acp_codex2opencode` 内完成。
- 开发前必须位于 `codex/` 前缀分支。
- 不使用外层 `my_wiki` git 仓库提交插件改动。
- 先写失败测试，再写实现。
- 只修改开发类型分流相关文件，不做无关重构。
- 公共类型放在 `src/session/bridge-service.ts` 现有 workflow 类型区域；schema 变更放在 `src/mcp-tools/schemas.ts` 和 `src/plugin/mcp-server.ts`。
- 文档画像常量必须集中定义，避免 Design / Planning 提示词和门禁章节分散复制。
- 用户可见表达必须使用业务语言：“新增功能文档规则”“BUG 修改文档规则”，内部字段名只作为辅助信息。
- 未经用户授权不执行 `git push`。
