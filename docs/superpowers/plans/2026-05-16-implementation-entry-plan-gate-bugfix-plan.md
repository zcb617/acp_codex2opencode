# 实施入口未严格执行计划文档门禁-BUG修改计划

## 1. Bug 与设计来源

- Bug 名称：实施入口未严格执行计划文档门禁。
- 设计文档：`docs/superpowers/specs/2026-05-16-implementation-entry-plan-gate-bugfix-design.md`
- 当前失败链路：用户自然语言要求直接进入实施并给出不合规计划时，插件先进入模型选择，未先拦截计划质量。
- 本计划目标：补齐实施入口前置计划门禁，确保不合规计划无法进入模型选择与实施。
- 本计划不处理：模型推荐策略、ACP 内部实现逻辑、与本 Bug 无关的文档规则扩展。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 实施入口先执行计划门禁 | Task 01 | UT-START-GATE-01 | DT-START-GATE-01 | 待实施 |
| 门禁失败返回可补充路径 | Task 02 | UT-START-GATE-02 | DT-START-GATE-01 | 待实施 |
| 门禁失败禁止进入模型选择/实施 | Task 03 | UT-START-GATE-03 | DT-START-GATE-02 | 待实施 |
| 增加回归覆盖防止回退 | Task 04 | UT-START-GATE-04 | DT-START-GATE-02 | 待实施 |

## 3. 实施任务拆分

### Task 01: 在实施入口增加计划文档前置门禁

**目标：** 在 `start_phase=implementation` 的入口分支先执行计划门禁。

**设计来源：** 设计文档“6. 修复设计 / 状态机变化”。

**文件范围：** `src/session/bridge-service.ts`

**实施步骤：**

1. 识别 `start_phase=implementation` 且 `development_type` 已判定场景。
2. 从 `requirement_text` 中解析计划文档路径或可用计划上下文来源。
3. 调用现有文档质量评估逻辑，执行 BUG/Feature 对应计划门禁。
4. 将门禁结果写入统一响应分支，作为后续准入条件。

**伪代码：**

```text
输入：start 请求（workspace_path, requirement_text, start_phase, development_type）
if start_phase != implementation:
  走原有流程
planSource = parsePlanSource(requirement_text)
if planSource 为空:
  输出 NEEDS_USER_INPUT（提示补充计划来源）
gateResult = evaluatePlanDocument(planSource, development_type)
输出：gateResult（通过 -> 继续；失败 -> 返回缺项）
```

**验证命令：** `npx vitest run tests/unit/bridge-document-gate-quality.test.ts -t "implementation"`

**对应交付场景：** DT-START-GATE-01

**完成标准：** 入口门禁在实施分支生效，门禁失败不会进入模型选择。

### Task 02: 门禁失败返回业务可补充响应

**目标：** 门禁失败时统一返回可补充说明，而非系统异常。

**设计来源：** 设计文档“6. 修复设计 / 错误处理变化”。

**文件范围：** `src/session/bridge-service.ts`

**实施步骤：**

1. 复用 `buildNeedsUserInputResponse` 语义并注入计划缺项。
2. 在 `business_reason/user_message/next_business_action` 输出业务语言。
3. 挂载 `missing_context`/`missing_sections`，便于用户按项修复。
4. 审计日志记录门禁失败原因。

**伪代码：**

```text
输入：planGateResult(issues[])
if issues.length == 0:
  return continueFlow
build businessReason = "计划文档不满足实施门禁"
build nextAction = "补齐缺项后重新 start"
return NEEDS_USER_INPUT + issues + businessReason + nextAction
输出：可补充响应对象
```

**验证命令：** `npx vitest run tests/unit/bridge-document-gate-quality.test.ts -t "NEEDS_USER_INPUT"`

**对应交付场景：** DT-START-GATE-01

**完成标准：** 返回中能清晰看到缺项，不出现内部术语主提示。

### Task 03: 阻断模型选择与实施启动

**目标：** 门禁失败时禁止进入 `NEEDS_MODEL_*` 与 `RUNNING_IMPLEMENTATION`。

**设计来源：** 设计文档“5. 修复目标与非目标 / 目标3”。

**文件范围：** `src/session/bridge-service.ts`, `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 在 `handleStartWithModelGate` 前置插入门禁判断。
2. 门禁失败时提前 `return`，不执行 `cachePendingStartInput`。
3. 增加状态断言测试：失败后不出现模型选择状态。
4. 增加回归断言：门禁通过时仍按原流程进入模型确认/选择。

**伪代码：**

```text
输入：start request
gate = precheckImplementationPlan()
if gate.failed:
  return NEEDS_USER_INPUT
cachePendingStartInput()
modelGate = resolveModelGate()
if modelGate.needConfirm:
  return NEEDS_MODEL_CONFIRM
输出：仅在 gate.pass 时允许进入模型分支
```

**验证命令：** `npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**对应交付场景：** DT-START-GATE-02

**完成标准：** 不合规计划不会触发“请选择模型”提示。

### Task 04: 补齐回归测试矩阵

**目标：** 覆盖实施入口门禁失败与通过两条路径，防止回退。

**设计来源：** 设计文档“8. 自动化验证目标”。

**文件范围：** `tests/unit/bridge-document-gate-quality.test.ts`, `tests/delivery/team-delegate-skill.delivery.test.ts`

**实施步骤：**

1. 新增失败样例：`tests/2026-05-16-erp-ai-adapter-enhancement-plan.md`。
2. 新增通过样例：构造满足 BUG/Feature 计划规则的最小合规文档。
3. 增加断言：失败返回 `NEEDS_USER_INPUT`；通过才允许进入模型分支。
4. 同步 delivery 文案断言，保证输出业务语言。

**伪代码：**

```text
输入：badPlan, goodPlan
resultBad = runStartWithPlan(badPlan)
assert resultBad.stage == NEEDS_USER_INPUT
resultGood = runStartWithPlan(goodPlan)
assert resultGood.stage in [NEEDS_MODEL_CONFIRM, NEEDS_MODEL_SELECTION, RUNNING_IMPLEMENTATION]
输出：回归测试通过
```

**验证命令：** `npm run test:delivery && npx vitest run tests/unit/bridge-document-gate-quality.test.ts`

**对应交付场景：** DT-START-GATE-02

**完成标准：** 新增回归用例全部通过，且旧用例无回归。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-START-GATE-01 | 不合规计划被放行到模型选择 | 返回 `NEEDS_MODEL_*` 或出现模型选择文案 | 返回 `NEEDS_USER_INPUT` 且包含缺项 |
| UT-START-GATE-02 | 门禁失败后仍启动实施 | 进入 `RUNNING_IMPLEMENTATION` | 门禁失败后无实施启动 |
| UT-START-GATE-03 | 缺少计划来源未被识别 | 继续模型分支 | 返回补充计划来源提示 |
| UT-START-GATE-04 | 合规计划误拦截 | 返回 `NEEDS_USER_INPUT` | 可正常进入模型分支 |

## 5. 自动化验证计划

1. 精准回归测试
- 命令：`npx vitest run tests/unit/bridge-document-gate-quality.test.ts`
- 证明：实施入口门禁新增逻辑与伪代码质量规则同时生效。

2. 相关模块测试
- 命令：`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`
- 证明：工作流阶段流转未被破坏。

3. 全量测试
- 命令：`npm test`
- 证明：历史功能未回归。

4. 编译或构建
- 命令：`npm run typecheck`、`npm run build`
- 证明：类型与构建链路可交付。

5. 插件或安装检查
- 命令：`npm run plugin:uninstall-local && npm run plugin:install-local`
- 证明：本地安装链路可用，便于真实入口交付测试。

## 6. 真实业务交付测试计划

### DT-START-GATE-01 不合规计划必须被入口门禁拦截

**业务目标：** 不合规计划不得进入实施前置流程。

**真实环境：** Windows 本机 + 已安装插件 + Codex CLI。

**真实入口：** `codex exec` 自然语言触发团队委派。

**用户业务语言：**

```text
帮我用团队委派流程完成这个开发任务。方案和计划都已经确认，请直接进入实施。计划文档在 tests/2026-05-16-erp-ai-adapter-enhancement-plan.md。
```

**操作步骤：**

1. 先执行插件安装命令并重启/刷新环境。
2. 在仓库根目录运行上述自然语言请求。
3. 观察首屏回复是否先返回计划缺项而非模型选择。

**期望用户可见结果：**

- 明确提示“计划文档不满足实施门禁，需要补齐哪些项”。
- 不出现“请选择模型 1/2”。

**辅助证据：**

- `runtime/*-last-message.txt`
- 终端日志（仅辅助，不替代用户可见结果）

**通过标准：**

- 首轮返回 `NEEDS_USER_INPUT` + 缺项说明。
- 无模型选择提示、无实施启动提示。

**失败判定：**

- 出现模型选择提示或进入实施，即判定失败。

**失败后整改与再测试：**

- 记录失败事实 -> 补充整改任务 -> 重跑自动化 -> 重跑本用例。

### DT-START-GATE-02 合规计划可放行到模型分支

**业务目标：** 修复后不误伤合规计划流程。

**真实环境：** 同 DT-START-GATE-01。

**真实入口：** `codex exec` 自然语言触发团队委派。

**用户业务语言：**

```text
方案和计划已确认，请直接进入实施。计划文档使用合规版本。
```

**操作步骤：**

1. 准备合规计划文档路径。
2. 使用同类自然语言触发实施入口。
3. 观察是否进入模型确认/选择分支。

**期望用户可见结果：**

- 不再出现计划缺项拦截。
- 可进入模型确认或模型选择。

**辅助证据：**

- `runtime/*-last-message.txt`

**通过标准：**

- 返回 `NEEDS_MODEL_CONFIRM` 或 `NEEDS_MODEL_SELECTION`。

**失败判定：**

- 合规计划仍被拦截，判定失败。

**失败后整改与再测试：**

- 记录误拦截条件 -> 修订规则 -> 重跑自动化 -> 重跑本用例。

## 7. 交付测试失败整改记录

### Round 1

- 失败场景：不合规计划通过实施入口被放行。
- 输入数据：自然语言请求 + `tests/2026-05-16-erp-ai-adapter-enhancement-plan.md`。
- 期望结果：首轮返回计划缺项并停留补充阶段。
- 实际结果：首轮进入模型选择（提示 1/2）。
- 根因分析：实施入口缺少前置计划门禁分支，校验仅在计划生成回合执行。
- 修复方案：在 `start_phase=implementation` 引入入口门禁并阻断模型分支。
- 复测命令：`codex exec "...直接进入实施..."`
- 复测结果：待实施后更新。

## 8. 设计完成核对清单

- [ ] 设计中的失败事实已被测试覆盖或交付测试覆盖。
- [ ] 设计中的每个修复目标已完成。
- [ ] 设计中的非目标没有被越界实施。
- [ ] 设计中的修改范围已完成或明确取消原因。
- [ ] 设计中的自动化验证目标已执行。
- [ ] 设计中的交付测试目标已执行。
- [ ] 交付测试失败后的整改记录已闭环。
- [ ] 最终用户可见结果符合业务目标。

## 9. 上下文恢复说明

- 当前进度：已完成整改计划编写，待你确认后进入代码实施。
- 下一步：按 Task 01-04 依次改代码、补测试、执行自动化与真实入口复测。
- 恢复入口：从 `docs/superpowers/plans/2026-05-16-implementation-entry-plan-gate-bugfix-plan.md` 继续执行。
- 已完成任务：失败复现、根因定位、设计文档与计划文档落盘。
- 已通过测试：历史自动化前置在失败复现前已通过（typecheck/unit/delivery）。
- 最近交付测试结果：失败（不合规计划被放行至模型选择）。
- 不可破坏约束：不得绕过计划门禁直接进入实施；不得用内部工具语言替代业务语言。
