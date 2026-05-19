# 实施阶段持续跟进交付失败整改计划

## 1. Bug 与设计来源

- Bug 名称：实施阶段未形成可观察运行态，导致持续跟进交付链路无法真实验收
- 设计文档：`docs/superpowers/specs/2026-05-19-impl-progress-followup-delivery-remediation-design.md`
- 设计日期：2026-05-19
- 当前失败链路：
  - 真实 Codex CLI 入口已确认插件可安装、可触发团队委派、可进入模型确认；
  - 但 implementation 模型确认后直接返回“等待交付测试”，没有形成可观察运行态；
  - 同时真实宿主缺少 `automation_update` 或等价 heartbeat 工具，无法为自动持续跟进建立真实通过证据。
- 本计划目标：
  - 修复仓库内“implementation/rework 首轮运行态不可见”的时序问题；
  - 建立自动化契约，避免后续再次吞掉运行态；
  - 同步文档与交付测试规则，明确 heartbeat 工具缺失时不能伪造交付通过。
- 本计划不处理：
  - 宿主 Codex 运行时本身提供哪些工具；
  - 通过轮询、阻塞等待或口头承诺替代真实 heartbeat。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| G1：实施或整改实施首轮必须先暴露运行态 | Task 01、Task 02 | UT-01、UT-02、UT-03 | DT-01、DT-02、DT-10 | 待实施 |
| G2：implementation/rework 快速完成时，后续才进入交付测试 | Task 01、Task 02 | UT-04、UT-05 | DT-08 | 待实施 |
| G3：文档与交付测试材料必须如实表达 heartbeat 前提 | Task 03 | UT-06 | DT-12、DT-13 | 待实施 |
| G4：宿主缺少 heartbeat 工具时不能误判交付通过 | Task 03、Task 04 | UT-07 | DT-01、DT-02、DT-05、DT-12、DT-13 | 待实施 |

## 3. 实施任务拆分

### Task 01: 修复 implementation 首轮返回时序

**业务目标：**  
让真实用户进入实施后，至少先观察到一次计划实施运行态，而不是被直接送到交付测试。

**对应设计目标：**  
G1、G2。

**设计来源：**  
整改设计文档第 5.1 节 G1/G2、第 6.1 节、第 6.2 节。

**文件范围：**  
`src/session/bridge-service.ts`

**实施步骤：**

1. 梳理 `start`、`model_confirm`、`planning_approve` 进入 implementation 的共有返回路径。
2. 识别 runner 在同步窗口内完成时，为什么首次响应被 `NEEDS_DELIVERY_TEST` 覆盖。
3. 调整首次响应策略，使 implementation 启动后至少返回一次 `RUNNING_IMPLEMENTATION`。
4. 保持 implementation 真正完成后，后续 `status` 或下一阶段仍可进入 `NEEDS_DELIVERY_TEST`。
5. 确认不破坏已有 model confirm、delivery test、remediation 闭环。

**伪代码：**

```text
输入：start/model_confirm/planning_approve 进入 implementation
launchWorkflowPhase(workflow, RUNNING_IMPLEMENTATION)
mark first running exposure as pending
wait short sync window
if implementation already completed and first running exposure not yet sent:
  return synthetic running snapshot for first response
else:
  return current workflow snapshot
后续 status:
  if implementation finished:
    return NEEDS_DELIVERY_TEST
  else:
    return RUNNING_IMPLEMENTATION
```

**验证命令：**  
`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "implementation"`
`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**自动化验证：**  
UT-01、UT-02、UT-04

**对应交付场景：**  
DT-01、DT-02、DT-08、DT-10

**完成标准：**  
implementation 即使很快完成，真实入口首次也先看到 `RUNNING_IMPLEMENTATION`。

### Task 02: 修复 remediation 首轮返回时序

**业务目标：**  
整改实施链路与普通实施链路保持同一业务体验，不再直接吞掉运行态。

**对应设计目标：**  
G1、G2。

**设计来源：**  
整改设计文档第 5.1 节 G1/G2、第 6.1 节、第 6.2 节。

**文件范围：**  
`src/session/bridge-service.ts`

**实施步骤：**

1. 梳理 `remediation_approve` 的启动路径与 implementation 的差异。
2. 让整改 runner 启动后也具备“首轮先返回 `RUNNING_REMEDIATION`”契约。
3. 验证整改很快结束时，后续才进入 `NEEDS_DELIVERY_TEST`。
4. 保持整改轮次计数与失败闭环不变。

**伪代码：**

```text
输入：delivery test failed + remediation_approve
launchWorkflowPhase(workflow, RUNNING_REMEDIATION)
if rework completed inside sync window and first remediation exposure not yet sent:
  return RUNNING_REMEDIATION snapshot once
else:
  return current workflow snapshot
后续 status:
  if rework finished:
    return NEEDS_DELIVERY_TEST
```

**验证命令：**  
`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "remediation"`
`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**自动化验证：**  
UT-03、UT-05

**对应交付场景：**  
DT-01、DT-02、DT-08、DT-10

**完成标准：**  
整改实施首轮可观察，且整改完成后仍正确回到交付测试。

### Task 03: 同步文档与测试规则口径

**业务目标：**  
让对外说明与真实交付门禁一致，避免把“没有真实 heartbeat 工具”的环境说成已满足自动跟进。

**对应设计目标：**  
G3、G4。

**设计来源：**  
整改设计文档第 5.1 节 G3/G4、第 6.2 节、第 6.4 节。

**文件范围：**  
`README.md`

**实施步骤：**

1. 更新实施阶段说明，加入“首轮运行态可见”要求。
2. 明确 heartbeat 工具是 DT-01/02/05/12/13 的真实前提。
3. 明确缺少 heartbeat 工具时不能口头承诺自动跟进，也不能宣称交付通过。

**伪代码：**

```text
输入：README 当前实施与交付测试说明
if 缺少首轮运行态规则:
  增量补充 implementation/remediation 首轮可见要求
if 缺少 heartbeat 前提说明:
  补充真实自动唤醒依赖说明
输出：用户可见规则与真实交付门禁一致
```

**验证命令：**  
`npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts`
`npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**自动化验证：**  
UT-06、UT-07

**对应交付场景：**  
DT-12、DT-13

**完成标准：**  
文档不再允许“嘴上说会继续跟进，线程其实不会自动回来”的误导表达。

### Task 04: 补齐真实失败链路的交付测试材料

**业务目标：**  
把“仓库内已修复”和“宿主能力仍阻塞”清晰分开，避免整改后再次误判完成。

**对应设计目标：**  
G4。

**设计来源：**  
整改设计文档第 5.1 节 G4、第 9 节。

**文件范围：**  
`docs/superpowers/specs/2026-05-19-impl-progress-followup-delivery-remediation-design.md`
`docs/superpowers/plans/2026-05-19-impl-progress-followup-delivery-remediation-plan.md`

**实施步骤：**

1. 在交付测试记录中补充唯一任务名复测要求。
2. 记录 heartbeat 工具可用性探测结果。
3. 明确当前若无 heartbeat 工具，本轮交付测试仍判阻塞失败。

**伪代码：**

```text
输入：真实 CLI 交付测试结果 + heartbeat 能力探测结果
if implementation 首轮问题已修复 and heartbeat tool exists:
  执行 DT-01 到 DT-13 全量复测
else if heartbeat tool missing:
  记录环境阻塞事实并停止宣布完成
输出：可追溯的交付测试结论
```

**验证命令：**  
`npm run plugin:install-local`
`codex plugin list`

**自动化验证：**  
无新增自动化；通过交付测试记录补足。

**对应交付场景：**  
DT-01 到 DT-13

**完成标准：**  
整改完成后，能明确区分“代码问题已修复”与“环境前提仍缺失”。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | implementation 很快完成时首轮被吞掉 | `model_confirm/start` 直接返回 `NEEDS_DELIVERY_TEST` | 首次返回 `RUNNING_IMPLEMENTATION` |
| UT-02 | implementation 运行态暴露后无法进入交付测试 | 后续 `status` 仍卡在 `RUNNING_IMPLEMENTATION` | 后续进入 `NEEDS_DELIVERY_TEST` |
| UT-03 | remediation 很快完成时首轮被吞掉 | `remediation_approve` 直接返回 `NEEDS_DELIVERY_TEST` | 首次返回 `RUNNING_REMEDIATION` |
| UT-04 | implementation 旧测试预期仍绑定直接交付测试 | 旧用例继续断言首轮是 `NEEDS_DELIVERY_TEST` | 用例改为首轮运行态、后续交付测试 |
| UT-05 | remediation 旧测试预期仍绑定直接交付测试 | 旧用例断言首轮是 `NEEDS_DELIVERY_TEST` | 用例改为首轮运行态、后续交付测试 |
| UT-06 | README 缺少首轮运行态要求 | 文档断言缺失 | 文档断言存在并匹配实现 |
| UT-07 | README 未说明 heartbeat 前提 | 文档仍可解读为可口头承诺自动跟进 | 文档明确缺工具时不能宣称自动持续跟进 |

## 5. 自动化验证计划

1. 精准回归测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "implementation"
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "remediation"
```

2. 相关模块测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

3. 全量测试

```bash
npm test
```

4. 编译或构建

```bash
npm run build
npm run prepare:plugin
```

5. 插件或安装检查

```bash
npm run plugin:install-local
codex plugin list
```

说明：
- 第 1 组先把“首轮运行态被吞掉”的根因打成红灯。
- 第 2 组确认状态机闭环没有被打断。
- 第 3、4、5 组确保交付物可安装、可加载、可进入真实入口。

## 6. 真实业务交付测试计划

**真实入口：**

- 在本机真实环境执行 `npm run plugin:install-local`。
- 刷新或重启 Codex 环境。
- 用 `codex plugin list` 确认插件已安装并启用。
- 直接打开真实 Codex CLI，不允许用内部 API、直接 MCP 调用或字段检查代替。

**操作步骤：**

1. 在真实 Codex CLI 中输入自然语言：
   - `请新建一个团队委派任务，任务名固定为 <唯一任务名>。帮我用团队委派流程完成这个插件里关于实施阶段持续跟进的修复。方案和计划都已经确认，直接进入实施；如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。过程中有进展就告诉我，没动静太久再问我是否接手。`
2. 确认模型后，观察首轮是否先进入计划实施运行态，而不是直接进入等待交付测试。
3. 若进入整改实施链路，按同一真实入口观察首轮是否先进入整改实施运行态，而不是直接进入等待交付测试。
4. 若真实宿主具备 heartbeat 或等价自动唤醒能力，继续按 `docs/团队委派交付测试必过表.md` 逐项复测 DT-01 到 DT-13。
5. 若真实宿主不具备 heartbeat 或等价自动唤醒能力，记录该环境阻塞事实，并停止宣布交付测试通过。

**通过标准：**

- implementation 首轮可观察到计划实施运行态。
- remediation 首轮可观察到整改实施运行态。
- implementation/rework 完成后，后续才允许进入等待交付测试。
- 若真实宿主具备 heartbeat 或等价自动唤醒能力，`docs/团队委派交付测试必过表.md` 中 DT-01 到 DT-13 必须全部通过。
- 若真实宿主不具备 heartbeat 或等价自动唤醒能力，本轮只能判定为环境阻塞，不能宣称交付测试通过。

**失败后整改与再测试：**

- 若仍是仓库逻辑导致 implementation/remediation 首轮运行态不可见，必须继续新增红灯测试并整改，再重走同一条真实 Codex CLI 链路。
- 若 implementation/remediation 首轮问题已修复，但 DT-01 到 DT-13 中仍有失败项，必须把失败项写回 `docs/团队委派交付测试必过表.md` 对应记录，补整改任务后再次执行同一条真实 Codex CLI 链路。
- 若仅剩 heartbeat 或等价自动唤醒能力缺失，则向用户报告环境阻塞，并在环境前提满足后再次重走同一条真实 Codex CLI 链路。

## 7. 交付测试失败整改记录

- **失败场景：**
  - 真实 Codex CLI 入口发起团队委派后，implementation 首轮没有形成可观察运行态，直接落到等待交付测试。
  - 同一次真实链路中，自动持续跟进还依赖真实宿主是否具备 heartbeat 或等价自动唤醒能力。
- **输入数据：**
  - `请新建一个团队委派任务，任务名固定为 <唯一任务名>。帮我用团队委派流程完成这个插件里关于实施阶段持续跟进的修复。方案和计划都已经确认，直接进入实施；如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。过程中有进展就告诉我，没动静太久再问我是否接手。`
- **期望结果：**
  - implementation 首轮先进入计划实施运行态，remediation 首轮先进入整改实施运行态；
  - 只有运行态之后，后续才允许进入等待交付测试；
  - 若真实宿主具备 heartbeat 或等价自动唤醒能力，再继续复测 DT-01 到 DT-13。
- **实际结果：**
  - 真实 CLI 中 implementation 首轮直接跳到等待交付测试；
  - 无法在同一失败链路中先观察到 implementation 运行态；
  - 自动持续跟进是否能形成真实证据，还受宿主 heartbeat 或等价自动唤醒能力影响。
- **根因分析：**
  - 仓库内 implementation/remediation 在首轮同步窗口中可能已经完成，首次响应被等待交付测试覆盖，吞掉了用户应先看到的运行态；
  - 真实宿主若缺少 heartbeat 或等价自动唤醒能力，即使仓库内首轮运行态问题修复，也不能伪造自动持续跟进已通过。
- **修复方案：**
  - 先修复仓库内 implementation/remediation 首轮返回时序，让真实用户先看到运行态；
  - 再重走同一条真实 Codex CLI 链路，区分“仓库问题已修复”与“环境前提仍阻塞”。
- **复测命令：**
  - `npm run plugin:install-local`
  - `codex plugin list`
  - `codex`
- **复测结果：**
  - 当前待实施；实施完成后必须按第 6 节同一条真实 Codex CLI 链路补齐结果。

## 8. 设计完成核对清单

- [x] 已把真实失败事实写入整改设计。
- [x] 已把根因拆分为仓库内时序问题与宿主环境前提问题。
- [x] 已把 implementation 与 remediation 两条链路分别落成任务。
- [x] 已写明自动化验证、构建、安装与真实交付测试计划。
- [x] 已写明若宿主缺少 heartbeat 工具则不能宣布完成。

## 9. 上下文恢复说明

- 当前进度：
  - 整改设计与整改计划文档已落盘，等待用户确认。
- 下一步：
  1. 你确认后，我再新建分支进入编码实施。
  2. 实施完成后先跑自动化验证，再用真实 Codex CLI 重走同链路交付测试。
- 恢复入口：
  - 先打开 `docs/superpowers/specs/2026-05-19-impl-progress-followup-delivery-remediation-design.md` 与本计划；
  - 再从真实 Codex CLI 链路复现“implementation 首轮直接跳等待交付测试”的失败事实；
  - 进入实施后，必须先修复首轮运行态暴露，再继续验证自动持续跟进是否满足真实宿主前提。
