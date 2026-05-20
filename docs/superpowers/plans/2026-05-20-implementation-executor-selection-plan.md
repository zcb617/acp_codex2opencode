# 实施执行方选择与主会话实施分流开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用任务编号追踪，不允许跳过红灯测试、自动化验证和真实交付测试。

**Goal:** 让团队委派插件在计划确认后先停在“实施执行方选择”，并支持“主会话实施即结束插件闭环、ACP 实施则继续原闭环”的业务分流。

**Architecture:** 在现有 workflow 状态机上新增实施执行方选择节点与动作；`planning_approve` 后先进入该节点。选择 `main` 时复用 `TRANSFERRED_TO_MAIN` 终态并改写业务语义，选择 `acp` 时再进入现有模型闸门与实施闭环。

**Tech Stack:** TypeScript、Zod、Vitest、Codex plugin workflow state machine

---

## 1. 项目与目标

本计划要把团队委派插件的业务边界重新收敛为“负责把需求推进到方案和计划，并在实施前做门禁控制；实施阶段由用户选择继续交给 ACP，还是转由主会话继续处理”。

当前痛点不是代码没有实现，而是实施入口缺少业务分叉：计划一确认就直接进入 ACP 模型选择，用户无法在真正进入实施前决定是否继续走 ACP 闭环。交付后应达到的效果是：

1. 计划确认后，插件先停在“实施执行方选择”。
2. 选 `主会话继续实施` 时，插件闭环结束，主会话接手后续全部工作。
3. 选 `ACP 委派实施` 时，继续走现有 ACP 模型确认、持续跟进、交付测试和整改闭环。

本计划不处理主会话实施完成后再回流插件，也不处理 ACP 闭环内部持续跟进策略重构。

设计来源：

- `docs/superpowers/specs/2026-05-20-implementation-executor-selection-design.md`

## 2. 硬约束

1. 所有文档与用户提示必须使用中文。
2. 代码实施前已完成设计确认；本计划执行时不得跳过设计结论。
3. 改动文件会超过 3 个，实施代码前必须新建分支。
4. 未经用户授权，禁止执行 `git push`。
5. 交付前必须先通过自动化测试，再做真实 Codex CLI 交付测试。
6. 交付测试必须使用真实插件安装入口与自然语言业务表达，不能用直接调内部 MCP 工具代替。
7. 如果用户选择主会话实施，插件后续不再托管该任务；不能偷偷保留一个“待回填 ACP”的隐藏中间态。

## 3. 范围与非范围

### 3.1 本次交付

1. 新增“实施执行方选择”状态与动作。
2. 调整 `planning_approve` 后的实施入口逻辑。
3. 调整 `TRANSFERRED_TO_MAIN` 在实施入口主动转交时的业务语义。
4. 更新 schema、README、skill、单测与交付测试。

### 3.2 本次不交付

1. 不改 ACP 实施路径内部的持续跟进与整改策略。
2. 不改方案/计划阶段默认由主会话执行的规则。
3. 不实现“主会话实施完成后回填插件继续交付测试”的能力。

## 4. 业务交付完成定义

只有同时满足以下条件，才能判定本次交付完成：

1. 计划确认后，真实入口先出现“实施执行方选择”，而不是直接出现 ACP 模型选择。
2. 选择 `主会话继续实施` 后，插件返回明确的转主会话终态，且不再接受后续 ACP 闭环动作。
3. 选择 `ACP 委派实施` 后，现有 ACP 模型确认/实施闭环仍然可用。
4. 计划门禁仍然有效；计划缺项时不能进入实施执行方选择。
5. 自动化测试通过。
6. 真实 Codex CLI 交付测试通过。

## 5. 业务交付场景

### DS-01 计划确认后进入实施执行方选择

**业务目标：**
用户在计划已经确认后，先决定由谁进入实施阶段。

**前置条件：**

1. 插件已安装并生效。
2. 当前任务已完成方案和计划，并停在计划确认节点。

**输入数据：**

- 用户确认计划，例如：“可以，按这个计划进入实施。”

**操作步骤：**

1. 用户在真实 Codex CLI 里确认计划。
2. 主会话推进 `planning_approve`。
3. 插件返回实施入口业务响应。

**期望输出：**

1. 响应的业务阶段是“实施执行方选择”。
2. 用户看到两个选择：
   - 主会话继续实施（默认）
   - ACP 委派实施

**数据校验：**

1. `workflow_status` 为 `NEEDS_IMPLEMENTATION_EXECUTOR`。
2. `next_action_required` 为 `implementation_executor_select`。

**失败处理：**

1. 若计划门禁未通过，应退回计划修订，不允许出现实施执行方选择。

**对应开发任务：**

- Task 01
- Task 03

### DS-02 主会话实施分流

**业务目标：**
用户选择主会话实施后，插件闭环在实施入口结束，主会话接手后续全部工作。

**前置条件：**

1. 当前任务已处于“实施执行方选择”。

**输入数据：**

- 用户选择“主会话继续实施（默认）”。

**操作步骤：**

1. 主会话提交 `implementation_executor_select(main)`。
2. 插件返回终态响应。

**期望输出：**

1. 插件明确告知当前需求、方案、计划和实施前门禁已经完成。
2. 插件明确告知后续编码、自动化测试、真实交付测试和失败修复全部由主会话负责。
3. 该任务后续不再接受 ACP 闭环动作。

**数据校验：**

1. `workflow_status` 为 `TRANSFERRED_TO_MAIN`。
2. `next_action_required` 为 `null`。

**失败处理：**

1. 若选择后仍能继续 `delivery_test_pass/fail` 或 `status`，判为失败。

**对应开发任务：**

- Task 01
- Task 03

### DS-03 ACP 实施分流

**业务目标：**
用户选择 ACP 实施后，继续进入现有 ACP 委派闭环。

**前置条件：**

1. 当前任务已处于“实施执行方选择”。

**输入数据：**

- 用户选择“ACP 委派实施”。

**操作步骤：**

1. 主会话提交 `implementation_executor_select(acp)`。
2. 插件继续进入模型确认或模型选择。
3. 模型确认完成后进入实施运行态。

**期望输出：**

1. 先看到模型闸门。
2. 后续仍进入现有实施闭环。

**数据校验：**

1. `workflow_status` 为 `NEEDS_MODEL_CONFIRM` 或 `NEEDS_MODEL_SELECTION`。
2. 模型确认后可进入 `RUNNING_IMPLEMENTATION`。

**失败处理：**

1. 若选择 ACP 后仍然直接转主会话，判为失败。

**对应开发任务：**

- Task 01
- Task 03

## 6. 文件变更清单

### 6.1 主要修改文件

- `src/session/bridge-service.ts`
  - 新增实施执行方选择状态响应与动作处理。
  - 调整 `planning_approve` 后的状态推进。
  - 区分实施入口主动转主会话与 ACP 异常转主会话的业务文案。

- `src/mcp-tools/schemas.ts`
  - 新增 `implementation_executor_select` 动作。
  - 新增 `implementation_executor` 参数。

- `README.md`
  - 更新团队委派模式、状态集合、最小前置动作和业务定位。

- `skills/team-delegate/SKILL.md`
  - 更新实施阶段规则、用户提示和状态处理规则。

- `tests/unit/bridge-service-workflow.test.ts`
  - 覆盖实施执行方选择与主会话/ACP 分流。

- `tests/delivery/delegate-loop.delivery.test.ts`
  - 补动作 schema 契约断言。

- `tests/plugin/install.plugin.test.ts`
  - 校验技能文本与安装后业务规则一致。

## 7. 开发任务拆分

### Task 01：先固定实施分流的契约与红灯测试

**业务目标：**

先把“计划确认后先选实施执行方”以及“主会话实施即退出插件闭环”的契约固定成测试，避免实现时跑偏。

**设计来源：**

- 设计文档第 6、8、9、11、12 章。

**修改范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/delegate-loop.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 在 workflow 单测中新增：
   - `planning_approve` 后返回 `NEEDS_IMPLEMENTATION_EXECUTOR`
   - `implementation_executor_select(main)` 后返回 `TRANSFERRED_TO_MAIN`
   - `implementation_executor_select(acp)` 后进入模型闸门
2. 在 delivery/schema 测试里新增新动作与新参数断言。
3. 在 plugin/skill 测试里新增业务规则断言：
   - 计划确认后先选实施执行方
   - 主会话实施后不再回到 ACP

**验证方式：**

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test -- tests/delivery/delegate-loop.delivery.test.ts tests/plugin/install.plugin.test.ts
```

**完成标准：**

1. 新测试先红灯，明确暴露当前实现缺口。
2. 红灯内容直接对应新业务契约，而不是泛泛失败。

### Task 02：实现状态机、schema 与业务文案调整

**业务目标：**

让实施入口真正支持执行方分流，并保证主会话实施路径在插件层干净终止。

**设计来源：**

- 设计文档第 4、5、6、7、8、10 章。

**修改范围：**

- `src/session/bridge-service.ts`
- `src/mcp-tools/schemas.ts`

**实施步骤：**

1. 在 schema 中新增：
   - `action=implementation_executor_select`
   - `implementation_executor=main|acp`
2. 在 workflow 状态集合中新增 `NEEDS_IMPLEMENTATION_EXECUTOR`。
3. 调整 `planning_approve`：
   - 不再直接进入 `RUNNING_IMPLEMENTATION`
   - 改为返回实施执行方选择
4. 新增 `implementation_executor_select` 处理逻辑：
   - `main` -> 记录转交原因，落到 `TRANSFERRED_TO_MAIN`
   - `acp` -> 进入现有模型闸门
5. 区分 `TRANSFERRED_TO_MAIN` 的两类文案来源：
   - 实施入口主动转交
   - ACP 异常被迫转交
6. 为已转主会话的任务禁止后续 ACP 闭环动作。

**验证方式：**

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

**完成标准：**

1. 选择主会话实施后不再出现任何继续交付 ACP 的隐性状态。
2. 选择 ACP 实施后仍能进入原有模型闸门和实施闭环。

### Task 03：同步 README、skill 与交付规则

**业务目标：**

让真实入口的编排说明、状态说明和业务提示全部对齐新的实施分流。

**设计来源：**

- 设计文档第 4、6、8、12、18 章。

**修改范围：**

- `README.md`
- `skills/team-delegate/SKILL.md`

**实施步骤：**

1. 更新 README 的团队委派模式、动作列表、状态列表和实施入口描述。
2. 更新 skill 的铁律、状态处理规则和实施阶段说明。
3. 确保文案统一表达：
   - 插件负责到计划和实施入口门禁
   - 实施阶段先选执行方
   - 主会话实施后插件闭环结束

**验证方式：**

```bash
npm run test -- tests/plugin/install.plugin.test.ts tests/delivery/team-delegate-skill.delivery.test.ts
```

**完成标准：**

1. README、skill、测试三处对同一业务规则表述一致。
2. 安装后的真实入口不会再按旧逻辑直接要求选 ACP 模型。

### Task 04：自动化验证、构建、本地安装与真实交付测试

**业务目标：**

证明这次改动在真实入口下可交付，而不是只在单测里成立。

**设计来源：**

- 设计文档第 11、12、13、18 章。

**修改范围：**

- 插件构建与本地安装
- 真实 CLI 交付测试证据

**实施步骤：**

1. 跑相关单元测试、插件测试、交付测试。
2. 执行构建与本地安装。
3. 在真实 Codex CLI 中走三条用例：
   - 计划确认后出现实施执行方选择
   - 选择主会话实施后插件闭环结束
   - 选择 ACP 实施后继续原闭环
4. 逐项对照 `docs/团队委派交付测试必过表.md` 复核。
5. 若任何一项失败，记录失败事实并回到整改。

**验证方式：**

见第 9 章与第 10 章。

**完成标准：**

1. 自动化测试通过。
2. 真实交付测试通过。
3. 必过表通过。

## 8. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | `planning_approve` 仍直接进入实施或模型选择 | 没有 `NEEDS_IMPLEMENTATION_EXECUTOR` | 计划确认后先进入实施执行方选择 |
| UT-02 | 选择主会话实施后仍保留插件闭环动作 | 仍可继续 `status`/`delivery_test_pass` | 进入 `TRANSFERRED_TO_MAIN` 且无后续动作 |
| UT-03 | 选择 ACP 实施后没有进入模型闸门 | 直接失败或直接转主会话 | 进入 `NEEDS_MODEL_CONFIRM/SELECTION` |
| UT-04 | skill/README 仍宣称计划确认后直接选 ACP 模型 | 契约测试失败 | 文档与状态机一致 |

## 9. 自动化验证计划

1. 精准回归：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

2. 契约与安装相关：

```bash
npm run test -- tests/delivery/delegate-loop.delivery.test.ts tests/plugin/install.plugin.test.ts tests/delivery/team-delegate-skill.delivery.test.ts
```

3. 全量测试：

```bash
npm test
```

4. 构建与安装：

```bash
npm run build
npm run prepare:plugin
npm run plugin:install-local
```

## 10. 真实业务交付测试计划

### DT-01：计划确认后出现实施执行方选择

**真实入口：**

1. 安装当前插件。
2. 刷新或重启 Codex 使用环境。
3. 打开 Codex CLI。
4. 用自然语言走团队委派到计划确认节点。

**真实业务语言：**

- “帮我用团队委派流程完成这个开发任务，方案和计划都确认后再进入实施。”

**操作步骤：**

1. 推进到计划确认。
2. 用户确认计划。
3. 观察下一步响应。

**通过标准：**

1. 下一步是“实施执行方选择”。
2. 不是直接出现 ACP 模型选择。

### DT-02：主会话实施分流

**真实业务语言：**

- “后续由主会话继续实施。”

**操作步骤：**

1. 在实施执行方选择节点选择主会话继续实施。
2. 观察插件响应。
3. 尝试继续触发一个后续 ACP 闭环动作，确认被拒绝。

**通过标准：**

1. 插件明确说明后续全部由主会话负责。
2. 任务落到终态，不再接受后续 ACP 闭环动作。

### DT-03：ACP 实施分流

**真实业务语言：**

- “继续交给 ACP 实施。”

**操作步骤：**

1. 在实施执行方选择节点选择 ACP 委派实施。
2. 观察是否进入模型确认或模型选择。
3. 完成模型确认后，观察是否进入实施运行态。

**通过标准：**

1. 选择 ACP 后继续进入原实施闭环。
2. 现有持续跟进规则仍成立。

### DT-04：团队委派必过表复核

**操作步骤：**

1. 对 ACP 实施路径复核 `docs/团队委派交付测试必过表.md`。
2. 对主会话实施路径重点复核：
   - 是否没有错误地承诺继续自动跟进
   - 是否没有保留一个假闭环

**通过标准：**

1. 必过表任一项失败，整体交付测试判失败。

## 11. 失败修复与复测机制

1. 自动化测试失败时，不得宣称完成；必须先修复，再重跑同一组测试。
2. 真实交付测试失败时，必须记录：
   - 失败步骤
   - 用户输入
   - 实际表现
   - 预期表现
   - 根因判断
3. 修复后必须重新执行同一条真实业务链路。
4. 只有自动化测试和真实交付测试同时通过，才能汇报完成。

## 12. 需求到验收映射

| 需求/设计承诺 | 开发任务 | 自动化验证 | 交付测试 |
|---|---|---|---|
| 计划确认后先选择实施执行方 | Task 01, Task 02 | UT-01 | DT-01 |
| 主会话实施后插件闭环结束 | Task 02 | UT-02 | DT-02 |
| ACP 实施后继续原闭环 | Task 02, Task 03 | UT-03 | DT-03 |
| README 与 skill 同步新业务定位 | Task 03 | UT-04 | DT-01, DT-02, DT-03 |

## 13. 最终交付清单

1. 设计文档：
   - `docs/superpowers/specs/2026-05-20-implementation-executor-selection-design.md`
2. 计划文档：
   - `docs/superpowers/plans/2026-05-20-implementation-executor-selection-plan.md`
3. 代码改动：
   - `bridge-service`
   - schema
   - README
   - skill
   - tests
4. 自动化验证结果
5. 真实 Codex CLI 交付测试结果

## 14. 上下文压缩后的恢复说明

当前任务的最终业务定义已经明确：

1. 插件负责一句话需求到方案、计划和实施前门禁。
2. 计划确认后必须先出现实施执行方选择。
3. 选择主会话实施时，插件闭环在实施入口结束，后续全部由主会话负责。
4. 选择 ACP 实施时，继续走现有 ACP 实施闭环。

后续实施代码时，优先顺序应是：

1. 先补红灯测试；
2. 再改状态机和 schema；
3. 再同步 README 与 skill；
4. 最后跑自动化和真实交付测试。
