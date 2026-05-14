# 业务交付闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将团队委派插件的完成标准从“ACP 实施完成”升级为“真实业务交付测试通过”。

**Architecture:** 在现有 `delegate.task.execute` 高层入口内扩展状态机，不新增低层用户入口。实施完成后进入交付测试等待节点；交付测试失败后记录失败材料、形成整改方案与整改计划、等待用户确认，再安排整改实施，并回到同一条交付测试链路。

**Tech Stack:** TypeScript、MCP SDK、Zod、Vitest、Codex CLI 本机真实环境、OpenCode ACP。

---

## 1. 项目与目标

本计划优化 `team-delegate` 插件的业务交付闭环。

当前问题是：插件把 ACP 返回 `STATUS: DONE` 当成最终完成，导致实施完成后直接进入 `COMPLETED`。这不符合项目规则，因为真实完成标准必须是业务交付测试通过。

本次交付后应达到的效果：

- 计划实施完成后，插件不得直接宣布交付完成。
- 插件必须提示主会话执行真实业务交付测试。
- 主会话确认交付测试通过后，插件才进入完成状态。
- 主会话确认交付测试失败后，插件必须进入整改链路。
- 整改链路必须包含失败材料、整改方案、整改计划、用户确认、整改实施、同链路复测。
- 整改次数必须由插件固定控制为 3 次，不允许由 LLM 或调用方自行决定。
- 第 3 次整改后的交付测试仍失败时，插件必须让用户选择主会话接手整改或取消后续工作。
- 用户可见输出必须始终业务导向，不用内部状态作为主提示。

本计划不做：

- 不内置某个项目专属测试脚本。
- 不替代主会话执行真实业务交付测试。
- 不把单元测试、字段检查或内部工具调用当成交付测试。
- 不改变方案制定、计划制定默认由主会话完成的规则。
- 不改变计划实施阶段的模型选择机制。

## 2. 硬约束

- 所有对用户的说明必须使用中文。
- 开发或修改代码前必须先完成本计划并获得用户批准。
- 当前代码实施必须在分支 `codex/delivery-closure-design` 上进行。
- 未经用户明确授权，禁止执行 `git push`。
- 交付测试必须使用本机真实环境，不使用容器。
- 交付测试必须从真实用户入口开始：安装插件、刷新 Codex 环境、打开 Codex CLI、用自然语言触发 `$team-delegate`。
- 面向用户的文字必须业务导向，禁止用 `workflow_status`、`current_stage`、MCP 工具名作为首屏主表达。
- 实施阶段持续跟进仍必须满足 1-2 分钟要求。
- 失败后不得声明完成，必须修复后重新执行同一条业务交付测试链路。

## 3. 范围与非范围

### 3.1 本次交付

- 扩展 `delegate.task.execute` 的动作：交付测试通过、交付测试失败、整改确认、取消后续工作。
- 扩展工作流状态：等待交付测试、交付测试失败待整改确认、整改实施中、完成 3 次整改后待用户决策。
- 调整实施完成后的状态流转：从直接完成改为等待交付测试。
- 交付测试通过后才允许关闭 ACP 会话并进入完成状态。
- 交付测试失败后记录失败材料。
- 交付测试失败后由插件安排形成整改方案和整改计划，并展示给用户确认。
- 用户确认整改后，安排 ACP 执行整改。
- 整改完成后回到等待交付测试状态。
- 完成 3 次整改后仍未通过时，要求用户选择主会话接手整改或取消后续工作。
- 更新 `team-delegate` Skill，使主会话按新闭环推进。
- 更新 README，说明“实施完成不等于交付完成”。
- 新增自动化测试和真实业务交付测试记录。

### 3.2 本次不交付

- 不新增单独的 MCP 低层工具。
- 不把整改方案审批拆成独立外部系统。
- 不新增数据库表；本轮工作流状态先保留在现有内存工作流状态中。
- 不要求 ACP 自行执行 Codex CLI 真实交付测试；交付测试仍由主会话执行并把结果反馈给插件。

## 4. 交付完成定义

只有同时满足以下条件，才能判定本次优化完成：

- 自动化测试证明实施完成后不会直接进入 `COMPLETED`。
- 自动化测试证明实施完成后进入等待交付测试节点。
- 自动化测试证明 `delivery_test_pass` 后才进入 `COMPLETED`。
- 自动化测试证明 `delivery_test_fail` 必须携带失败材料。
- 自动化测试证明交付测试失败后会形成整改方案和整改计划，并等待用户确认。
- 自动化测试证明整改实施完成后必须回到等待交付测试节点。
- 自动化测试证明完成 3 次整改后仍未通过时必须要求用户决策。
- Skill 文档明确主会话必须执行真实业务交付测试，不能把 ACP 实施完成当成交付完成。
- README 说明真实业务闭环。
- 本机完成插件安装。
- Codex CLI 真实业务入口完成一次“失败 -> 整改 -> 复测通过”的交付测试。
- 交付测试失败时形成失败记录、整改方案、整改计划和复测记录。

## 5. 业务交付场景

### DS-01 实施完成后等待交付测试

**业务目标：**
用户通过 `$team-delegate` 进入计划实施，ACP 表示实施完成后，插件不直接宣布任务完成，而是要求主会话执行真实业务交付测试。

**前置条件：**

- 当前项目已有设计方案和可交付开发计划。
- 用户确认进入计划实施。
- ACP 已输出 `STATUS: DONE`。

**输入数据：**

```text
$team-delegate 当前已经有方案和计划，直接进入实施。实施完成后必须先跑真实交付测试。
```

**操作步骤：**

1. 主会话从 Codex CLI 真实入口触发 `$team-delegate`。
2. 插件进入计划实施阶段。
3. 用户选择实施模型。
4. ACP 完成实施并返回完成信号。
5. 主会话查看插件返回结果。

**期望输出：**

- 用户看到“计划实施已经完成，但还不能判定交付完成”。
- 插件要求主会话执行真实业务交付测试。
- 插件不显示业务完成。

**数据校验：**

- 状态为 `NEEDS_DELIVERY_TEST`。
- 下一步动作为 `delivery_test_pass` 或 `delivery_test_fail`。
- `COMPLETED` 未出现。

**失败处理：**

- 如果仍然直接进入 `COMPLETED`，记录为交付失败，回到状态机修改任务。

**对应开发任务：**
Task 01、Task 02、Task 04、Task 07。

### DS-02 交付测试通过后完成

**业务目标：**
主会话完成真实业务交付测试并确认通过后，插件才宣布任务完成并按配置关闭 ACP 会话。

**前置条件：**

- 插件处于 `NEEDS_DELIVERY_TEST`。
- 主会话已从真实入口执行交付测试。
- 交付测试通过。

**输入数据：**

```text
交付测试已通过：安装、加载、自然语言触发、实施结果复测均通过。
```

**操作步骤：**

1. 主会话调用高层入口反馈交付测试通过。
2. 插件记录通过信息。
3. 插件关闭 ACP 会话。
4. 插件进入完成状态。

**期望输出：**

- 用户看到“真实业务交付测试已通过，本次任务可以判定完成”。
- 插件进入 `COMPLETED`。
- 自动关闭 ACP 会话时返回关闭结果。

**数据校验：**

- `workflow_status` 为 `COMPLETED`。
- `workflow_completed` 为 `true`。
- `delivery_test_passed` 为 `true`。

**失败处理：**

- 如果关闭 ACP 失败，返回可重试错误，不得吞掉失败。

**对应开发任务：**
Task 02、Task 04、Task 07。

### DS-03 交付测试失败后形成整改方案和计划

**业务目标：**
主会话发现真实业务交付测试失败后，插件不能结束任务，必须记录失败材料并形成整改方案和整改计划。

**前置条件：**

- 插件处于 `NEEDS_DELIVERY_TEST`。
- 主会话执行真实交付测试后发现失败。

**输入数据：**

```text
失败位置：Codex CLI 中实施完成后直接显示完成。
用户输入：$team-delegate 当前已有方案和计划，直接进入实施。
实际表现：没有要求执行交付测试。
预期表现：实施完成后必须等待真实交付测试。
复现步骤：安装插件后从 Codex CLI 输入上述自然语言。
```

**操作步骤：**

1. 主会话反馈交付测试失败并提交失败材料。
2. 插件校验失败材料不为空。
3. 插件记录失败材料。
4. 插件安排生成整改方案和整改计划。
5. 插件等待用户确认整改。

**期望输出：**

- 用户看到“交付测试失败，当前不能声明完成”。
- 用户看到整改目标、修改范围、复测链路。
- 下一步是确认整改或主会话接手。

**数据校验：**

- 状态为 `DELIVERY_TEST_FAILED`。
- 下一步动作为 `remediation_approve` 或 `handoff_to_main`。
- 失败材料保存在工作流状态中。

**失败处理：**

- 如果失败材料为空，返回明确错误并要求补充失败材料。

**对应开发任务：**
Task 02、Task 03、Task 04、Task 07。

### DS-04 整改实施后回到同链路复测

**业务目标：**
用户确认整改方案和计划后，ACP 执行整改；整改完成后插件必须再次要求主会话执行同一条真实业务交付测试。

**前置条件：**

- 插件处于 `DELIVERY_TEST_FAILED`。
- 插件已形成整改方案和计划。
- 用户确认当前整改方案和计划。

**输入数据：**

```text
确认按当前整改方案和计划继续实施。
```

**操作步骤：**

1. 主会话反馈用户确认整改。
2. 插件进入整改实施。
3. ACP 完成整改。
4. 插件回到等待交付测试。
5. 主会话重新执行同一条真实业务交付测试。

**期望输出：**

- 用户看到“整改实施已完成，现在必须重新执行同一条交付测试链路”。
- 插件不直接完成。
- 插件要求 `delivery_test_pass` 或 `delivery_test_fail`。

**数据校验：**

- 整改完成后状态为 `NEEDS_DELIVERY_TEST`。
- `remediation_round` 增加。
- `COMPLETED` 未出现，除非后续明确反馈交付测试通过。

**失败处理：**

- 如果整改仍失败，继续 DS-03。

**对应开发任务：**
Task 02、Task 03、Task 04、Task 07。

### DS-05 完成 3 次整改后由用户决策

**业务目标：**
3 次整改仍未通过时，插件不无限循环，也不擅自继续安排 ACP 整改，而是让用户选择主会话接手整改或取消后续工作。

**前置条件：**

- 插件内固定整改次数为 3 次。
- 已完成 3 次整改实施。
- 最新一次交付测试仍失败。

**输入数据：**

```text
交付测试仍失败：整改后依旧没有回到真实交付测试节点。
```

**操作步骤：**

1. 主会话反馈交付测试失败。
2. 插件判断已完成 3 次整改。
3. 插件进入用户决策节点。
4. 用户选择主会话接手整改或取消后续工作。

**期望输出：**

- 用户看到“已经完成 3 次整改，交付测试仍未通过，后续不能继续由 ACP 自动整改”。
- 用户可以选择主会话接手整改。
- 用户可以选择取消后续工作。

**数据校验：**

- 状态为 `NEEDS_REMEDIATION_DECISION`。
- 下一步动作为 `handoff_to_main` 或 `cancel_follow_up`。

**失败处理：**

- 如果用户选择主会话接手整改，插件取消或关闭 ACP 会话并进入 `TRANSFERRED_TO_MAIN`。
- 如果用户选择取消后续工作，插件取消或关闭 ACP 会话并进入 `CANCELLED`，不得声明交付完成。

**对应开发任务：**
Task 02、Task 03、Task 04、Task 07。

## 6. 自测命令

实施完成后必须执行：

```powershell
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:delivery
npm run build
npm run prepare:plugin
npm run plugin:install-local
```

通过标准：

- TypeScript 类型检查通过。
- 单元测试通过。
- 集成测试通过。
- 交付测试契约通过。
- 构建和插件准备通过。
- 本机安装脚本成功。

真实业务交付测试还必须执行：

```powershell
opencode --version
codex
```

在 Codex CLI 中用真实业务语言触发：

```text
$team-delegate 当前已经有方案和计划，直接进入实施。实施完成后必须先跑真实交付测试；如果测试失败，先形成整改方案和整改计划，最多由 ACP 整改 3 次；超过 3 次仍未通过时，由主会话接手整改或取消后续工作。
```

通过标准：

- 插件能被加载。
- `$team-delegate` 能被真实业务语言触发。
- 实施完成后进入等待交付测试。
- 首次交付测试失败后进入整改链路。
- 整改完成后回到同链路复测。
- 复测通过后才进入完成。

## 7. 失败修复与复测机制

如果任何自动化测试失败：

1. 记录失败命令。
2. 记录失败测试名。
3. 记录期望结果和实际结果。
4. 定位根因。
5. 修改代码。
6. 重新执行同一条失败命令。
7. 相关全量命令重新执行。

如果真实业务交付测试失败：

```markdown
## 失败场景

## 输入数据

## 期望结果

## 实际结果

## 根因分析

## 修复方案

## 复测命令

## 复测结果
```

真实业务交付测试失败后，必须按以下闭环推进：

1. 在交付记录中写下失败材料。
2. 形成整改方案。
3. 形成整改实施计划。
4. 获得用户确认。
5. 实施整改。
6. 重新安装插件。
7. 重新从 Codex CLI 真实入口执行同一条业务链路。
8. 通过后才允许声明完成。

## 8. 技术设计与模块边界

### 8.1 `src/session/bridge-service.ts`

责任：

- 维护工作流状态机。
- 执行 ACP 阶段。
- 处理交付测试通过、失败、整改确认、主会话接手和取消后续工作动作。
- 生成业务导向状态响应。

需要新增或调整：

- `ExecuteTaskAction` 增加 `delivery_test_pass`、`delivery_test_fail`、`remediation_approve`、`cancel_follow_up`。
- `WorkflowStage` 增加 `NEEDS_DELIVERY_TEST`、`DELIVERY_TEST_FAILED`、`RUNNING_REMEDIATION`、`NEEDS_REMEDIATION_DECISION`、`CANCELLED`。
- 新增 `MAX_REMEDIATION_ROUNDS = 3` 常量，整改次数只能由插件状态机按该常量判断，不能读取 LLM 输出或调用方参数决定。
- `TaskWorkflowState` 增加交付测试与整改字段：
  - `deliveryTestFailures`
  - `deliveryTestPassed`
  - `deliveryTestResult`
  - `remediationRound`
  - `pendingRemediationPlan`
  - `lastImplementationResult`
- `runImplementationPhase` 不再返回完成 payload，而是只负责执行实施并保存结果。
- 新增 `enterDeliveryTestGate`，统一进入等待交付测试节点。
- 新增 `handleDeliveryTestPass`。
- 新增 `handleDeliveryTestFail`。
- 新增 `runRemediationPlanPhase`。
- 新增 `handleRemediationApprove`。
- 新增 `handleCancelFollowUp`。
- 新增 `buildRemediationPlanPrompt`。
- 新增 `buildRemediationImplementationPrompt`。
- `autoClose` 只在交付测试通过、主会话接手或取消后续工作时执行，不在 ACP 实施完成时执行。

### 8.2 `src/mcp-tools/schemas.ts`

责任：

- 校验高层入口参数。

需要新增或调整：

- `action` 枚举增加新动作。
- `delivery_test_fail` 必须提供 `feedback_text` 或结构化失败材料。
- `delivery_test_pass` 可以提供 `feedback_text` 作为通过记录。
- `remediation_approve` 可以提供 `feedback_text` 作为用户确认或补充要求。
- `cancel_follow_up` 必须提供 `session_alias`。

### 8.3 `src/plugin/mcp-server.ts`

责任：

- 向 MCP 暴露工具 schema。

需要新增或调整：

- `delegate.task.execute` 工具描述加入业务交付闭环。
- 工具输入 schema 增加新动作。
- 工具描述避免开发导向表达，使用“交付测试通过/失败/整改确认/取消后续工作”。

### 8.4 `skills/team-delegate/SKILL.md`

责任：

- 指导主会话按业务流程推进插件。

需要新增或调整：

- 明确“实施完成不等于交付完成”。
- 新增 `NEEDS_DELIVERY_TEST` 处理规则。
- 新增 `DELIVERY_TEST_FAILED` 处理规则。
- 新增 `RUNNING_REMEDIATION` 处理规则。
- 新增 `NEEDS_REMEDIATION_DECISION` 处理规则。
- 明确交付测试必须从真实入口执行。
- 明确失败材料必须包含失败位置、用户输入、实际表现、预期表现、复现步骤。

### 8.5 `README.md`

责任：

- 对外说明插件业务流程。

需要新增或调整：

- 增加业务交付闭环章节。
- 增加“ACP 实施完成不是最终完成”的说明。
- 增加真实业务交付测试入口说明。

### 8.6 测试文件

需要修改或新增：

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/delegate-loop.delivery.test.ts`
- `tests/integration/delegate-tools.integration.test.ts`
- 新增 `tests/unit/bridge-delivery-closure.test.ts`，或者把同等测试合并到 `tests/unit/bridge-service-workflow.test.ts`

## 9. API、数据模型与配置

### 9.1 新动作

```ts
type ExecuteTaskAction =
  | "start"
  | "model_confirm"
  | "model_select"
  | "status"
  | "continue_wait"
  | "handoff_to_main"
  | "design_feedback"
  | "design_approve"
  | "planning_feedback"
  | "planning_approve"
  | "delivery_test_pass"
  | "delivery_test_fail"
  | "remediation_approve"
  | "cancel_follow_up";
```

### 9.2 新状态

```ts
type WorkflowStage =
  | "RUNNING_DESIGN"
  | "WAITING_DESIGN_APPROVAL"
  | "RUNNING_PLANNING"
  | "WAITING_PLAN_APPROVAL"
  | "RUNNING_IMPLEMENTATION"
  | "NEEDS_DELIVERY_TEST"
  | "DELIVERY_TEST_FAILED"
  | "RUNNING_REMEDIATION"
  | "NEEDS_REMEDIATION_DECISION"
  | "NEEDS_USER_DECISION"
  | "TRANSFERRED_TO_MAIN"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";
```

### 9.3 固定整改次数

```ts
const MAX_REMEDIATION_ROUNDS = 3;
```

整改次数是插件状态机的硬规则：

- 初始计划实施不计入整改次数。
- 每次用户确认整改并进入 `RUNNING_REMEDIATION` 时，整改次数加 1。
- 第 1 次、第 2 次整改失败后，可以继续生成整改方案和整改计划。
- 第 3 次整改失败后，不能再由 ACP 自动整改，必须进入 `NEEDS_REMEDIATION_DECISION`。
- `max_rework_rounds` 不再用于业务交付闭环的整改次数判断，只保留给既有设计/计划文档门禁内部使用。

### 9.4 失败材料

第一版使用 `feedback_text` 承载失败材料，避免过早引入复杂结构。插件必须校验文本非空，并在响应中以 `delivery_test_failures` 保留。

必须至少按以下格式填写：

```text
失败位置：
用户输入：
实际表现：
预期表现：
影响范围：
复现步骤：
```

后续如果真实交付测试证明需要强结构，再新增 `delivery_test_failure` 对象。

### 9.5 状态转换

```text
RUNNING_IMPLEMENTATION
-> NEEDS_DELIVERY_TEST

NEEDS_DELIVERY_TEST + delivery_test_pass
-> COMPLETED

NEEDS_DELIVERY_TEST + delivery_test_fail
-> RUNNING_REMEDIATION
-> DELIVERY_TEST_FAILED

DELIVERY_TEST_FAILED + remediation_approve
-> RUNNING_REMEDIATION
-> NEEDS_DELIVERY_TEST

NEEDS_DELIVERY_TEST + delivery_test_fail 且已完成 3 次整改
-> NEEDS_REMEDIATION_DECISION

NEEDS_REMEDIATION_DECISION + handoff_to_main
-> TRANSFERRED_TO_MAIN

NEEDS_REMEDIATION_DECISION + cancel_follow_up
-> CANCELLED
```

## 10. 开发任务拆分

### Task 01: 写失败测试，锁定“实施完成不得直接完成”

**Files:**

- Modify: `tests/unit/bridge-service-workflow.test.ts`

- [ ] **Step 1: 修改现有直接完成测试**

将当前“skip to implementation”测试的期望从 `COMPLETED` 改为 `NEEDS_DELIVERY_TEST`。

测试意图：

```ts
expect((start.data as { detected_start_phase: string }).detected_start_phase).toBe("implementation");
expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
expect((start.data as { next_action_required: string[] }).next_action_required).toEqual([
  "delivery_test_pass",
  "delivery_test_fail"
]);
```

- [ ] **Step 2: 新增实施完成等待交付测试测试**

新增测试名：

```ts
it("should require delivery test after implementation completes", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  const start = await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-delivery-gate",
    start_phase: "implementation"
  });

  expect(start.success).toBe(true);
  expect((start.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
  expect((start.data as { user_message: string }).user_message).toContain("还不能判定交付完成");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

Expected:

```text
FAIL: expected COMPLETED to be NEEDS_DELIVERY_TEST
```

### Task 02: 扩展状态机和动作入口

**Files:**

- Modify: `src/session/bridge-service.ts`
- Modify: `src/mcp-tools/schemas.ts`
- Modify: `src/plugin/mcp-server.ts`

- [ ] **Step 1: 扩展 TypeScript 类型**

在 `ExecuteTaskAction` 增加：

```ts
  | "delivery_test_pass"
  | "delivery_test_fail"
  | "remediation_approve"
  | "cancel_follow_up";
```

在 `WorkflowStage` 增加：

```ts
  | "NEEDS_DELIVERY_TEST"
  | "DELIVERY_TEST_FAILED"
  | "RUNNING_REMEDIATION"
  | "NEEDS_REMEDIATION_DECISION"
  | "CANCELLED"
```

在文件级别增加固定整改次数常量：

```ts
const MAX_REMEDIATION_ROUNDS = 3;
```

- [ ] **Step 2: 扩展工作流状态字段**

在 `TaskWorkflowState` 增加：

```ts
  deliveryTestPassed?: boolean;
  deliveryTestResult?: string;
  deliveryTestFailures: string[];
  remediationRound: number;
  pendingRemediationPlan?: string;
  lastImplementationResult?: Record<string, unknown>;
```

在 `startWorkflow` 初始化：

```ts
deliveryTestFailures: [],
remediationRound: 0,
```

- [ ] **Step 3: 扩展 schema**

在 `ExecuteTaskSchema` 的 `action` 枚举加入新动作，并在 `superRefine` 中加入：

```ts
if (action === "delivery_test_fail" && !value.feedback_text?.trim()) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["feedback_text"],
    message: "交付测试失败时必须提供失败材料"
  });
}
```

- [ ] **Step 4: 扩展 MCP server schema**

在 `src/plugin/mcp-server.ts` 同步加入新动作，并更新 description 为：

```text
高层委派入口：按业务阶段推进方案、计划、实施、交付测试和整改闭环；实施完成后必须等待真实业务交付测试，通过后才完成，失败后进入整改方案、整改计划、整改实施和复测。
```

- [ ] **Step 5: 运行类型检查确认新类型已接入**

Run:

```powershell
npm run typecheck
```

Expected:

```text
如果类型检查失败，失败原因必须来自尚未实现的新状态分支；确认后继续 Task 03 完成状态流转。
```

### Task 03: 实现交付测试和整改流转

**Files:**

- Modify: `src/session/bridge-service.ts`

- [ ] **Step 1: 调整实施完成后的流转**

把当前逻辑：

```ts
workflow.completedPayload = await this.runImplementationPhase(workflow);
workflow.stage = "COMPLETED";
```

改为：

```ts
workflow.lastImplementationResult = await this.runImplementationPhase(workflow);
this.enterDeliveryTestGate(workflow);
```

- [ ] **Step 2: 新增等待交付测试入口**

新增方法：

```ts
private enterDeliveryTestGate(workflow: TaskWorkflowState): void {
  workflow.stage = "NEEDS_DELIVERY_TEST";
  workflow.activePhase = undefined;
  workflow.activePhaseStartedAt = undefined;
  workflow.lastCompletedAt = now();
}
```

- [ ] **Step 3: 调整 `runImplementationPhase`**

让 `runImplementationPhase` 只返回实施结果，不关闭会话，不返回 `COMPLETED`。

返回结构包含：

```ts
return {
  implementation_completed: completedByModelSignal,
  phase_gates: this.toPhaseGatesPayload(workflow),
  steps: workflow.steps
};
```

- [ ] **Step 4: 新增 `handleDeliveryTestPass`**

行为：

1. 只允许在 `NEEDS_DELIVERY_TEST`。
2. 记录通过材料。
3. 如 `autoClose` 为 true，关闭 ACP 会话。
4. 设置 `deliveryTestPassed = true`。
5. 设置 `stage = "COMPLETED"`。
6. 构建完成 payload。

- [ ] **Step 5: 新增 `handleDeliveryTestFail`**

行为：

1. 只允许在 `NEEDS_DELIVERY_TEST`。
2. `feedback_text` 不能为空。
3. 记录失败材料到 `deliveryTestFailures`。
4. 如果 `remediationRound >= MAX_REMEDIATION_ROUNDS`，进入 `NEEDS_REMEDIATION_DECISION`。
5. 否则启动整改方案和计划生成阶段。

- [ ] **Step 6: 新增整改方案和计划生成**

新增方法：

```ts
private async runRemediationPlanPhase(workflow: TaskWorkflowState, failureText: string): Promise<void>
```

该方法调用 ACP 生成：

```text
1) 失败事实摘要
2) 根因假设
3) 整改方案
4) 整改实施计划
5) 同一条业务交付测试复测方式
```

完成后：

```ts
workflow.pendingRemediationPlan = extractedSummary;
workflow.stage = "DELIVERY_TEST_FAILED";
```

- [ ] **Step 7: 新增 `handleRemediationApprove`**

行为：

1. 只允许在 `DELIVERY_TEST_FAILED`。
2. `remediationRound += 1`。
3. 启动 ACP 整改实施。
4. 整改实施完成后调用 `enterDeliveryTestGate`。

- [ ] **Step 8: 新增 `handleCancelFollowUp`**

行为：

1. 只允许在 `NEEDS_REMEDIATION_DECISION`。
2. 如 `autoClose` 为 true，关闭 ACP 会话。
3. 设置 `stage = "CANCELLED"`。
4. 返回“用户已取消后续工作，本次任务未交付完成”的业务说明。

- [ ] **Step 9: 在 `executeTask` 中接入新动作**

在 `status`、`continue_wait`、`handoff_to_main` 后增加：

```ts
if (action === "delivery_test_pass") {
  return makeResult(requestId, await this.handleDeliveryTestPass(workflow, input.feedback_text, timeoutMs));
}
if (action === "delivery_test_fail") {
  return makeResult(requestId, await this.handleDeliveryTestFail(workflow, this.requireFeedback(input.feedback_text, action)));
}
if (action === "remediation_approve") {
  return makeResult(requestId, await this.handleRemediationApprove(workflow, input.feedback_text));
}
if (action === "cancel_follow_up") {
  return makeResult(requestId, await this.handleCancelFollowUp(workflow, timeoutMs));
}
```

- [ ] **Step 10: 运行 Task 01 测试确认通过**

Run:

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

Expected:

```text
PASS
```

### Task 04: 补齐状态响应的业务语言

**Files:**

- Modify: `src/session/bridge-service.ts`

- [ ] **Step 1: `NEEDS_DELIVERY_TEST` 响应**

返回内容必须包含：

```ts
{
  current_stage: "DELIVERY_TEST_REQUIRED",
  workflow_status: "NEEDS_DELIVERY_TEST",
  business_stage: "等待交付测试",
  user_message: "计划实施已经完成，但还不能判定交付完成。现在必须从真实业务入口执行交付测试。",
  next_business_action: "执行真实业务交付测试，并反馈通过或失败",
  next_action_required: ["delivery_test_pass", "delivery_test_fail"]
}
```

- [ ] **Step 2: `DELIVERY_TEST_FAILED` 响应**

返回内容必须包含：

```ts
{
  current_stage: "REMEDIATION_REVIEW",
  workflow_status: "DELIVERY_TEST_FAILED",
  business_stage: "整改方案确认",
  user_message: "交付测试失败，当前不能声明完成。请审核整改方案和整改计划，确认后进入当前整改实施。",
  next_business_action: "确认整改方案和整改计划，或选择主会话接手",
  next_action_required: ["remediation_approve", "handoff_to_main"]
}
```

- [ ] **Step 3: `RUNNING_REMEDIATION` 响应**

返回内容必须包含：

```ts
{
  current_stage: "REMEDIATION_RUNNING",
  workflow_status: "RUNNING_REMEDIATION",
  business_stage: "整改实施",
  user_message: "已进入整改实施阶段，我会按 1-2 分钟节奏持续跟进整改进展。",
  next_action_required: ["status"]
}
```

- [ ] **Step 4: `NEEDS_REMEDIATION_DECISION` 响应**

返回内容必须包含：

```ts
{
  current_stage: "NEEDS_REMEDIATION_DECISION",
  workflow_status: "NEEDS_REMEDIATION_DECISION",
  business_stage: "整改决策",
  user_message: "已经完成 3 次整改，交付测试仍未通过。后续不能继续由 ACP 自动整改，请选择主会话接手整改，或取消后续工作。",
  next_action_required: ["handoff_to_main", "cancel_follow_up"]
}
```

- [ ] **Step 5: 运行业务语言测试**

Run:

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

Expected:

```text
PASS
```

### Task 05: 补充 schema 和工具契约测试

**Files:**

- Modify: `tests/delivery/delegate-loop.delivery.test.ts`
- Modify: `tests/integration/delegate-tools.integration.test.ts`

- [ ] **Step 1: 新增 schema 测试**

在 `delegate-loop.delivery.test.ts` 增加：

```ts
const fail = ExecuteTaskSchema.parse({
  workspace_path: "D:/repo/demo",
  requirement_text: "需求",
  session_alias: "delegate-task-001",
  action: "delivery_test_fail",
  feedback_text: "失败位置：CLI 输出；实际表现：直接完成；预期表现：等待交付测试"
});
expect(fail.action).toBe("delivery_test_fail");
```

并增加失败材料缺失测试：

```ts
expect(() =>
  ExecuteTaskSchema.parse({
    workspace_path: "D:/repo/demo",
    requirement_text: "需求",
    session_alias: "delegate-task-001",
    action: "delivery_test_fail"
  })
).toThrow();
```

- [ ] **Step 2: 新增 DelegateTools 透传测试**

在 `delegate-tools.integration.test.ts` 增加：

```ts
await tools.executeTask({
  workspace_path: "D:/repo",
  requirement_text: "实现一个功能",
  session_alias: "task-001",
  action: "delivery_test_pass",
  feedback_text: "真实业务交付测试通过"
});

expect(service.executeTask).toHaveBeenLastCalledWith(
  expect.objectContaining({
    action: "delivery_test_pass",
    feedback_text: "真实业务交付测试通过"
  })
);
```

- [ ] **Step 3: 运行契约测试**

Run:

```powershell
npm run test:delivery
npm run test:integration
```

Expected:

```text
PASS
```

### Task 06: 更新 Skill 和 README

**Files:**

- Modify: `skills/team-delegate/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: 更新 Skill 铁律**

加入：

```markdown
9. **实施完成不等于交付完成。** 计划实施完成后必须进入真实业务交付测试；只有交付测试通过后，才能向用户声明完成。
10. **交付测试失败必须闭环整改。** 失败后必须提交失败材料，形成整改方案和整改计划，确认后整改实施，并回到同一条业务交付测试链路。
```

- [ ] **Step 2: 更新状态处理规则**

新增：

```markdown
### 7) `NEEDS_DELIVERY_TEST`

1. 先告诉用户：计划实施已经完成，但还不能判定交付完成。
2. 主会话必须从真实业务入口执行交付测试。
3. 测试通过调用 `delivery_test_pass`。
4. 测试失败调用 `delivery_test_fail`，并提供失败位置、用户输入、实际表现、预期表现、复现步骤。
```

新增：

```markdown
### 8) `DELIVERY_TEST_FAILED`

1. 向用户展示整改方案和整改计划。
2. 用户确认后调用 `remediation_approve`。
3. 用户不希望继续时调用 `handoff_to_main`。
```

新增：

```markdown
### 9) `RUNNING_REMEDIATION`

继续按 1-2 分钟节奏持续跟进整改进展；整改完成后必须重新执行同一条交付测试链路。
```

新增：

```markdown
### 10) `NEEDS_REMEDIATION_DECISION`

完成 3 次整改后交付测试仍未通过，向用户给出两个选择：主会话接手整改或取消后续工作。禁止继续由 ACP 自动整改。
```

- [ ] **Step 3: 更新 README**

增加“业务交付闭环”章节，说明：

```markdown
ACP 实施完成只代表代码实施阶段结束，不代表任务已交付。插件会等待主会话执行真实业务交付测试；通过后才完成，失败后进入整改闭环。
```

- [ ] **Step 4: 检查文案禁词**

Run:

```powershell
Select-String -Path 'skills/team-delegate/SKILL.md','README.md' -Pattern '轮询|监控|可考虑|可以考虑'
```

Expected:

```text
不得出现面向用户的“轮询”；流程强约束处不得使用弱化要求的表达。
```

### Task 07: 增加交付闭环单元测试

**Files:**

- Modify: `tests/unit/bridge-service-workflow.test.ts`

- [ ] **Step 1: 测试交付测试通过才完成**

新增测试名：

```ts
it("should complete only after delivery test passes", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-delivery-pass",
    start_phase: "implementation"
  });

  const passed = await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-delivery-pass",
    action: "delivery_test_pass",
    feedback_text: "真实业务交付测试通过"
  });

  expect(passed.success).toBe(true);
  expect((passed.data as { workflow_status: string }).workflow_status).toBe("COMPLETED");
});
```

- [ ] **Step 2: 测试失败进入整改确认**

新增测试名：

```ts
it("should create remediation review after delivery test fails", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-delivery-fail",
    start_phase: "implementation"
  });

  const failed = await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-delivery-fail",
    action: "delivery_test_fail",
    feedback_text: "失败位置：CLI；实际表现：直接完成；预期表现：等待交付测试"
  });

  expect(failed.success).toBe(true);
  expect((failed.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");
  expect((failed.data as { next_action_required: string[] }).next_action_required).toContain("remediation_approve");
});
```

- [ ] **Step 3: 测试整改后回到交付测试**

新增测试名：

```ts
it("should return to delivery test after remediation completes", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-remediation-return",
    start_phase: "implementation"
  });

  await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-remediation-return",
    action: "delivery_test_fail",
    feedback_text: "失败位置：CLI；实际表现：直接完成；预期表现：等待交付测试"
  });

  const remediation = await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-remediation-return",
    action: "remediation_approve",
    feedback_text: "确认整改"
  });

  expect(remediation.success).toBe(true);
  expect((remediation.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");
});
```

- [ ] **Step 4: 测试固定 3 次整改次数控制**

新增测试名：

```ts
it("should ask user to decide only after three remediation rounds fail", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-remediation-limit",
    start_phase: "implementation"
  });

  const firstFailure = await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-remediation-limit",
    action: "delivery_test_fail",
    feedback_text: "首次交付测试失败"
  });
  expect((firstFailure.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");

  for (const round of [1, 2, 3]) {
    const remediation = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-limit",
      action: "remediation_approve",
      feedback_text: `确认第 ${round} 次整改`
    });
    expect((remediation.data as { workflow_status: string }).workflow_status).toBe("NEEDS_DELIVERY_TEST");

    const failedAgain = await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-limit",
      action: "delivery_test_fail",
      feedback_text: `第 ${round} 次整改后仍失败`
    });

    expect(failedAgain.success).toBe(true);
    if (round < 3) {
      expect((failedAgain.data as { workflow_status: string }).workflow_status).toBe("DELIVERY_TEST_FAILED");
    } else {
      expect((failedAgain.data as { workflow_status: string }).workflow_status).toBe("NEEDS_REMEDIATION_DECISION");
      expect((failedAgain.data as { next_action_required: string[] }).next_action_required).toEqual([
        "handoff_to_main",
        "cancel_follow_up"
      ]);
    }
  }
});
```

- [ ] **Step 5: 测试取消后续工作**

新增测试名：

```ts
it("should cancel follow-up work without marking delivery as completed", async () => {
  const service = mockBridgeService({ workflowSyncWaitMs: 500 });
  await startAndConfirmModel(service, {
    workspace_path: "D:/repo",
    requirement_text: `设计章节:\n${DESIGN_SECTIONS_TEXT}\n\n计划章节:\n${PLANNING_SECTIONS_TEXT}`,
    session_alias: "task-remediation-cancel",
    start_phase: "implementation"
  });

  await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-remediation-cancel",
    action: "delivery_test_fail",
    feedback_text: "首次交付测试失败"
  });

  for (const round of [1, 2, 3]) {
    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-cancel",
      action: "remediation_approve",
      feedback_text: `确认第 ${round} 次整改`
    });
    await service.executeTask({
      workspace_path: "D:/repo",
      requirement_text: "需求",
      session_alias: "task-remediation-cancel",
      action: "delivery_test_fail",
      feedback_text: `第 ${round} 次整改后仍失败`
    });
  }

  const cancelled = await service.executeTask({
    workspace_path: "D:/repo",
    requirement_text: "需求",
    session_alias: "task-remediation-cancel",
    action: "cancel_follow_up"
  });

  expect(cancelled.success).toBe(true);
  expect((cancelled.data as { workflow_status: string }).workflow_status).toBe("CANCELLED");
  expect((cancelled.data as { workflow_completed: boolean }).workflow_completed).toBe(false);
});
```

- [ ] **Step 6: 运行单元测试**

Run:

```powershell
npm run test:unit
```

Expected:

```text
PASS
```

### Task 08: 执行完整自动化验证

**Files:**

- No direct file edits.

- [ ] **Step 1: 类型检查**

Run:

```powershell
npm run typecheck
```

Expected:

```text
0 errors
```

- [ ] **Step 2: 全量测试**

Run:

```powershell
npm run test
```

Expected:

```text
Test Files: all passed
```

- [ ] **Step 3: 构建**

Run:

```powershell
npm run build
```

Expected:

```text
dist 生成成功，无 TypeScript 编译错误
```

- [ ] **Step 4: 插件准备**

Run:

```powershell
npm run prepare:plugin
```

Expected:

```text
插件构建产物准备完成
```

### Task 09: 执行本机真实业务交付测试

**Files:**

- Create: `runtime/delivery-closure-<timestamp>/delivery-record.md`

- [ ] **Step 1: 卸载旧插件**

Run:

```powershell
npm run plugin:uninstall-local
```

Expected:

```text
旧插件卸载完成；如果旧插件不存在，也必须有明确提示。
```

- [ ] **Step 2: 安装当前插件**

Run:

```powershell
npm run plugin:install-local
```

Expected:

```text
当前插件安装到本机 Codex 插件目录。
```

- [ ] **Step 3: 验证本机依赖**

Run:

```powershell
opencode --version
codex --version
```

Expected:

```text
两个命令均能返回版本号。
```

- [ ] **Step 4: 打开 Codex CLI 真实入口**

Run:

```powershell
codex
```

Expected:

```text
进入可交互 Codex CLI。
```

- [ ] **Step 5: 使用真实业务语言触发插件**

在 Codex CLI 输入：

```text
$team-delegate 当前已经有方案和计划，直接进入实施。实施完成后必须先跑真实交付测试；如果测试失败，先形成整改方案和整改计划，最多由 ACP 整改 3 次；超过 3 次仍未通过时，由主会话接手整改或取消后续工作。
```

Expected:

```text
插件按业务语言判断进入计划实施，选择模型后推进 ACP。
```

- [ ] **Step 6: 人为制造首次交付测试失败**

业务测试时将首次交付结果判定为失败，向插件反馈：

```text
失败位置：真实 Codex CLI 业务链路。
用户输入：$team-delegate 当前已经有方案和计划，直接进入实施。
实际表现：本次故意判定首次交付测试未通过，用于验证整改闭环。
预期表现：插件必须记录失败材料，形成整改方案和整改计划，等待确认后整改。
复现步骤：安装插件，打开 Codex CLI，输入上述真实业务语言。
```

Expected:

```text
插件进入整改方案确认，不直接完成。
```

- [ ] **Step 7: 确认整改并等待实施**

在 Codex CLI 中确认：

```text
确认按当前整改方案和整改计划继续实施。
```

Expected:

```text
ACP 执行整改，整改完成后插件回到等待真实交付测试。
```

- [ ] **Step 8: 执行复测并反馈通过**

重新执行同一条业务链路检查，确认通过后反馈：

```text
真实业务交付测试通过：安装、加载、自然语言触发、失败整改、同链路复测均符合设计目标。
```

Expected:

```text
插件进入完成状态。
```

- [ ] **Step 9: 写交付记录**

记录文件内容必须包含：

```markdown
# 业务交付闭环交付测试记录

## 环境

## 安装结果

## 真实业务输入

## 首次失败材料

## 整改方案和计划摘要

## 整改实施结果

## 同链路复测结果

## 最终结论
```

## 11. 测试策略

- 单元测试覆盖状态机和业务响应。
- Schema 测试覆盖动作输入约束。
- 集成测试覆盖工具层参数透传。
- 构建验证覆盖 TypeScript 输出。
- 插件安装验证覆盖本机安装链路。
- 真实业务交付测试覆盖最终用户路径。

## 12. 需求到验收映射

| 需求 | 开发任务 | 验收场景 |
| --- | --- | --- |
| 实施完成不能直接完成 | Task 01, Task 03 | DS-01 |
| 交付测试通过后才完成 | Task 03, Task 04, Task 07 | DS-02 |
| 交付测试失败进入整改 | Task 03, Task 04, Task 07 | DS-03 |
| 整改后回到同链路复测 | Task 03, Task 07 | DS-04 |
| 完成 3 次整改后用户决策 | Task 03, Task 04, Task 07 | DS-05 |
| 用户可见输出业务导向 | Task 04, Task 06 | DS-01 到 DS-05 |
| 真实业务交付测试闭环 | Task 09 | DS-01 到 DS-05 |

## 13. 最终交付清单

- [ ] `src/session/bridge-service.ts` 已实现交付闭环状态机。
- [ ] `src/mcp-tools/schemas.ts` 已实现新动作校验。
- [ ] `src/plugin/mcp-server.ts` 已同步工具 schema。
- [ ] `skills/team-delegate/SKILL.md` 已同步业务流程规则。
- [ ] `README.md` 已说明业务交付闭环。
- [ ] 单元测试通过。
- [ ] 集成测试通过。
- [ ] 交付契约测试通过。
- [ ] 构建通过。
- [ ] 插件本机安装通过。
- [ ] Codex CLI 真实业务交付测试通过。
- [ ] 失败整改与复测记录已保存。

## 14. 上下文恢复说明

如果上下文被压缩，继续本任务时从以下事实恢复：

- 当前任务：优化 `team-delegate` 插件，新增业务交付闭环。
- 设计方案：`docs/superpowers/specs/2026-05-14-business-delivery-closure-workflow-design.md`。
- 实施计划：当前文件。
- 当前阶段：计划制定完成，尚未开始代码实施。
- 下一步：用户审核本计划；通过后按 Task 01 到 Task 09 实施。
- 最关键约束：ACP 实施完成不能等同于业务交付完成；只有真实业务交付测试通过，才能进入最终完成。
