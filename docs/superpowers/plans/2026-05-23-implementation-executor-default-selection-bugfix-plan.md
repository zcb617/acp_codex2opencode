# 实施执行方选择节点误把默认项当成已选择 BUG 修复计划

## 1. Bug 与设计来源

- Bug 名称：实施执行方选择节点误把默认项当成已选择
- 设计文档：`docs/superpowers/specs/2026-05-23-implementation-executor-default-selection-bugfix-design.md`
- 当前失败链路：
  1. 用户从真实入口进入团队委派流程
  2. 方案和计划已确认，进入实施执行方选择
  3. 主会话把默认项 `1` 当成用户已选
  4. 直接跳过二选一，继续主会话实施
- 本计划目标：
  1. 把实施执行方选择补成硬门禁
  2. 强化首次返回文案
  3. 用自动化测试和真实交付测试锁住回归
- 本计划不处理：
  1. `continue_wait` 的超时默认继续逻辑
  2. `implementation_executor_select` 的参数协议
  3. 插件缓存刷新链路

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 实施执行方选择必须停住等待用户明确回复 `1/2` | Task 01, Task 03 | UT-01, UT-03 | DT-01 | 待实施 |
| 默认项 `1` 只能表示推荐项，不得视为已选择 | Task 01, Task 03 | UT-02, UT-03 | DT-01 | 待实施 |
| 首次进入该节点时，文案必须要求用户直接回复 `1/2` | Task 02, Task 03 | UT-01 | DT-01 | 待实施 |
| 安装产物里的 skill 仍保留这条硬门禁 | Task 03 | UT-03 | DT-02 | 待实施 |
| 相关测试、构建和插件准备流程保持通过 | Task 04 | UT-04, UT-05 | DT-02 | 待实施 |

## 3. 实施任务拆分

### Task 01: 补实施执行方选择的规则层硬门禁

**业务目标：**

让主会话在进入“实施执行方选择”后，必须停住等待用户明确回复 `1` 或 `2`，不再把默认项当成已选择。

**对应设计目标：**

- 实施执行方选择必须停住等待用户明确回复 `1/2`
- 默认项 `1` 只能表示推荐项，不得视为已选择

**修改范围：**

- `skills/team-delegate/SKILL.md`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 在 `NEEDS_IMPLEMENTATION_EXECUTOR` 规则段补充停步硬约束。
2. 明确写出“必须先停住等待用户选择”。
3. 明确写出“禁止静默按默认 1 继续”。
4. 明确写出“禁止把默认值当成用户已经选择”。
5. 明确写出“必须要求用户直接回复 `1` 或 `2`”。
6. 同步补交付断言和安装产物断言。

**伪代码：**

```text
输入：workflow_status = NEEDS_IMPLEMENTATION_EXECUTOR + default_option = 1
if 用户尚未明确回复 1 或 2:
  输出业务说明 + 直接回复 1 或 2 的要求
  保持当前节点不推进
if 用户回复 1:
  调用 implementation_executor_select(main)
else if 用户回复 2:
  调用 implementation_executor_select(acp)
输出：只有用户明确选择后，流程才离开实施执行方选择
```

**自动化验证：**

- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**交付测试影响：**

这是阻断“主会话代替用户选 1”的第一层门禁。

**完成标准：**

- skill 规则中出现完整停步约束。
- 交付断言和安装断言都覆盖到该约束。

### Task 02: 强化首次进入实施执行方选择时的业务文案

**业务目标：**

让首次返回该节点时，文案就明确表达“必须直接回复 `1` 或 `2`，未选择前不会继续”。

**对应设计目标：**

- 首次进入该节点时，文案必须要求用户直接回复 `1/2`

**修改范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 修改 `buildNeedsImplementationExecutorResponse` 的 `user_message`。
2. 修改 `next_business_action`，明确要求用户直接回复 `1` 或 `2`。
3. 保持现有状态和选项结构不变。
4. 补单元测试断言，确保首次返回文案必须带这条要求。

**伪代码：**

```text
输入：planning_approve 后或 implementation start 后进入 NEEDS_IMPLEMENTATION_EXECUTOR
构造 business_reason = 方案和计划都已确认
构造 user_message = 当前阶段 + 进入原因 + 两个选择 + 请直接回复 1 或 2
构造 next_business_action = 选择实施执行方，并直接回复 1 或 2
输出：仍返回 default_option 和 user_options，但不暗示自动代选
```

**自动化验证：**

- `tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

这是让真实入口第一时间把停步语义说清楚的第二层门禁。

**完成标准：**

- 首次返回文案明确要求直接回复 `1` 或 `2`。
- 原有业务语义字段和动作集合不变。

### Task 03: 先做红灯测试，再做回归锁定

**业务目标：**

先让测试能抓住当前缺口，再在修复后稳定变绿，防止未来再次删除这条门禁。

**对应设计目标：**

- 实施执行方选择必须停住等待用户明确回复 `1/2`
- 默认项 `1` 只能表示推荐项，不得视为已选择
- 安装产物里的 skill 仍保留这条硬门禁

**修改范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 先补单元测试红灯，要求首次返回文案包含“请直接回复 `1` 或 `2`”。
2. 先补 skill 文本红灯，要求 `NEEDS_IMPLEMENTATION_EXECUTOR` 含完整停步约束。
3. 运行目标测试，确认当前版本至少有一项失败，且失败原因就是本次 BUG。
4. 再进入 Task 01 和 Task 02 的实现。
5. 修复后复跑目标测试，确认全部变绿。

**伪代码：**

```text
输入：当前仓库代码与 skill 文本
新增断言 -> 首次实施执行方选择必须要求直接回复 1 或 2
新增断言 -> skill 必须禁止静默按默认 1 继续
运行目标测试
if 测试未失败:
  说明断言没有抓住本次缺口，需要先修正断言
修复代码与规则后重新运行
输出：测试从红灯变绿，且失败原因与修复目标一致
```

**自动化验证：**

- 精准回归命令见第 5 节

**交付测试影响：**

这是本次修复能否长期保持的自动化护栏。

**完成标准：**

- 红灯阶段能稳定抓住缺口。
- 修复后目标测试全部通过。

### Task 04: 自动化验证、构建和插件准备检查

**业务目标：**

确保这次修复没有破坏已有委派流程，也没有破坏插件交付物生成。

**对应设计目标：**

- 相关测试、构建和插件准备流程保持通过

**修改范围：**

- 自动化验证命令与结果证据

**实施步骤：**

1. 跑精准回归测试。
2. 跑相关模块或全量测试。
3. 跑构建。
4. 跑插件准备命令。
5. 记录成功或失败事实，失败则回到相应任务整改。

**伪代码：**

```text
输入：已完成的规则、文案与测试修改
运行精准回归测试
if 失败:
  回到对应任务修复
运行 npm test
运行 npm run build
运行 npm run prepare:plugin
输出：自动化验证与交付物生成结果
```

**自动化验证：**

- 第 5 节全部命令

**交付测试影响：**

自动化验证是交付测试前置门禁，不通过就不得宣告完成。

**完成标准：**

- 目标测试通过
- 全量测试通过
- 构建通过
- 插件准备通过

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 首次进入实施执行方选择时，文案没有强制要求用户直接回复 `1/2` | `tests/unit/bridge-service-workflow.test.ts` 断言失败 | 首次返回文案包含“请直接回复 `1` 或 `2`” |
| UT-02 | skill 没有明确禁止把默认值当成已选择 | `tests/delivery/team-delegate-skill.delivery.test.ts` 断言失败 | skill 包含“禁止把默认值当成用户已经选择” |
| UT-03 | 安装产物 skill 没有锁住这条规则 | `tests/plugin/install.plugin.test.ts` 断言失败 | 安装断言能确认 skill 保留停步硬约束 |
| UT-04 | 修复后影响其它委派测试 | 相关测试失败 | 相关测试保持通过 |
| UT-05 | 修复后构建或插件准备失败 | `build` 或 `prepare:plugin` 失败 | 两个命令都通过 |

## 5. 自动化验证计划

1. 红灯测试：

```bash
npm run test -- tests/unit/bridge-service-workflow.test.ts -t "should ask for a model with business-oriented wording only when entering implementation"
npm run test -- tests/delivery/team-delegate-skill.delivery.test.ts
npm run test -- tests/plugin/install.plugin.test.ts
```

2. 相关模块测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

3. 全量验证：

```bash
npm test
```

4. 构建验证：

```bash
npm run build
```

5. 插件交付物检查：

```bash
npm run prepare:plugin
```

## 6. 真实业务交付测试计划

### DT-01：复测原失败链路

1. 安装当前插件。
2. 刷新或重启 Codex。
3. 打开 Codex CLI。
4. 输入真实业务语言：`设计和计划已经确认，直接进入实施。`
5. 观察是否进入“实施执行方选择”。
6. 在不回复 `1` 或 `2` 的前提下，观察系统是否停住。
7. 通过标准：
   - 系统明确要求用户直接回复 `1` 或 `2`
   - 未收到选择前不继续推进
   - 不再出现“跳过 2 选 1，默认选择 1”

### DT-02：验证两个分支都只在明确选择后推进

1. 重新进入相同业务链路。
2. 第一次回复 `1`，验证进入主会话实施路径。
3. 第二次回复 `2`，验证进入 ACP 模型确认或选择路径。
4. 通过标准：
   - 两个分支都只在明确回复后才推进
   - 默认项 `1` 不会在未回复时自动触发

### DT-03：复跑必过表相关项

1. 按 `docs/团队委派交付测试必过表.md` 复跑本次相关测试项。
2. 任一项不通过都视为交付测试失败。

## 7. 交付测试失败整改记录

- 初始状态：待执行
- 若 DT-01 / DT-02 / DT-03 任一失败，必须记录：
  1. 失败时间
  2. 失败入口
  3. 失败语言
  4. 实际表现
  5. 与设计目标的偏差
  6. 新增整改任务
  7. 再次验证结果

## 8. 设计完成核对清单

- [ ] `NEEDS_IMPLEMENTATION_EXECUTOR` 已补成硬门禁
- [ ] 首次进入该节点时的文案已明确要求回复 `1/2`
- [ ] skill 已明确“禁止静默按默认 1 继续”
- [ ] 单元测试已覆盖首次返回文案
- [ ] 交付 skill 断言已覆盖停步约束
- [ ] 安装产物断言已覆盖停步约束
- [ ] 自动化验证通过
- [ ] 真实交付测试通过

## 9. 上下文恢复说明

- 当前任务不是改状态机参数协议，而是补“实施执行方选择”的规则层和文案层门禁
- 关键文件：
  - `skills/team-delegate/SKILL.md`
  - `src/session/bridge-service.ts`
  - `tests/unit/bridge-service-workflow.test.ts`
  - `tests/delivery/team-delegate-skill.delivery.test.ts`
  - `tests/plugin/install.plugin.test.ts`
- 实施顺序不能反：先红灯测试，再修改规则和文案，再做自动化验证，最后做真实交付测试
