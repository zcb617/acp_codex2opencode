# 主会话越权替用户选择 ACP 的实施入口硬闸门 BUG 修复计划

## 1. Bug 与设计来源

- Bug 名称：主会话越权替用户选择 ACP 的实施入口硬闸门缺失
- 设计文档：`docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md`
- 当前失败链路：
  1. 用户从真实入口进入团队委派流程
  2. 方案和计划已确认，进入实施执行方选择
  3. 插件已要求用户回复 `1` 或 `2`
  4. 用户未回复
  5. 主会话却直接提交 `implementation_executor_select(acp)`，并把流程推进到模型确认
- 本计划目标：
  1. 把 `NEEDS_IMPLEMENTATION_EXECUTOR` 补成对主会话也生效的硬闸门
  2. 切断 `start` 阶段提前注入 `implementation_executor=acp` 的旁路
  3. 让 `implementation_executor_select` 只能发生在插件已发出的实施执行方选择节点上
  4. 清掉测试里默认自动补 `acp` 的假设
  5. 用自动化验证和真实交付测试锁住这条越权代选回归
- 本计划不处理：
  1. `implementation_executor_select` 参数协议改造
  2. ACP 实施、持续跟进和整改闭环的结构重构
  3. 插件缓存刷新问题

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| `NEEDS_IMPLEMENTATION_EXECUTOR` 必须成为对主会话也生效的硬闸门 | Task 01, Task 02, Task 03 | UT-01, UT-02, UT-05 | DT-01 | 待实施 |
| `start` 阶段不得提前接受 `implementation_executor` | Task 01, Task 03 | UT-01, UT-03 | DT-01 | 待实施 |
| 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select` | Task 01, Task 02, Task 03 | UT-02, UT-03, UT-05 | DT-01 | 待实施 |
| 主会话不得把 `coder/子代理` 暴露成该节点业务选项 | Task 02, Task 03 | UT-04, UT-05 | DT-01 | 待实施 |
| 用户选择 `main` 后，插件闭环结束；内部是否派 coder 属于后置内部策略 | Task 01, Task 02 | UT-01, UT-02 | DT-02 | 待实施 |
| 安装产物、构建产物与真实交付测试都保留该边界 | Task 02, Task 03, Task 04 | UT-04, UT-05, UT-06 | DT-01, DT-02, DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01: 切断实施入口的 `implementation_executor` 旁路

**业务目标：**

让主会话即使在 `start` 阶段提前带入 `implementation_executor=acp`，插件也不会接受该值，而是继续停在“实施执行方选择”。

**对应设计目标：**

- `NEEDS_IMPLEMENTATION_EXECUTOR` 必须成为对主会话也生效的硬闸门
- `start` 阶段必须完全屏蔽 `implementation_executor`
- 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select`

**设计来源：**

- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md` 的 `6.1 状态机变化`
- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md` 的 `6.2 用户可见行为变化`

**修改范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**文件范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 在 `start` 的 implementation 入口路径里定位 `implementation_executor` 读取点。
2. 修改 `start` 路径：即使调用方提前传了 `implementation_executor`，也不得直接进入 ACP 模型确认。
3. 保证 implementation 入口一律先返回 `NEEDS_IMPLEMENTATION_EXECUTOR`。
4. 补单测，锁住“`start` 传 `implementation_executor=acp` 仍必须停在实施执行方选择”。

**伪代码：**

```text
输入：start_phase = implementation + implementation_executor = acp
忽略或拒绝 implementation_executor
缓存不含 implementation_executor 的 startInput
输出 NEEDS_IMPLEMENTATION_EXECUTOR
```

**自动化验证：**

- `tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

这是切断“开始吧被误带成继续 ACP 实施”的第一层硬闸门。

**对应交付场景：**

- 用户进入实施阶段时，即使主会话误把“开始吧”理解成继续 ACP，也必须先停在实施执行方选择

**完成标准：**

- `start` 路径不再接受提前注入的 `implementation_executor`。
- 单测能稳定抓住这条旁路。

### Task 02: 给 `implementation_executor_select` 加节点上下文校验，并强化边界表达

**业务目标：**

让 `implementation_executor_select` 只能发生在插件已先发出“实施执行方选择”之后，并让首返/恢复态都更明确表达“当前是实施执行方选择，不是主会话内部派工选择”。

**对应设计目标：**

- `NEEDS_IMPLEMENTATION_EXECUTOR` 必须成为对主会话也生效的硬闸门
- 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select`
- 用户选择 `main` 后，插件闭环结束；内部是否派 coder 属于后置内部策略

**设计来源：**

- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md` 的 `6.3 数据结构或接口变化`

**修改范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**文件范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 检查首次返回 `buildNeedsImplementationExecutorResponse` 的字段与文案。
2. 检查恢复态 `status` 分支同一节点的字段与文案。
3. 给 `implementation_executor_select` 的“无活动 workflow”分支增加上下文校验，只允许消费插件已缓存的实施入口上下文。
4. 补更强的结构化边界字段或文案，明确这不是主会话内部派工选择。
5. 保持现有 `main/acp` 状态迁移和动作协议不变。
6. 补单元测试，锁住首返与恢复态的一致边界表达，以及“无上下文不得直接 implementation_executor_select”。

**伪代码：**

```text
输入：implementation_executor_select(main|acp)
if 没有活动 workflow 且没有已缓存实施入口上下文:
  拒绝继续推进
if 有实施入口上下文:
  允许消费 main/acp 选择
输出：只有经过实施执行方选择节点后，才允许离开该节点
```

**自动化验证：**

- `tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

这是让“先经过节点，再消费选择”的第二层硬闸门。

**对应交付场景：**

- 用户进入实施执行方选择时，首屏必须明确说明“这不是主会话内部派工选择”
- 用户未回复前，首屏不得出现模型确认、模型选择或 ACP 实施提示

**完成标准：**

- 首返与恢复态都明确表达“不是主会话内部派工选择”。
- 脱离实施入口上下文时，不允许直接 `implementation_executor_select`。
- 仍只暴露 `main/acp` 两项业务分流。

### Task 03: 清掉测试里的默认 ACP 假设，并把边界锁成回归护栏

**业务目标：**

先清掉单测 helper 自动补 `implementation_executor_select(acp)` 的默认假设，再在修复后把这条链路锁成长期护栏。

**对应设计目标：**

- `start` 阶段不得提前接受 `implementation_executor`
- 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select`
- 主会话不得把 `coder/子代理` 暴露成该节点业务选项
- 安装产物、构建产物与真实交付测试都保留该边界

**设计来源：**

- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md` 的 `8. 自动化验证目标`

**修改范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**文件范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 改单测 helper：默认不再自动补 `implementation_executor_select(acp)`。
2. 补红灯断言：`start(implementation + implementation_executor=acp)` 仍必须返回 `NEEDS_IMPLEMENTATION_EXECUTOR`。
3. 补红灯断言：没有实施入口上下文时，直接 `implementation_executor_select(acp)` 必须失败或拒绝推进。
4. 补文案与 skill 断言，继续锁住“不是主会话内部派工选择”“不得暴露 coder/子代理”。
5. 实现 Task 01 和 Task 02。
6. 修复后复跑目标测试，确认全部变绿。

**伪代码：**

```text
输入：当前仓库的 skill 文本 + bridge-service 返回 + 单测 helper
移除 helper 默认 acp
新增断言 -> start 阶段不得提前吃 implementation_executor
新增断言 -> implementation_executor_select 必须来自实施入口上下文
新增断言 -> 实施入口不得暴露 coder/子代理
修复后重新运行
输出：测试不再替生产代码掩盖错误默认值
```

**自动化验证：**

- 精准回归命令见第 5 节

**交付测试影响：**

这是防止以后再次由主会话越权代选的自动化护栏。

**对应交付场景：**

- 同一条真实业务链路在自动化层提前锁住“未选前不得推进”
- 自动化层不再默认帮生产代码选 ACP
- 安装产物也必须保留相同边界，避免源码对了而真实入口又漂移

**完成标准：**

- 红灯测试能稳定抓住本次缺口。
- helper 不再默认自动选 ACP。
- 修复后目标测试全部通过。

### Task 04: 自动化验证、构建和真实交付测试闭环

**业务目标：**

确保这次修复不只是仓库文案正确，而是从插件安装到真实 Codex CLI 入口的整条业务链路都恢复正确。

**对应设计目标：**

- 安装产物、构建产物与真实交付测试都保留该边界

**设计来源：**

- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md` 的 `9. 交付测试目标`

**修改范围：**

- 自动化验证命令与结果证据
- 真实插件安装与真实 Codex CLI 交付测试记录

**文件范围：**

- `package.json` 关联脚本执行结果
- `dist/` 插件交付物
- 本次真实安装与真实 CLI 交付测试记录

**实施步骤：**

1. 跑精准回归测试，再跑相关模块测试和全量测试。
2. 跑 `npm run build` 与 `npm run prepare:plugin`。
3. 按真实安装链重新安装当前插件并刷新 Codex 环境。
4. 用真实自然语言重跑“设计和计划已经确认，直接进入实施”的链路。
5. 验证在未回复 `1/2` 前，系统稳定停在实施执行方选择。
6. 再分别验证 `1` 路径与 `2` 路径。
7. 若失败，记录事实、补整改、重新跑同一条真实业务链路。

**伪代码：**

```text
输入：已完成代码修改的工作区
运行精准回归测试 -> 相关模块测试 -> 全量测试
运行 build -> prepare:plugin
安装插件并刷新真实 Codex 环境
从真实 CLI 输入实施业务语句
if 未回复前仍继续推进:
  判定交付测试失败并进入整改
if 回复 1 后插件未结束:
  判定交付测试失败并进入整改
if 回复 2 前出现模型确认:
  判定交付测试失败并进入整改
输出：同链路真实业务复测通过后才允许宣告完成
```

**自动化验证：**

- 第 5 节全部命令

**交付测试影响：**

自动化验证和真实交付测试都通过，才算这次 BUG 真正恢复可交付。

**对应交付场景：**

- 真实安装插件后，从 Codex CLI 输入实施业务语句
- 未回复 `1/2` 前验证系统停住
- 回复 `1` 和 `2` 后分别验证主会话路径与 ACP 路径

**完成标准：**

- 目标测试通过
- 全量测试通过
- 构建通过
- 插件准备通过
- 真实业务交付链路通过

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | `start` 阶段提前吃掉 `implementation_executor=acp`，跳过实施执行方选择 | `tests/unit/bridge-service-workflow.test.ts` 断言失败 | `start` 仍返回 `NEEDS_IMPLEMENTATION_EXECUTOR` |
| UT-02 | 无实施入口上下文时，仍可直接 `implementation_executor_select(acp)` 推进 | `tests/unit/bridge-service-workflow.test.ts` 断言失败 | 脱离上下文时被拒绝推进 |
| UT-03 | skill 未明确写出“用户未选择前不得调用 implementation_executor_select” | `tests/delivery/team-delegate-skill.delivery.test.ts` 断言失败 | skill 包含宿主级禁行规则 |
| UT-04 | 安装产物未保留宿主级禁行规则 | `tests/plugin/install.plugin.test.ts` 断言失败 | 安装产物断言通过 |
| UT-05 | 修复后影响既有实施执行方选择状态机测试或继续默认选 ACP 的 helper 假设 | 相关测试失败 | 既有状态机测试保持通过，helper 不再自动补 ACP |
| UT-06 | 修复后构建或插件准备失败 | `npm run build` / `npm run prepare:plugin` 失败 | 构建通过，插件准备通过 |

## 5. 自动化验证计划

### 5.1 精准回归测试

1. 红灯测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test -- tests/delivery/team-delegate-skill.delivery.test.ts
npm run test -- tests/plugin/install.plugin.test.ts
```

### 5.2 相关模块测试

2. 相关模块测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

### 5.3 全量测试

3. 全量验证：

```bash
npm test
```

### 5.4 编译或构建

4. 构建验证：

```bash
npm run build
```

### 5.5 插件或安装检查

5. 插件交付物准备：

```bash
npm run prepare:plugin
```

## 6. 真实业务交付测试计划

### DT-01：原失败链路复测

- 真实入口：
  1. 安装当前插件
  2. 刷新或重启 Codex 环境
  3. 打开 Codex CLI
- 真实业务语言：
  - “帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。”
- 复测步骤：
  1. 进入实施执行方选择
  2. 用户先不回复 `1/2`
  3. 观察系统是否停住
  4. 观察是否仍出现 `coder/子代理`
  5. 观察是否继续进入模型确认或 ACP 实施闭环
- 通过标准：
  - 未回复前稳定停住
  - 不出现 `coder/子代理`
  - 不出现模型确认或 ACP 实施推进

### DT-02：主会话路径复测

- 真实业务语言：
  - 在实施执行方选择节点回复 `1`
- 复测步骤：
  1. 回复 `1`
  2. 观察插件是否结束闭环
  3. 观察后续是否转为主会话负责
- 通过标准：
  - 进入 `TRANSFERRED_TO_MAIN`
  - 不再继续 ACP 模型确认或实施闭环

### DT-03：ACP 路径复测

- 真实业务语言：
  - 在实施执行方选择节点回复 `2`
- 复测步骤：
  1. 回复 `2`
  2. 观察是否进入模型确认/选择
  3. 观察是否继续进入 ACP 实施闭环
- 通过标准：
  - 只有在回复 `2` 之后，才进入模型确认与 ACP 实施闭环

### 6.4 操作步骤

1. 在干净工作区执行自动化验证与构建。
2. 执行本地插件安装链，刷新或重启 Codex 环境。
3. 打开 Codex CLI，用真实业务语言进入实施入口。
4. 首次到达实施执行方选择时，先不回复 `1/2`，观察是否停住。
5. 重新从真实入口进入同一链路，回复 `1`，验证插件闭环结束。
6. 再次从真实入口进入同一链路，回复 `2`，验证才进入模型确认与 ACP 实施闭环。

### 6.5 失败后整改与再测试

1. 记录失败场景、真实输入、实际表现和失败截图/回放。
2. 判断失败属于 skill 规则、bridge-service 返回、安装产物还是宿主编排漏口。
3. 补对应红灯测试。
4. 实施整改。
5. 重新执行第 5 节自动化验证。
6. 重新执行第 6 节同一条真实业务交付测试链路。

## 7. 交付测试失败整改记录

如果交付测试失败，必须执行以下闭环：

1. 记录新的失败事实，包含真实输入、实际表现、预期表现和失败截图/回放
2. 判断失败属于：
   - skill 规则漏口
   - bridge-service 返回漏口
   - 安装产物漏口
   - 宿主编排仍存在越权路径
3. 补对应红灯测试
4. 更新本计划状态
5. 实施整改
6. 重新执行自动化验证
7. 重新执行同一条真实业务交付测试链路

当前记录状态：

- 失败场景：尚未执行本次真实交付测试，待记录
- 输入数据：尚未执行本次真实交付测试，待记录
- 期望结果：未回复 `1/2` 前停在实施执行方选择；回复 `1` 后转主会话；回复 `2` 后才进 ACP
- 实际结果：尚未执行本次真实交付测试，待记录
- 根因分析：当前已确认历史失败来自主会话越权代选 ACP
- 修复方案：按本计划补宿主级硬闸门、结构化边界提示与回归护栏
- 复测命令：完成代码修改后执行第 5 节命令与第 6 节真实业务交付测试
- 复测结果：待执行

## 8. 设计完成核对清单

- [ ] `NEEDS_IMPLEMENTATION_EXECUTOR` 被补成对主会话也生效的硬闸门
- [ ] 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select`
- [ ] `coder/子代理` 不再出现在该节点的用户业务选项中
- [ ] 用户选择 `main` 后，插件闭环结束；主会话内部派工留到闭环结束后
- [ ] 自动化验证通过
- [ ] 真实业务交付测试通过

## 9. 上下文恢复说明

- 当前已确认：插件状态机和已安装 skill 都会返回“实施执行方选择”，问题发生在主会话编排层越权代选
- 当前修复策略：不改状态机迁移，只补对主会话生效的硬闸门与自动化/交付护栏
- 当前进度：设计文档与计划文档已完成，实施门禁已确认计划章节要求，下一步进入代码修改
- 恢复入口：回到本计划的 Task 01 开始实施，完成后依次执行 Task 02、Task 03、Task 04
- 下一步：按本计划先补红灯测试，再改 skill 和 bridge-service，最后跑真实业务链验证
