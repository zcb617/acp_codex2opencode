# 无 Heartbeat 场景整改持续跟进提前停步 BUG 修改设计文档

## 1. 问题摘要

- Bug 名称：无 heartbeat 场景下整改持续跟进在主会话回复后提前停步
- 影响对象：通过真实 Codex CLI 使用团队委派流程推进整改阶段的最终用户
- 影响业务链路：`自然语言触发团队委派 -> 进入整改实施 -> 主会话汇报整改进展并承诺继续跟进 -> 当前轮结束 -> 后续自动跟进丢失`
- 当前失败结果：
  - 第 3 次整改阶段中，主会话已经向用户输出“我继续按同一个节奏跟进，不在这里提前停住”之类的业务承诺，但随后线程没有再次自动回来。
  - 当宿主环境缺少 heartbeat 能力时，当前仓库中的 fallback 等待循环并没有真正绑定到主会话生命周期，导致“文案承诺继续跟进”和“执行体已经结束”同时存在。
  - implementation 跟进与 remediation 跟进本应共用同一套 1-2 分钟 follow-up 机制，但当前 fallback loop 实际只活在单次 `status` 调用内部，主会话一旦结束当前轮，这两条链路都会失效。
  - 这会直接击穿 `docs/团队委派交付测试必过表.md` 中 DT-01、DT-02、DT-05、DT-12、DT-13 的交付要求。
- 修复完成后应恢复的业务结果：
  - implementation 与 remediation 两条持续跟进链路都必须使用同一套 follow-up loop，只是阶段名称不同，业务语义不能分叉。
  - 只要主会话对用户承诺“后续会自动继续跟进”，系统就必须已经进入 heartbeat 或 same-turn-hold 的真实执行路径。
  - 若当前宿主没有 heartbeat，则必须由主会话在同一轮里保活并执行 `sleep -> 醒来 -> 再查状态`，而不是提前结束当前轮。

## 2. 失败事实

- 触发入口：
  - 已安装当前插件的真实 Codex CLI 自然语言入口。
- 用户输入：
  - 真实用户语义为“继续整改并持续跟进，有进展就告诉我，没动静太久再问我是否接手”。
- 实际表现：
  - 用户提供截图显示：第 3 次整改中，主会话先输出“整改继续在推进……我继续按同一个节奏跟进，不在这里提前停住。”
  - 该轮回复发出后，后续线程没有再次自动回来；用户需要重新触发对话才能继续观察状态。
  - 代码检查表明，无 heartbeat 时的 fallback 逻辑存在于 `status` 调用内部的等待门控中，而不是绑定在主会话响应后的真实线程生命周期上。
- 预期表现：
  - 如果主会话输出了“我会继续跟进”，则后续自动回来必须真实发生。
  - implementation 和 remediation 的跟进机制必须完全一致：有 heartbeat 时依赖 heartbeat，无 heartbeat 时依赖 same-turn hold。
  - 无 heartbeat 不应直接变成“主会话接手或取消”的业务分支，而应由当前轮继续保活直到下一次 follow-up。
- 失败时间或场景：
  - 2026-05-20，整改第 3 轮持续跟进阶段，由用户提供实际截图。
- 复现频率：
  - 从当前架构判断，该问题在“无 heartbeat 且主会话回复后结束当前轮”的场景下可稳定复现。
- 证据：
  - 用户提供的整改阶段截图，显示主会话文案承诺继续跟进但实际停住。
  - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:3206)：`waitForWorkflowFollowUpDue()` 只在当前 `status` 调用内 `sleep` 等待下一次跟进时间。
  - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:883)：`waitForWorkflowFollowUpDue()` 仅在 `action=status` 分支里触发。
  - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4600)：整改运行态对用户输出“我会按 1-2 分钟节奏持续跟进整改进展”。
  - [tests/unit/bridge-service-workflow.test.ts](/var/work/acp_codex2opencode/tests/unit/bridge-service-workflow.test.ts:1236)：当前测试只验证“后续再次调用 `status` 时，`timeout_default` 能自动继续”，没有验证“主会话发完消息后当前轮是否仍然活着”。

## 3. 影响范围

- 受影响功能：
  - implementation / remediation 运行态的持续跟进承诺。
  - `NEEDS_USER_DECISION` 的 60 秒默认继续等待承诺。
  - 顶层主会话在无 heartbeat 场景下的 same-turn-hold 保活执行。
- 受影响用户动作：
  - 用户等待整改进展。
  - 用户等待 1-2 分钟自动回来查状态。
  - 用户在 60 秒默认继续窗口中不回复，观察系统是否自动继续。
- 受影响状态或数据：
  - `follow_up_policy.next_follow_up_at`
  - `user_decision_policy.timeout_default_deadline_at`
  - `next_action_required=["status"]` / `["continue_wait", "handoff_to_main"]`
- 不受影响范围：
  - 方案制定、计划制定、模型选择、整改轮次计数本身。
  - `delivery_test_fail`、`remediation_approve`、`cancel_follow_up` 的业务语义。
- 如果不修复会造成什么交付风险：
  - 用户会持续看到“会继续跟进”的承诺，但真实线程已经停止。
  - 交付测试可能被误判为通过，而实际上 DT-01、DT-02、DT-05、DT-12、DT-13 已经失败。
  - 同样的问题会在 implementation 和 remediation 两条运行态链路反复出现。

## 4. 根因分析

### 4.1 直接原因

- 无 heartbeat 场景下的 fallback 等待循环写在 `status` 调用内部。只要这次 `status` 调用返回了结果，这个 `sleep -> 醒来 -> 再查状态` 的执行体也就结束了。
- 主会话在输出“我会继续跟进”的业务消息后结束了当前轮，因此同轮保活没有真正建立起来。

### 4.2 深层原因

- 当前架构把“无 heartbeat 时的 same-turn hold”放错了承载层。它应由顶层主会话 follow-up orchestration 承担，而不是由单次 `status` 调用局部承担。
- implementation 跟进与 remediation 跟进在业务上是同一套机制，但当前代码把等待循环埋在局部 `status` 调用里，导致两条链路共享同一种缺陷。
- 结果是：状态机负责产出“会继续跟进”的业务文案，但真实宿主是否保活当前轮，完全落在当前这次调用是否还活着，业务承诺与执行能力脱节。

### 4.3 为什么现有测试没有发现

- 现有单元测试重点验证“后续再次调用 `status` 时，poll 逻辑会不会进入下一阶段”，没有验证“主会话当前轮在发出业务消息后是否仍真实存在”。
- 现有 delivery/skill 测试覆盖了规则文案，要求“无 heartbeat 时必须在当前轮保活”，但没有把“顶层主会话不得在承诺后直接结束当前轮”写成执行契约。
- 因此仓库里同时存在：
  - 文档/技能层要求同轮保活；
  - 代码层只在 `status` 调用内部休眠；
  - 测试层未阻止主会话在承诺后直接结束当前轮。

### 4.4 证据链

1. `executeTask(action=status)` 内部才会执行 `waitForWorkflowFollowUpDue()`，说明 fallback wait 只在这次调用内部存在。[src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:883)
2. `waitForWorkflowFollowUpDue()` 使用 `await sleep(...)` 等待到下一次跟进时间，但函数返回后不会自我重启，也不会在主会话结束后继续存在。[src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:3206)
3. `RUNNING_REMEDIATION` 仍向用户承诺“我会按 1-2 分钟节奏持续跟进整改进展”，说明当前产品语义默认把持续跟进视为已成立。[src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4600)
4. implementation 与 remediation 都通过同一套 follow-up policy 向用户承诺后续会继续跟进，因此这不是整改专属逻辑，而是共享机制上的缺陷。[src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4552) [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4603)
5. 自动继续相关测试验证的是“下次 `status` 调用到来时是否自动继续”，而不是“当前业务回复发出后，线程是否仍被保活”。[tests/unit/bridge-service-workflow.test.ts](/var/work/acp_codex2opencode/tests/unit/bridge-service-workflow.test.ts:1236)

## 5. 修复目标与非目标

### 5.1 修复目标

1. implementation 与 remediation 运行态必须共用同一套 follow-up loop，不能出现 remediation 单独停步或单独分叉。
2. 无 heartbeat 场景下，same-turn-hold 必须上提到顶层主会话生命周期，而不是只活在单次 `status` 调用里。
3. 只要当前仍是运行态或允许默认继续，就必须保证当前轮不会提前结束，直到下一次自动跟进真正发生。
4. 为 implementation / remediation / NEEDS_USER_DECISION 三条链路补齐自动化契约测试，覆盖“主会话承诺后当前轮是否仍真实存活”的逻辑边界。
5. 让 `docs/团队委派交付测试必过表.md` 的 DT-01、DT-02、DT-05、DT-12、DT-13 在仓库契约和真实交付测试中保持一致。

### 5.2 非目标

1. 不在本仓库伪造 heartbeat 工具。
2. 不依赖人工补发消息、手动再点一次 `status` 或再次输入自然语言来冒充自动继续。
3. 不修改整改次数上限、模型选择策略或交付测试通过/失败的业务定义。
4. 不把“无 heartbeat 时转由主会话接手或取消”当作本次修复方案。
5. 不把“延长 sleep 时间”当作修复方案。

## 6. 修复设计

### 6.1 状态机变化

- 保持现有 implementation / remediation / `NEEDS_USER_DECISION` 的业务状态定义不变，不新增“无 heartbeat 就阻断”的业务分支。
- 把 same-turn-hold loop 从局部 `status` 调用上提到顶层 follow-up orchestration：
  - 运行态拿到 `follow_up_policy.next_follow_up_at` 后，如果没有 heartbeat，当前轮不得结束。
  - 等待决策态拿到 `timeout_default_deadline_at` 后，如果没有 heartbeat，当前轮同样不得结束。
  - 到时间点后，必须在同一任务闭环里再次查询状态，而不是依赖新的外部触发。
- `waitForWorkflowFollowUpDue()` 可继续作为局部辅助，但不能再承担主会话级自动跟进职责。

### 6.2 用户可见行为变化

1. 用户看到的 implementation 跟进与 remediation 跟进语义保持一致，都是“我会按 1-2 分钟节奏继续跟进”。
2. 当宿主没有 heartbeat 时，用户体验不应变成新的业务分叉；差别只体现在执行层由当前轮保活承担自动回来。
3. 如果当前轮实际上没有被保活，则这是实现缺陷，不是产品预期行为。

### 6.3 数据结构或接口变化

- 重点不在新增业务状态，而在给顶层主会话 follow-up orchestration 提供足够的运行时信息，例如：
  - 当前是否已有 heartbeat 能力；
  - 当前 follow-up 的下一次到期时间；
  - 当前轮是否必须 same-turn hold。
- `ExecuteTaskSchema` 是否新增字段，需要以最小改动为原则评估；如果现有宿主上下文已足够判断，则优先不扩协议。
- tool 描述、README、skill 文案需要同步“无 heartbeat 时必须同轮保活，不允许提前结束当前轮”的执行契约。

### 6.4 错误处理变化

- 当进入需要后续自动跟进的阶段但当前轮仍被结束时，必须把它视为 follow-up orchestration 失败，而不是用户业务决策。
- 当宿主没有 heartbeat 时，same-turn-hold 没有生效就属于实现缺陷；不能退化成“主会话接手/取消”的正常分支。
- 当 60 秒默认继续场景中当前轮未被保活，真实交付测试必须判失败。

### 6.5 兼容性处理

- 对 design / planning / delivery test review 等不要求自动回来能力的阶段，不改变现有行为。
- 对 implementation / remediation / default-continue 决策阶段，统一走顶层 follow-up loop。
- 旧调用路径如果把当前轮结束得过早，会在真实交付测试中继续暴露失败，需要同步修正高层 orchestration。

### 6.6 回退方案

- 若顶层 same-turn-hold 改动引发兼容问题，可临时保留局部 `status` wait 逻辑作为辅助，但不能回退到“回复已发出、当前轮已结束”的行为。
- 不允许回退为“继续口头承诺会自动回来，但实际上当前轮已经结束”。

## 7. 修改范围

- `src/session/bridge-service.ts`：梳理局部 `status` wait 与顶层 follow-up loop 的边界。
- `src/plugin/mcp-server.ts`：同步高层工具描述，明确无 heartbeat 时必须保活当前轮。
- `skills/team-delegate/SKILL.md`：同步业务规则，明确 same-turn-hold 是 heartbeat 缺失时的正常 fallback，而不是业务阻断。
- `README.md`：同步产品约束与真实交付语义。
- `tests/unit/bridge-service-workflow.test.ts`：新增红灯测试和回归测试。
- `tests/delivery/team-delegate-skill.delivery.test.ts`：新增技能/文案契约测试。
- `docs/团队委派交付测试必过表.md`：必要时补充“当前轮未结束”的检查项。

## 8. 自动化验证目标

- 红灯测试：
  1. implementation 运行态在无 heartbeat 场景下，顶层主会话不得在发出承诺后直接结束当前轮。
  2. remediation 运行态在无 heartbeat 场景下，顶层主会话同样不得提前结束当前轮。
  3. `NEEDS_USER_DECISION + allow_timeout_default=true` 时，无 heartbeat 场景必须在当前轮保活到超时后继续判断。
  4. heartbeat 场景下，现有运行态/默认继续语义仍保持成立。
- 回归测试：
  - 首轮运行态暴露契约继续通过。
  - 整改三轮上限、`continue_wait`、`handoff_to_main`、`delivery_test_fail` 等既有流程保持通过。
  - skill / README / tool description 的交付规则断言同步通过。

## 9. 交付测试目标

- 真实入口：
  1. 安装当前插件。
  2. 刷新或重启 Codex 环境。
  3. 打开真实 Codex CLI。
  4. 使用自然语言触发团队委派 implementation 与 remediation 链路。
- 真实业务语言：

```text
帮我用团队委派流程继续这次整改。过程中有进展就告诉我；如果当前环境做不到自动继续跟进，就直接告诉我不要假装继续跟。
```

- 复测链路：
  1. 在宿主具备 `heartbeat` 能力时，验证 implementation/remediation 的持续跟进与 60 秒默认继续仍可自动发生。
  2. 在宿主不具备 `heartbeat` 能力时，验证主会话不会结束当前轮，且到点后会在同一任务闭环里自动回来。
  3. 验证 implementation 与 remediation 在上述两种执行路径下行为一致，不出现整改专属分叉。
  4. 逐项覆盖 `docs/团队委派交付测试必过表.md` 中 DT-01 到 DT-13，特别是 DT-01、DT-02、DT-05、DT-12、DT-13。
- 通过标准：
  - 仓库内自动化测试全部通过。
  - 真实 CLI 中不会再出现“嘴上说继续跟，线程实际已结束”的现象。
  - 宿主缺少 heartbeat 时，当前轮会真实保活并继续同一条 follow-up 链路。
- 如果复测失败，如何继续整改：
  - 记录失败发生在 heartbeat 路径还是 same-turn-hold 路径。
  - 若失败属于当前轮被提前结束，则继续在当前 Bug 闭环内整改。
  - 若失败属于真实宿主无法保活当前轮，则记录为真实交付阻塞事实，不宣布完成。

## 10. 风险与回退

- 风险：
  1. 顶层主会话保活 loop 改动后，容易影响 implementation、remediation、默认继续等待三条链路的时序。
  2. 需要谨慎区分“ACP 会话不可恢复”与“当前轮被提前结束”，避免把两类故障混成一个状态。
  3. 真实 Codex CLI 环境如果没有办法稳定保活当前轮，交付测试可能继续暴露环境阻塞。
- 回退路径：
  1. 若顶层 loop 改动影响面过大，可先保留局部 `status` wait 作为辅助，但不能删除顶层保活职责。
  2. 若实现中途发现需要更多宿主信息，再补最小必要协议；禁止先改成业务阻断绕过同轮保活。

## 11. 上下文恢复说明

- 当前进度：
  - 已确认本次问题不是“整改阶段漏写 sleep 逻辑”，而是“fallback wait 的执行体只存在于单次 `status` 调用生命周期中”。
  - 已确认 implementation 与 remediation 在业务上必须共用同一套 1-2 分钟跟进机制，不能把 remediation 设计成新的业务分叉。
  - 已修正本 BUG 的修复设计，核心是把 same-turn-hold loop 上提到顶层主会话生命周期。
- 下一步：
  1. 基于本设计文档生成实施计划文档。
  2. 你确认计划后，在预计超过 3 个代码文件改动的前提下新建分支。
  3. 进入 TDD、编码实施、自动化验证与真实 Codex CLI 交付复测。
