# 实施阶段持续跟进交付失败整改设计文档

## 1. 问题摘要

- Bug 名称：实施阶段未形成可观察运行态，导致持续跟进交付链路无法真实验收
- 影响对象：通过 Codex CLI 使用团队委派流程推进实施阶段的最终用户
- 影响业务链路：`自然语言触发团队委派 -> 进入实施 -> 观察持续跟进 -> 长时间无进展再决策 -> 真实交付测试`
- 当前失败结果：
  - 真实 Codex CLI 会话中，实施模型确认后很快直接返回“等待交付测试”，用户没有看到可观察的 `RUNNING_IMPLEMENTATION` 或 `RUNNING_REMEDIATION` 运行窗口。
  - 因为运行窗口没有在真实入口里形成，`docs/团队委派交付测试必过表.md` 中依赖运行态观察的 DT-01、DT-02、DT-03、DT-04、DT-05、DT-06、DT-07、DT-10、DT-11、DT-12、DT-13 都无法建立真实通过证据。
  - 当前真实 Codex CLI 宿主环境未暴露 `automation_update` 或等价 heartbeat 工具，即使仓库内逻辑修完，也无法在当前环境中证明“线程会自动回来持续跟进”。
- 修复后预期业务结果：
  - 从真实 Codex CLI 自然语言入口进入实施后，首轮必须能让用户观察到“当前仍在计划实施/整改实施阶段”的运行态。
  - 运行态下，主会话能够围绕真实 follow-up 节奏进行持续跟进验证，不会被同步窗口直接吞掉。
  - 宿主环境具备 heartbeat 工具时，DT-01 到 DT-13 可以按同链路逐项过表；宿主环境不具备时，系统必须如实暴露“无法建立真实自动跟进”，不能伪装已满足交付要求。

## 2. 失败事实

- 触发入口：已安装插件的真实 Codex CLI 自然语言入口。
- 用户输入：
  - `$team-delegate 帮我用团队委派流程完成这个插件的修复。方案文档在 docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md，计划文档在 docs/superpowers/plans/2026-05-16-impl-progress-followup-optimization-plan.md。设计和计划已经确认，直接进入实施。如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。过程中有进展就告诉我，没动静太久再问我是否接手。`
  - `请新建一个团队委派任务，任务名固定为 delivery-followup-live-20260519-214413。$team-delegate 帮我用团队委派流程完成这个插件的修复。方案文档在 docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md，计划文档在 docs/superpowers/plans/2026-05-16-impl-progress-followup-optimization-plan.md。设计和计划已经确认，直接进入实施。如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。过程中有进展就告诉我，没动静太久再问我是否接手。`
- 实际表现：
  - `npm run plugin:install-local` 成功，插件可安装。
  - `codex plugin list` 可见 `acp-codex2opencode@acp-local installed, enabled`。
  - 两条真实 CLI 会话都命中 `team-delegate`，并能进入实施模型确认。
  - 模型确认后，都会在同步等待后直接返回 `NEEDS_DELIVERY_TEST`，没有让真实用户看到运行态持续跟进窗口。
  - 额外探测表明：当前真实 Codex CLI 会话中没有 `automation_update` 或等价 heartbeat 工具。
- 预期表现：
  - 真实用户进入实施后，至少要先拿到一次“当前仍在计划实施/整改实施”的业务态输出，再进入后续持续跟进或交付测试。
  - 如果宿主环境无法建立真实 heartbeat，系统必须把这点作为交付阻塞事实表达出来，而不是继续承诺“会自动回来跟进”。
- 失败时间或场景：2026-05-19，真实 Codex CLI 交付测试。
- 复现频率：稳定复现。
- 证据：
  - `runtime/delivery-followup-optimization-20260519-214413/codex-exec.jsonl`
  - `runtime/delivery-followup-live-20260519-214413/codex-exec.jsonl`
  - `src/session/bridge-service.ts:3010`：实施阶段启动后直接在 runner 内调用 `runImplementationPhase`，完成后立刻 `enterDeliveryTestGate`。
  - `src/session/bridge-service.ts:3074`：入口返回前会执行 `waitForWorkflowShortSyncWindow`，允许 runner 在同步窗口内跑完。
  - `tests/unit/bridge-service-workflow.test.ts:1596`：当前测试把“跳过到 implementation 后直接返回 `NEEDS_DELIVERY_TEST`”当成预期。
  - `runtime/.../codex-exec.jsonl` 中的真实探测结果：当前宿主看不到 `automation_update`。

## 3. 影响范围

- 受影响功能：
  - 实施阶段与整改实施阶段的首轮用户可见状态返回。
  - 运行态持续跟进的真实交付测试链路。
  - 对“自动回来跟进”能力的业务承诺可信度。
- 受影响用户动作：
  - 用户确认模型后观察实施进展。
  - 用户等待 1-2 分钟自动回来。
  - 用户在长时间无进展后做“继续等待/主会话接手”决策。
- 受影响状态或数据：
  - `start/model_confirm/planning_approve/remediation_approve` 的首次返回状态。
  - `progress_update`、`follow_up_policy`、`user_decision_policy` 的真实可观察使用时机。
- 不受影响范围：
  - 方案/计划阶段的阶段判定。
  - 交付测试通过后进入 `COMPLETED` 的闭环原则。
  - `continue_wait`、`handoff_to_main`、`delivery_test_fail` 的业务语义。
- 不修复风险：
  - 用户在真实入口中无法观察到插件承诺的持续跟进阶段。
  - 交付测试会持续卡在“实现已结束，但运行态证据不足”的状态。
  - 主会话可能口头承诺自动跟进，但真实线程没有自动唤醒能力，形成交付失真。

## 4. 根因分析

### 4.1 直接原因

- 实施与整改实施启动后，服务会先等待一个同步窗口；如果 ACP 在这个窗口里很快完成，入口返回时已经被切到 `NEEDS_DELIVERY_TEST`，真实用户拿不到运行态。

### 4.2 深层原因

- 当前状态机把“快速完成 implementation”视为更优先的返回结果，但交付测试规则要求真实用户必须观察到运行态和后续持续跟进节奏，两者发生了业务目标冲突。
- 当前单元测试把“implementation 首次返回直接到 `NEEDS_DELIVERY_TEST`”写成了绿灯预期，导致仓库内没有契约来保护“实施首回合必须先暴露运行态”的交付需求。
- 自动 heartbeat 能力依赖宿主 Codex 运行时，而不是仓库内部状态机；当前宿主没有暴露该工具，导致真实交付测试的外部前提缺失。

### 4.3 为什么现有测试没有发现

- 现有测试重点覆盖了阶段流转正确性和交付测试闭环，但没有把“真实用户首轮必须看到 `RUNNING_IMPLEMENTATION` / `RUNNING_REMEDIATION`”写成契约。
- 现有测试没有模拟“宿主缺少 heartbeat 工具时必须如实暴露阻塞”的真实交付门禁。

### 4.4 证据链

1. `src/session/bridge-service.ts:3010-3013`：实施阶段启动后在 runner 内直接执行 implementation，并在完成后进入 `NEEDS_DELIVERY_TEST`。
2. `src/session/bridge-service.ts:3074-3083`：入口返回前会在同步窗口内等待 pending task 结束。
3. `tests/unit/bridge-service-workflow.test.ts:1596-1607`：当前测试将“设计和计划都存在时，实施入口直接返回 `NEEDS_DELIVERY_TEST`”视为正确行为。
4. `runtime/delivery-followup-live-20260519-214413/codex-exec.jsonl`：真实唯一任务名链路同样直接跳到 `NEEDS_DELIVERY_TEST`，证明不是旧任务污染。
5. `runtime/delivery-followup-optimization-20260519-214413/codex-exec.jsonl`：真实宿主环境中缺少 `automation_update` 或等价 heartbeat 工具。

## 5. 修复目标与非目标

### 5.1 修复目标

1. 实施或整改实施首轮进入后，至少返回一次可观察的运行态，不能被同步窗口直接吞掉。
2. 为运行态首回合建立自动化契约测试，覆盖 implementation 与 remediation 两条业务链路。
3. 调整文档与真实交付测试脚本口径，明确“运行态首回合可见”是交付前置条件。
4. 把宿主 heartbeat 能力缺失记录为交付阻塞事实；当真实环境缺该能力时，不再把 DT-01/02/05/12/13 误判为通过。

### 5.2 非目标

1. 不改变模型选择策略。
2. 不改变 `continue_wait`、`handoff_to_main`、`delivery_test_fail` 的动作定义。
3. 不在本仓库伪造 `automation_update` 工具，也不通过轮询冒充真实 heartbeat。

## 6. 修复设计

### 6.1 状态机变化

- 实施与整改实施入口在 phase runner 启动后，应优先对真实用户暴露一次 `RUNNING_IMPLEMENTATION` 或 `RUNNING_REMEDIATION`。
- 即使 implementation/rework 在同步窗口内完成，也不能让首次响应直接跳到 `NEEDS_DELIVERY_TEST`；交付测试或后续 `status` 才负责观察后继阶段。

### 6.2 用户可见行为变化

1. 用户确认实施模型后，首屏先看到“当前仍在计划实施阶段，我会按 1-2 分钟节奏持续跟进”的业务提示。
2. 若 implementation 很快完成，下一轮业务动作再进入“等待交付测试”，而不是吞掉运行态。
3. 若宿主环境缺少 heartbeat 工具，真实交付测试报告必须明确该阻塞事实，不能承诺“我会自动继续跟进”。

### 6.3 数据结构或接口变化

- 维持现有 `workflow_status` 枚举不变。
- 调整 `start`、`model_confirm`、`planning_approve`、`remediation_approve` 相关入口的首次响应判定策略，增加“首轮运行态优先返回”的契约。
- 如有必要，在测试辅助输出中增加“首次运行态已暴露”标记，但不把内部标记暴露为用户主提示。

### 6.4 错误处理变化

- 若真实宿主缺少 heartbeat 工具，本仓库不伪造成功，而是在交付测试材料中记录为阻塞事实。
- 若 runner 启动失败，仍按现有 `FAILED` 或会话决策规则处理，不因为“首轮必须暴露运行态”而隐藏真实异常。

### 6.5 兼容性处理

- 不破坏现有阶段枚举和对外动作集合。
- 已依赖 `NEEDS_DELIVERY_TEST` 的调用方需要改为容忍“首轮看到运行态、随后 `status` 或下一步进入交付测试”的新时序。

### 6.6 回退方案

- 若“首轮运行态优先返回”引发不可接受的兼容问题，可回退至旧时序，但这意味着真实交付测试仍然无法通过，不能宣称问题解决。

## 7. 修改范围

- `src/session/bridge-service.ts`：调整 implementation/rework 首次响应时序与运行态暴露策略。
- `tests/unit/bridge-service-workflow.test.ts`：新增红灯测试，覆盖 implementation 与 remediation 首回合先返回运行态。
- `README.md`：同步运行态首回合可见与真实 heartbeat 前提说明。
- `docs/superpowers/plans/2026-05-19-impl-progress-followup-delivery-remediation-plan.md`：承接本整改设计的实施计划。

## 8. 自动化验证目标

- 红灯测试（先失败）：
  1. implementation 入口在实现很快完成时，首次返回仍应为 `RUNNING_IMPLEMENTATION`。
  2. remediation 入口在整改很快完成时，首次返回仍应为 `RUNNING_REMEDIATION`。
  3. 随后的 `status` 或下一阶段调用，才进入 `NEEDS_DELIVERY_TEST`。
- 回归测试：
  - 既有 `progress_update.summary`、沉默阈值决策、整改轮次、交付测试闭环测试保持通过。
  - 文档与交付测试材料中不得继续把“缺少 heartbeat 工具的环境”描述成已满足自动持续跟进。

## 9. 交付测试目标

- 真实入口：
  1. 安装当前插件。
  2. 刷新/重启 Codex 环境。
  3. 打开真实 Codex CLI。
  4. 使用自然语言触发团队委派实施。
- 真实业务语言示例：
  - “帮我用团队委派流程完成这个插件的修复。设计和计划已经确认，直接进入实施。过程中有进展就告诉我，没动静太久再问我是否接手。”
- 复测链路：
  1. 使用唯一任务名从真实 CLI 入口再次发起同链路。
  2. 确认实施模型后，首轮先看到计划实施运行态。
  3. 在宿主具备 heartbeat 工具时，继续观察 1-2 分钟自动回来、沉默阈值决策、默认继续、恢复进展清空旧等待等完整链路。
  4. 若宿主仍缺 heartbeat 工具，必须把该点记录为阻塞事实，本次交付测试仍判失败，不能宣布完成。
- 通过标准：
  - 仓库内首轮运行态问题修复。
  - 宿主环境具备 heartbeat 工具并能支撑 DT-01 到 DT-13 全部过表。
- 失败后闭环：
  - 记录失败位置、用户输入、实际表现、预期表现、复现步骤；若仍是仓库逻辑问题，继续进入下一轮整改；若是宿主能力缺失，则转为环境阻塞说明。

## 10. 风险与回退

- 风险：
  1. 改变首次响应时序后，部分既有测试或调用预期需要同步更新。
  2. 仓库内修复完成后，仍可能因为宿主没有 heartbeat 工具而无法完成真实交付过表。
- 回退路径：
  1. 先限定修改在 implementation/rework 首轮返回路径，不扩大到其他阶段。
  2. 若交互兼容性不满足预期，回退代码改动，同时保留本整改文档作为未解决证据。

## 11. 上下文恢复说明

- 当前进度：
  - 已根据真实 Codex CLI 交付失败事实形成整改设计。
- 下一步：
  1. 生成对应整改计划文档。
  2. 你确认整改方案和整改计划后，再进入编码实施。
  3. 由于预计改动超过 3 个文件，实施前需新建分支。
