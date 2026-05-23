# 无 Heartbeat 场景整改持续跟进提前停步 BUG 修改计划

## 1. Bug 与设计来源

- Bug 名称：无 heartbeat 场景下整改持续跟进在主会话回复后提前停步
- 设计文档：`docs/superpowers/specs/2026-05-20-remediation-followup-runtime-gate-design.md`
- 设计日期：2026-05-20
- 当前失败链路：
  - 用户在整改阶段看到主会话已承诺“会继续跟进”；
  - 当前轮回复结束后，宿主没有 heartbeat；
  - fallback wait 又只存在于单次 `status` 调用内部；
  - 于是线程没有再次自动回来，真实持续跟进链路中断。
- 本计划目标：
  - 把 same-turn-hold loop 上提到顶层主会话生命周期；
  - 让 implementation / remediation / default-continue 三条链路共用同一套 follow-up loop；
  - 建立覆盖“主会话承诺后当前轮仍活着”的自动化测试与真实交付测试。
- 本计划不处理：
  - 真实 Codex 宿主如何内部实现 heartbeat；
  - 超出本 Bug 范围的模型选择、整改轮次和文档门禁问题；
  - 通过人工补触发来伪造自动继续；
  - 把无 heartbeat 设计成主会话接手/取消的业务分支。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| G1：implementation 与 remediation 必须共用同一套 follow-up loop | Task 01、Task 02 | UT-01、UT-02 | DT-01、DT-02 | 待实施 |
| G2：无 heartbeat 时必须由 same-turn-hold 保活当前轮 | Task 02、Task 04 | UT-03、UT-04 | DT-01、DT-02、DT-05、DT-12、DT-13 | 待实施 |
| G3：60 秒默认继续等待也必须复用同一套 same-turn-hold 机制 | Task 02、Task 04 | UT-05、UT-06 | DT-05、DT-12 | 待实施 |
| G4：文档、工具描述、技能规则与真实交付测试口径一致 | Task 03、Task 05 | UT-07、UT-08 | DT-01 到 DT-13 | 待实施 |

## 3. 实施任务拆分

### Task 00: 实施前分支与上下文准备

**业务目标：**

按仓库约定，为预计超过 3 个代码文件的实现改动准备独立分支，避免在主线直接编码。

**对应设计目标：**

G1、G4。

**设计来源：**

- 仓库 AGENTS 约束。
- 设计文档第 11 节下一步说明。

**修改范围：**

- Git 分支环境。

**对应交付场景：**

- DT-01、DT-02、DT-04（保证实施改动在隔离分支内完成，便于同一链路复测与回退）。

**实施步骤：**

1. 基于当前 `main` 创建新分支，分支名前缀使用 `codex/`。
2. 确认工作区无与本次任务冲突的未提交改动。
3. 在分支上进入后续 TDD 与编码任务。

**伪代码：**

```text
输入：当前 main 分支 + 已确认的设计/计划文档
if 预计代码改动文件数 > 3:
  create branch "codex/remediation-followup-runtime-gate"
  switch to new branch
check git status
if 存在冲突性未提交改动:
  停止并先与用户确认
输出：隔离的实施分支 + 可继续执行的工作区
```

**验证方式：**

- `git branch --show-current`
- `git status --short`

**完成标准：**

- 后续代码改动全部发生在新分支上。

### Task 01: 梳理顶层 follow-up loop 与局部 status wait 的职责边界

**业务目标：**

明确当前缺陷究竟应该落在顶层主会话 loop，还是局部 `status` wait，避免 implementation 和 remediation 继续共享同一条错误路径。

**对应设计目标：**

G1。

**设计来源：**

- 设计文档第 4.2 节、第 6.1 节。

**文件范围：**

- `src/session/bridge-service.ts`
- 相关高层入口调用链

**对应交付场景：**

- DT-01、DT-02（implementation 与 remediation 的同规则跟进）。
- DT-03（默认继续等待与运行态共用同一职责边界）。

**实施步骤：**

1. 梳理 implementation、remediation、`NEEDS_USER_DECISION` 三条链路拿到 `next_follow_up_at` 后的执行路径。
2. 标出哪些逻辑仍停留在局部 `status` 调用里。
3. 标出哪些逻辑必须上提到顶层主会话生命周期。
4. 明确保留局部 wait 的辅助职责，避免与顶层 loop 重复。

**伪代码：**

```text
输入：running workflow + next follow-up time
if current loop lives only inside status():
  mark as local wait only
if user-facing response already returned:
  local wait can no longer keep thread alive
move keep-alive responsibility to top-level orchestration
keep status wait only as helper inside an active loop
输出：清晰的顶层 loop / 局部 wait 职责边界
```

**验证方式：**

- workflow 单测覆盖 implementation / remediation 共享 loop。

**完成标准：**

- 能明确指出顶层 loop 必须接管的代码位置与行为边界。

### Task 02: 把 same-turn-hold 上提到顶层主会话生命周期

**业务目标：**

让无 heartbeat 场景下的自动继续真正发生在当前轮里，而不是只发生在单次 `status` 调用内部。

**对应设计目标：**

G1、G2、G3。

**设计来源：**

- 设计文档第 4.1 节、第 6.1 节、第 6.4 节。

**文件范围：**

- `src/session/bridge-service.ts`
- 高层 follow-up orchestration 入口

**对应交付场景：**

- DT-01（implementation 无 heartbeat 同轮保活）。
- DT-02（remediation 无 heartbeat 同轮保活）。
- DT-03（NEEDS_USER_DECISION 默认继续同轮保活）。
- DT-04（全表复测一致性）。

**实施步骤：**

1. 在运行态或允许默认继续的等待决策态拿到下一次 follow-up 时间后，判断是否已有 heartbeat。
2. 有 heartbeat 时维持当前行为。
3. 无 heartbeat 时，不结束当前轮；在顶层 loop 中等待到时间点后再次查询同一任务状态。
4. implementation、remediation、`NEEDS_USER_DECISION` 三条链路复用同一套顶层 loop。
5. 只有离开运行态或进入真正不可继续等待的决策态，当前轮才允许结束。

**伪代码：**

```text
输入：running or wait-decision workflow
if heartbeat available:
  schedule heartbeat and allow current round to end
else:
  keep current round alive
  sleep until next_follow_up_at or timeout_default_deadline_at
  re-enter same task loop
  query status again
repeat until workflow leaves running family
```

**验证方式：**

- workflow 单测覆盖 implementation / remediation / default-continue 三条路径。

**完成标准：**

- 无 heartbeat 场景下，implementation / remediation / default-continue 都能在当前轮里真实继续。

### Task 03: 同步工具描述、README 与 team-delegate 技能规则

**业务目标：**

让调用方、技能规则和用户可见文档都使用同一套“无 heartbeat 时必须 same-turn-hold”的语义。

**对应设计目标：**

G4。

**设计来源：**

- 设计文档第 6.2 节、第 6.3 节。

**文件范围：**

- `src/plugin/mcp-server.ts`
- `skills/team-delegate/SKILL.md`
- `README.md`
- `docs/团队委派交付测试必过表.md`

**对应交付场景：**

- DT-01、DT-02、DT-03（用户可见规则与真实行为一致）。
- DT-04（必过表与技能规则一致）。

**实施步骤：**

1. 更新工具描述，明确 heartbeat 缺失时不得结束当前轮。
2. 更新 team-delegate 技能，明确 same-turn-hold 是 heartbeat 缺失时的正常 fallback。
3. 更新 README 和交付测试必过表，补充“当前轮未结束”的验证规则。

**伪代码：**

```text
输入：现有工具描述 + README + skill + 交付测试表
for each doc in [tool description, README, skill, 交付测试表]:
  if doc contains "没有 heartbeat 就可能无法继续":
    replace with "没有 heartbeat 就必须保持当前轮活着"
  ensure doc contains:
    - current_turn_must_stay_open_without_heartbeat
    - hold_until + recheck_action 的同轮复查语义
if any doc misses required rule:
  fail delivery contract test and continue remediation
输出：统一的产品规则与测试口径
```

**验证方式：**

- `tests/delivery/team-delegate-skill.delivery.test.ts`
- 如有 README / plugin install 相关断言，一并更新并跑通。

**完成标准：**

- 文档、skill、工具描述都明确 same-turn-hold 是 heartbeat 缺失时的正常路径。

### Task 04: 补齐覆盖根因的单元与交付契约测试

**业务目标：**

让测试不再只验证“下次 `status` 调用是否继续”，而是直接卡住“主会话承诺后当前轮是否仍然活着”。

**对应设计目标：**

G1、G2、G3、G4。

**设计来源：**

- 设计文档第 4.3 节、第 8 节。

**文件范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- 必要时 `tests/plugin/install.plugin.test.ts` / `tests/plugin/install-runbook.plugin.test.ts`

**对应交付场景：**

- DT-01、DT-02、DT-03（根因路径直接回归）。
- DT-04（交付契约与必过表一致）。

**实施步骤：**

1. 先写 implementation 红灯测试：无 heartbeat 场景下，主会话承诺后当前轮仍必须存活。
2. 再写 remediation 红灯测试：同样的顶层 loop 必须覆盖整改链路。
3. 再写 `NEEDS_USER_DECISION` 红灯测试：60 秒默认继续时，无 heartbeat 场景必须在当前轮保活到再次查询状态。
4. 写绿灯测试：heartbeat 场景与 same-turn-hold 场景都满足现有业务语义。
5. 补文案契约测试，要求 team-delegate skill 与 README 含有“无 heartbeat 时必须保活当前轮”规则。

**伪代码：**

```text
输入：mock BridgeService + running workflow
case 1: implementation without heartbeat
  expect current round to remain alive until next follow-up
case 2: remediation without heartbeat
  expect same keep-alive behavior
case 3: user-decision default continue without heartbeat
  expect same-turn hold until timeout check
case 4: heartbeat path
  expect existing behavior preserved
输出：覆盖根因的新测试矩阵
```

**验证方式：**

- 精准运行新增测试用例。
- 运行全量 workflow 单测与 delivery skill 单测。

**完成标准：**

- 新增测试在修复前失败、修复后通过，并能阻止未来回归。

### Task 05: 真实业务交付测试与失败整改记录

**业务目标：**

把“代码契约已修复”和“真实宿主是否能履约”在交付测试中分开记录，避免再次出现业务承诺失真。

**对应设计目标：**

G4。

**设计来源：**

- 设计文档第 9 节。

**修改范围：**

- `runtime/...` 交付记录文件
- 必要时补充 `docs/superpowers/...` 中的复测结论

**对应交付场景：**

- DT-01 到 DT-13（完整交付闭环必过项）。

**实施步骤：**

1. 在真实 Codex CLI 中分别准备 heartbeat 场景和无 heartbeat 场景。
2. 用自然语言重走 implementation 与 remediation 链路。
3. 在无 heartbeat 场景中，重点验证当前轮是否真的未结束并自动回来。
4. 逐项记录 DT-01 到 DT-13 结果。
5. 若宿主无法真实保活当前轮，则记录为真实交付阻塞，不宣布完成。

**伪代码：**

```text
输入：真实 Codex CLI + 插件已安装 + 唯一任务名
for mode in [heartbeat, no-heartbeat]:
  start delegated task with mode
  observe running/remediation/user-decision chain
  record DT-01..DT-13 result
if any required DT fails:
  write failure evidence and keep task open
输出：可追溯的真实交付测试结论
```

**验证方式：**

- 真实 Codex CLI 自然语言入口复测。

**完成标准：**

- 交付测试记录能清楚区分：
  - 仓库契约是否正确；
  - 宿主能力是否真的履约。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | implementation 无 heartbeat 时当前轮提前结束 | 发出承诺后 loop 退出 | 当前轮保持存活直到下一次跟进 |
| UT-02 | remediation 无 heartbeat 时当前轮提前结束 | 发出整改进展后 loop 退出 | remediation 与 implementation 共用同一保活逻辑 |
| UT-03 | `NEEDS_USER_DECISION` 60 秒默认继续时当前轮提前结束 | 默认继续前线程已结束 | 当前轮保活到超时并再次查状态 |
| UT-04 | implementation / remediation 只修一条链路 | 其中一条链路仍提前结束 | 两条链路都统一 loop |
| UT-05 | heartbeat 场景被破坏 | heartbeat 路径不再自动回来 | heartbeat 行为保持成立 |
| UT-06 | 默认继续等待没有复用同一套 same-turn-hold | 运行态和等待决策态逻辑分叉 | 两者都复用顶层 loop |
| UT-07 | team-delegate skill 未要求无 heartbeat 时保活当前轮 | skill 文案缺失同轮保活要求 | skill 文案与实现一致 |
| UT-08 | README / tool description 未同步 | README 或工具描述未明确 same-turn-hold | README / tool description 与 skill 口径一致 |

## 5. 自动化验证计划

1. 精准回归测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "keep current round alive"
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "remediation"
```

证明：
- 新增门禁测试能先失败后变绿；
- remediation 链路没有漏掉新门禁。

2. 相关模块测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts
```

证明：
- workflow 主状态机未被破坏；
- team-delegate 技能契约与实现保持一致。

3. 全量测试

```bash
npm test
npm run build
npm run prepare:plugin
```

证明：
- 仓库整体测试、构建、插件打包仍可通过。

4. 编译或构建

```bash
npm run build
npm run prepare:plugin
```

证明：
- TypeScript 编译与插件构建链路可通过。

5. 插件或安装检查

```bash
npm run plugin:install-local
codex plugin list
```

证明：
- 本地插件安装链路可继续用于真实交付测试。

## 6. 真实业务交付测试计划

### DT-01 implementation 运行态承诺门禁

**业务目标：**

验证 implementation 链路在无 heartbeat 场景下，会由当前轮继续保活并自动回来。

**真实环境：**

- 本机真实 Codex CLI
- 当前插件已本地安装并启用

**真实入口：**

- `codex exec -m gpt-5.3-codex`

**用户语言：**

```text
帮我用团队委派流程完成这个修复。设计和计划已经确认，直接进入实施。过程中有进展就告诉我；如果当前环境不能自动继续跟进，就直接告诉我不要假装继续跟。
```

**前置准备：**

1. 准备唯一任务名。
2. 明确当前运行场景是 heartbeat 还是无 heartbeat。

**操作步骤：**

1. 从真实入口触发 implementation。
2. 在 heartbeat 场景和无 heartbeat 场景分别观察 implementation 首轮与后续自动跟进行为。
3. 记录当前轮是否在首轮业务回复后仍保持存活。

**期望用户可见结果：**

- heartbeat：后续由 heartbeat 自动回来。
- 无 heartbeat：后续由当前轮保活自动回来。

**辅助证据：**

- `codex-exec.jsonl`
- 线程是否自动回来的实际时间点记录

**失败判定：**

- 无 heartbeat 场景下，主会话在首轮业务回复后直接结束当前轮。
- 任一场景承诺后却没有真实自动回来。

**失败后整改动作：**

- 记录能力模式、实际文案、线程行为，回填当前 BUG 闭环。

### DT-02 remediation 运行态承诺门禁

**业务目标：**

验证整改阶段与 implementation 使用同一套门禁，不再出现“整改里又承诺了，但线程停了”。

**真实环境：**

- 本机真实 Codex CLI

**真实入口：**

- 自然语言继续已有整改任务

**用户语言：**

```text
继续这次整改。过程中有进展就告诉我；如果当前环境不能自动继续跟进，就不要继续承诺自动跟进。
```

**操作步骤：**

1. 让任务进入 `DELIVERY_TEST_FAILED -> remediation_approve -> RUNNING_REMEDIATION`。
2. 在三种能力模式下分别观察。

**期望用户可见结果：**

- 与 implementation 同规则。
- 不再出现“整改继续在推进，我继续跟进”后线程直接停止的情况。

**失败判定：**

- remediation 仍保留错误承诺；
- remediation 与 implementation 规则不一致。

### DT-03 NEEDS_USER_DECISION 默认继续门禁

**业务目标：**

验证 60 秒默认继续在无 heartbeat 场景下同样依赖当前轮保活，而不是依赖新的外部触发。

**用户语言：**

```text
如果没动静太久再问我；如果我不回复，只有当前环境真能自动继续时才默认继续。
```

**操作步骤：**

1. 让任务进入 `NEEDS_USER_DECISION`。
2. 分别验证 heartbeat 和无 heartbeat 两种场景。
3. 观察是否出现 60 秒后的真实自动继续。

**期望用户可见结果：**

- heartbeat：60 秒后由 heartbeat 触发真实自动继续。
- 无 heartbeat：60 秒后由当前轮保活触发真实自动继续。

**失败判定：**

- 无 heartbeat 场景下，60 秒默认继续前当前轮已经结束。
- 任一场景 60 秒后未真实自动继续。

### DT-04 全表复测

**业务目标：**

确保 `docs/团队委派交付测试必过表.md` 全部通过，而不是只修单个用户截图场景。

**操作步骤：**

1. 安装插件。
2. 从真实 CLI 入口覆盖 implementation、remediation、默认继续等待三类场景。
3. 按 DT-01 到 DT-13 逐项记录。

**期望用户可见结果：**

- 所有“会继续跟进”的场景都真实自动回来；
- 所有无 heartbeat 的场景都会通过当前轮保活真实自动回来，而不是在回复后静默结束。

**失败后整改动作：**

- 任一项失败即整体失败，补失败记录、补测试、补整改任务后重跑同链路。

### 通过标准

- DT-01 到 DT-13 全部通过，且不存在“主会话承诺自动跟进但当前轮已结束”的矛盾现象。
- implementation、remediation、NEEDS_USER_DECISION 三条链路在 heartbeat 与无 heartbeat 模式下都满足既定规则。
- 用户可见提示与实际行为一致，不依赖人工补触发。

### 失败后整改与再测试

- 任一 DT 项失败即判定本次交付测试失败，不得声明完成。
- 先回填第 7 节失败记录字段，再补充修复任务与自动化回归。
- 修复后必须从真实入口重跑同一业务链路，直到失败项全部转绿并更新复测结果。

## 7. 交付测试失败整改记录

- 当前状态：待实施。
- 规则：
  1. 若自动化测试失败，先修复自动化红灯，再继续后续验证。
  2. 若真实交付测试失败，必须记录失败发生在 heartbeat 路径还是无 heartbeat 的 same-turn-hold 路径、哪个业务阶段、哪条 DT 项。
  3. 若失败属于当前设计未覆盖的新现象，先补设计或登记新问题，再继续整改。
  4. 每次整改后重新执行自动化验证，再重新执行真实 Codex CLI 交付测试。

- 失败记录模板（每次失败新增一条）：
  - 失败场景：
  - 输入数据（用户原话/触发语句）：
  - 期望结果：
  - 实际结果：
  - 根因分析：
  - 修复方案：
  - 复测命令：
  - 复测结果：

## 8. 设计完成核对清单

- [ ] implementation / remediation / NEEDS_USER_DECISION 已统一 follow-up loop。
- [ ] 无 heartbeat 场景会在当前轮里继续保活。
- [ ] heartbeat / same-turn-hold 路径继续可用。
- [ ] workflow 单测已覆盖根因。
- [ ] skill / README / tool description / 必过表口径一致。
- [ ] 新分支上完成编码实施。
- [ ] 自动化验证全部通过。
- [ ] 真实 Codex CLI 交付测试完成并逐项记录 DT-01 到 DT-13。

## 9. 上下文恢复说明

- 当前进度：
  - 方案与计划已落盘；
  - 计划文档已补齐实施门禁缺项，等待重新进入 implementation start；
  - 代码实施与交付测试尚未开始。

- 恢复入口：
  - 会话别名（任务名）：`remediation-followup-runtime-gate-live-20260520-161547`
  - 重新发起命令语义：按同一任务名执行 `implementation start`，复用现有方案/计划文档。

- 当前已经完成：
  - BUG 根因定位；
  - 设计文档落盘；
  - 本计划文档落盘。
- 下一步应做什么：
  1. 你确认计划后，我先新建分支。
  2. 进入 TDD 和编码实施。
  3. 完成自动化验证后，再做真实 Codex CLI 交付测试。
