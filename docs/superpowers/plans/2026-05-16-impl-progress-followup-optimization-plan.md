# 实施阶段进展汇报优化 BUG 修改计划

## 1. Bug 与设计来源

- Bug 名称：实施阶段进展汇报过长且“接手询问”约束不够显式
- 设计文档：`docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md`
- 设计日期：2026-05-16
- 当前失败链路：
  - 用户通过 Codex CLI 触发团队委派后，实施阶段 `status` 的进展文本可能过长；
  - 用户期望“有进展就简短汇报、长时间无进展再询问接手”，需在载荷与测试层做更强约束。
- 本计划目标：
  - 把设计中 4 个修复目标落成可执行任务、自动化验证和真实交付测试闭环。
- 本计划不处理：
  - 模型选择闸门策略变更；
  - 整改轮次规则变更；
  - `continue_wait` / `handoff_to_main` 动作语义改造。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| G1：有进展时提供稳定短摘要用于简短汇报 | Task 01、Task 02 | UT-01、UT-02 | DT-01 | 待实施 |
| G2：仅在沉默超阈值后才询问是否接手 | Task 02、Task 03 | UT-03、UT-04 | DT-02 | 待实施 |
| G3：恢复进展后清空旧沉默决策窗口 | Task 03 | UT-05 | DT-03 | 待实施 |
| G4：实现与 skill/README 用户体验口径一致 | Task 04 | UT-06 | DT-01、DT-02、DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01: 增加进展短摘要字段并保持兼容

**业务目标：**  
让主会话在实施阶段有新进展时可以直接使用简短摘要向用户汇报。

**对应设计目标：**  
G1。

**设计来源：**  
`docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md` 第 5.1 节 G1、第 6.2 节第 1 条、第 6.3 节。

**文件范围：**  
`src/session/bridge-service.ts`

**对应交付场景：**  
DT-01（有进展时简短汇报）。

**实施步骤：**

1. 在进展增量结构中增加摘要字段（`summary`、`summaryTruncated`）。
2. 在进展文本压缩逻辑旁新增“短摘要提取/截断”逻辑。
3. 在 `toProgressUpdatePayload` 中输出摘要字段并保留旧字段 `text`。
4. 为摘要不可用场景提供兜底摘要（首行压缩文本或安全短句）。

**伪代码：**

```text
输入：progressDelta.text + event metadata
if hasNewOutput is false:
  输出 summary="" 并保持现有字段兼容
处理 text -> normalize -> extract concise summary
if summary length > limit:
  截断并标记 summary_truncated=true
输出：progress_update.summary + progress_update.summary_truncated + legacy text
```

**自动化验证：**  
UT-01、UT-02

**交付测试影响：**  
DT-01 有进展播报可读性验证。

**完成标准：**  
`status` 在 `has_new_output=true` 时稳定返回简短摘要，且旧调用方读取 `text` 不受影响。

### Task 02: 强化“未超沉默阈值不询问接手”的行为断言

**业务目标：**  
避免用户在实施有节奏跟进中被过早打断。

**对应设计目标：**  
G2。

**设计来源：**  
`docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md` 第 5.1 节 G2、第 6.2 节第 2/3 条。

**文件范围：**  
`tests/unit/bridge-service-workflow.test.ts`（必要时微调 `src/session/bridge-service.ts` 文案或条件分支）

**对应交付场景：**  
DT-02（沉默超阈值后才询问接手）。

**实施步骤：**

1. 补充/调整单测，覆盖“无新输出但未超阈值”时仍是 `RUNNING_*`。
2. 补充/调整单测，覆盖“超阈值后才进入 `NEEDS_USER_DECISION`”。
3. 校验 `next_action_required` 在 `RUNNING_*` 不应包含接手决策动作。
4. 若断言暴露实现偏差，再做最小修复并回归。

**伪代码：**

```text
输入：workflow(lastProgressAtMs, silenceDecisionMs, hasNewOutput=false)
执行 status poll
if silenceMs < silenceDecisionMs:
  期望 stage 保持 RUNNING_*
else:
  期望 stage 切换 NEEDS_USER_DECISION
输出：状态与动作集合满足“仅超阈值才询问”
```

**自动化验证：**  
UT-03、UT-04

**交付测试影响：**  
DT-02 “久无进展再询问接手”验证。

**完成标准：**  
测试可稳定区分“未超阈值”与“超阈值”的询问边界，行为符合设计。

### Task 03: 验证“恢复进展后清空旧决策窗口”

**业务目标：**  
保证用户选择继续等待后，只要 ACP 重新输出进展，就恢复正常跟进，不沿用旧沉默询问。

**对应设计目标：**  
G3。

**设计来源：**  
`docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md` 第 5.1 节 G3、第 6.2 节第 4 条。

**文件范围：**  
`tests/unit/bridge-service-workflow.test.ts`（必要时微调 `src/session/bridge-service.ts`）

**对应交付场景：**  
DT-03（继续等待后恢复进展清空旧询问语义）。

**实施步骤：**

1. 构造先进入 `NEEDS_USER_DECISION` 的场景。
2. 注入下一次轮询有新进展的场景。
3. 断言状态回到 `RUNNING_*` 且决策窗口/默认继续计数被清空或重置。
4. 验证后续轮询不会立即复用旧询问。

**伪代码：**

```text
输入：workflow.stage=NEEDS_USER_DECISION + next poll hasNewOutput=true
执行 status poll
if hasNewOutput:
  clearUserDecisionWindow()
  reset consecutive timeout default count
  stage -> RUNNING_*
输出：恢复简短进展汇报语义，不触发旧决策延续
```

**自动化验证：**  
UT-05

**交付测试影响：**  
DT-03 “继续等待后恢复进展”验证。

**完成标准：**  
恢复进展后行为稳定回到运行跟进，旧沉默决策语义不残留。

### Task 04: 同步 skill/README 对外口径（如需）

**业务目标：**  
确保用户面对的规则说明与实现载荷一致，减少误用。

**对应设计目标：**  
G4。

**设计来源：**  
`docs/superpowers/specs/2026-05-16-impl-progress-followup-optimization-design.md` 第 5.1 节 G4、第 7 节修改范围。

**文件范围：**  
`README.md`、`skills/team-delegate/SKILL.md`（仅在现有描述不完整时最小修改）

**对应交付场景：**  
DT-01/DT-02/DT-03（用户可见口径一致性）。

**实施步骤：**

1. 检查当前文档是否已明确“优先使用短摘要进行简短汇报”。
2. 若缺失，则补充 `progress_update.summary` 的使用建议。
3. 保持业务导向表达，不暴露内部实现细节为主提示。
4. 更新后补一条文档断言测试（若现有测试框架已覆盖此类约束）。

**伪代码：**

```text
输入：当前 README + SKILL 文本
if 缺少 summary 使用指引:
  增量补充简短汇报规则
else:
  保持不改，避免无效噪音改动
输出：文档与实现一致的用户可见规则
```

**自动化验证：**  
UT-06（文档关键句断言，按现有 delivery/skill 测试风格）

**交付测试影响：**  
DT-01/02/03 用户可见提示口径一致性验证。

**完成标准：**  
用户可见规则与实现一致，无冲突描述。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 有进展时缺少短摘要 | `progress_update.summary` 为空或不存在 | `has_new_output=true` 时返回短摘要 |
| UT-02 | 摘要过长或不可读 | 摘要长度超约束或为空回退不合理 | 摘要在限制内，必要时有 `summary_truncated` |
| UT-03 | 未超阈值提前询问接手 | `silenceMs < threshold` 却进入 `NEEDS_USER_DECISION` | 保持 `RUNNING_*` 且仅 `status` 动作 |
| UT-04 | 超阈值未触发决策 | `silenceMs >= threshold` 仍停留运行态 | 切换到 `NEEDS_USER_DECISION` |
| UT-05 | 恢复进展后旧沉默窗口残留 | 下一轮仍沿用旧决策询问 | 恢复 `RUNNING_*` 且旧窗口清空 |
| UT-06 | 文档口径与实现不一致 | README/skill 缺少摘要优先规则 | 文档断言通过且与实现一致 |

## 5. 自动化验证计划

1. 精准回归测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "summary"
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "silence timeout"
```

2. 相关模块测试

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts
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
```

说明：
- 第 1 组证明本次 Bug 根因可被测试捕获。
- 第 2 组证明状态机和技能约束未被破坏。
- 第 3 组证明项目级回归与可构建性。
- 第 4 组证明真实入口可用，满足交付测试前置门禁。

## 6. 真实业务交付测试计划

### DT-01 有进展时简短汇报

**业务目标：**  
实施阶段一旦有进展，用户能立即看到简短、可理解的进展总结。

**真实环境：**  
本机真实 Codex CLI 环境（非受限容器）。

**真实入口：**
1. 安装插件并刷新 Codex 环境。
2. 启动 Codex CLI。
3. 输入自然语言触发委派流程并进入实施阶段。

**用户语言：**

```text
帮我用团队委派流程完成这个开发任务。过程中有进展就简短告诉我。
```

**操作步骤：**
1. 进入实施阶段后执行持续跟进。
2. 观察 ACP 首次产生新输出后的主会话播报。
3. 确认播报为简短摘要，不是大段原文堆叠。

**通过标准：**
1. 用户能理解当前实施进展。
2. 无需阅读长原文也能继续等待。

**辅助证据：**
- CLI 对话截图/日志；
- `status` 返回中 `progress_update.summary`（辅助，不作为主提示）。

### DT-02 沉默超阈值后才询问接手

**业务目标：**  
避免未到阈值的无效打断，仅在长时间无进展后请用户决策。

**用户语言：**

```text
有进展就告诉我，没动静太久再问我是否接手。
```

**操作步骤：**
1. 在无新进展阶段观察多个跟进周期（1-2 分钟节奏）。
2. 阈值内确认无接手询问。
3. 超过沉默阈值后确认出现“继续等待/主会话接手”二选一。

**通过标准：**
1. 阈值内不打断。
2. 超阈值后才询问。

**失败判定：**
- 阈值内出现接手询问；
- 超阈值后仍不询问且无替代可继续路径。

### DT-03 继续等待后恢复进展清空旧询问语义

**业务目标：**  
用户选择继续等待后，若 ACP 恢复输出，系统应回到正常进展汇报，不延续旧沉默询问。

**用户语言：**

```text
我选择继续等待。
```

**操作步骤：**
1. 触发一次 `NEEDS_USER_DECISION`。
2. 用户选择继续等待。
3. 等待 ACP 新输出出现。
4. 验证主会话恢复简短进展播报，且不复用上一轮旧沉默询问。

**通过标准：**
1. 新进展出现后恢复正常跟进节奏。
2. 用户不会被历史旧询问反复打断。

**失败后整改与再测试：**
1. 记录失败场景、输入数据、期望结果、实际结果、初步根因。
2. 补充或修订对应 UT（UT-01~UT-06）后重新跑自动化验证计划 1-5。
3. 重新执行 DT-01/DT-02/DT-03 同链路复测，直到全部通过。

## 7. 交付测试失败整改记录

> 本节用于执行时持续增量记录，首次实施前先建立模板。

| 轮次 | 失败场景 | 输入数据 | 期望结果 | 实际结果 | 根因分析 | 修复方案 | 复测命令 | 复测结果 |
|---|---|---|---|---|---|---|---|---|
| 1 | 待执行 | 待记录 | 待记录 | 待记录 | 待记录 | 待记录 | 待记录 | 待记录 |

整改规则：
1. 交付测试失败后必须先记录事实，再补充整改任务。
2. 整改完成后先跑自动化验证，再重走同一真实业务链路。
3. 未完成“记录 -> 修复 -> 自动化 -> 复测”闭环，不得声明完成。

## 8. 设计完成核对清单

- [ ] 已落实 G1：有进展短摘要字段可用且兼容旧字段。
- [ ] 已落实 G2：仅沉默超阈值才询问接手。
- [ ] 已落实 G3：恢复进展后清空旧决策窗口语义。
- [ ] 已落实 G4：README/skill 与实现口径一致（如需改动）。
- [ ] 红灯测试已先失败后转绿。
- [ ] 相关模块与全量测试通过。
- [ ] 构建与安装链路验证通过。
- [ ] 真实业务交付测试 DT-01/02/03 全部通过。
- [ ] 若有失败，整改记录已完整填写并复测通过。

## 9. 上下文恢复说明

- 当前进度：
  - 设计文档已确认；
  - 本计划文档已落盘，待用户确认。
- 下一步：
  1. 用户确认本计划文档。
  2. 进入实施阶段（implementation）并选择 ACP 执行模型。
  3. 实施完成后执行自动化验证与真实业务交付测试，不通过则进入整改闭环。

- 恢复入口：
  - 若会话中断，重新在 Codex CLI 中基于同一任务名 `impl-progress-followup-optimization` 继续，并优先执行 `action=status` 恢复当前阶段；若返回需用户决策，则按返回的业务动作继续，不新建任务别名。
