# 实施执行方选择节点误把默认项当成已选择 BUG 修复设计

## 1. 问题摘要

- Bug 名称：实施执行方选择节点误把默认项当成已选择
- 影响对象：通过 Codex CLI 使用团队委派流程、已经完成方案和计划确认的最终用户
- 影响业务链路：
  1. 用户从真实入口进入团队委派流程
  2. 方案和计划已经确认
  3. 流程进入“实施执行方选择”节点
  4. 本应停住等待用户回复 `1` 或 `2`
  5. 主会话却自行把默认项 `1` 当成用户已选，直接继续由主会话实施
- 当前失败结果：
  1. 用户没有真正完成“主会话继续实施 / ACP 委派实施”的业务选择
  2. 主会话越过选择门禁，直接结束二选一步骤
  3. 用户无法确认后续由谁承担编码、自动化测试、交付测试和失败整改
- 修复后业务结果：
  1. “实施执行方选择”必须停住等待用户明确回复 `1` 或 `2`
  2. 默认项 `1` 仅表示推荐项，不得视为已选择
  3. 用户不回复时，主会话不得静默推进到主会话实施、模型选择或 ACP 实施运行态

## 2. 失败事实

- 触发入口：Codex CLI 真实自然语言入口
- 用户输入：进入团队委派流程后，方案和计划均已确认，继续进入实施
- 实际表现：主会话在展示“实施执行方选择”时，自行表达“跳过 2 选 1，默认选择 1”，没有等待用户回复
- 预期表现：主会话必须明确要求用户直接回复 `1` 或 `2`，并在收到明确选择前停住
- 复现频率：已有用户截图证据，且当前规则文本存在结构性缺口，可稳定解释该行为
- 证据：
  1. 用户截图显示主会话口径为“跳过 2 选 1，默认选择 1”
  2. [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:2656) 只返回 `default_option` 和 `user_options`，没有任何“自动代选”动作
  3. [skills/team-delegate/SKILL.md](/var/work/acp_codex2opencode/skills/team-delegate/SKILL.md:160) 对 `NEEDS_IMPLEMENTATION_EXECUTOR` 只写了“默认 1”，但没有像设计/计划执行方选择那样写出“必须停住等待用户选择、禁止静默按默认 1 继续”的硬约束

## 3. 影响范围

- 受影响功能：团队委派流程中的“实施执行方选择”节点
- 受影响用户动作：
  1. 用户完成方案确认和计划确认后，进入实施入口
  2. 用户尚未表态时，系统却代替用户选择“主会话继续实施”
- 受影响状态或数据：
  1. 业务语义上，选择门禁被越过
  2. 后续责任归属被主会话擅自决定
- 不受影响范围：
  1. 状态机本身对 `implementation_executor_select` 的参数契约没有改变
  2. `continue_wait` 场景下的超时默认继续规则仍然成立，但那属于“长时间无进展决策”，不属于“实施执行方选择”
  3. 方案执行方选择、计划执行方选择已有更明确的停步规则
- 不修复的交付风险：
  1. 真实用户会被系统替做关键业务决策
  2. 团队委派流程无法保证“实施责任归属”由用户明确确认
  3. 后续 ACP 模型选择与主会话实施闭环都可能建立在错误前提上

## 4. 根因分析

### 4.1 直接原因

`NEEDS_IMPLEMENTATION_EXECUTOR` 节点的规则约束不够完整。

当前规则只写明：

1. 这是一个二选一节点
2. 默认项是 `1`
3. 用户选 `1` 或 `2` 后应调用什么动作

但没有像 `NEEDS_MAIN_DESIGN / NEEDS_MAIN_PLANNING` 那样，把以下内容写成同级硬约束：

1. 必须先停住等待用户选择
2. 禁止静默按默认 `1` 继续
3. 禁止把默认值当成用户已经选择
4. 必须要求用户直接回复 `1` 或 `2`

### 4.2 深层原因

规则层和状态返回层对这个节点的表达不一致：

1. 状态返回层只把 `default_option = "1"` 作为推荐项返回
2. 规则层没有明确限定“默认值只是推荐，不是自动执行条件”
3. 主会话于是把“默认推荐项”误解成“可以直接代选”

同时，`start` 入口首次返回的 `user_message` 比恢复态 `status` 分支更弱：

- 首次返回文案见 [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:2661)
- 恢复态文案见 [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:5521)

恢复态已经明确写了“请直接回复 `1` 或 `2`”，首次返回却没有把这条停步要求写完整，进一步放大了误读空间。

### 4.3 为什么现有测试没有发现

现有测试覆盖了：

1. 这个节点会返回 `workflow_status = NEEDS_IMPLEMENTATION_EXECUTOR`
2. 业务文案包含“实施执行方选择”
3. `default_option = "1"`

但没有覆盖：

1. 首次返回文案必须要求用户直接回复 `1` 或 `2`
2. 技能规则必须明确禁止静默按默认 `1` 继续
3. 安装产物里的 skill 文本必须保留这条硬约束

### 4.4 证据链

1. 状态机构造函数只返回选项，不会自动提交 `implementation_executor_select`：
   - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:2656)
2. 恢复态已经明确要求用户回复 `1` 或 `2`，说明系统目标本来就是“等待用户选”：
   - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:5516)
3. 当前 skill 在 `NEEDS_IMPLEMENTATION_EXECUTOR` 规则里缺少“禁止静默按默认 1 继续”的硬门禁：
   - [skills/team-delegate/SKILL.md](/var/work/acp_codex2opencode/skills/team-delegate/SKILL.md:160)
4. 同一份 skill 对 `NEEDS_MAIN_DESIGN / NEEDS_MAIN_PLANNING` 已经写了完整停步规则，可作为对照：
   - [skills/team-delegate/SKILL.md](/var/work/acp_codex2opencode/skills/team-delegate/SKILL.md:201)

## 5. 修复目标与非目标

### 5.1 修复目标

- `NEEDS_IMPLEMENTATION_EXECUTOR` 必须明确成为硬门禁节点
- 默认项 `1` 只能表示推荐项，不能被当成已选择
- 首次进入该节点时，用户可见文案必须明确要求直接回复 `1` 或 `2`
- 技能规则、安装产物断言、交付文案断言必须同步覆盖这条门禁，防止以后再回归

### 5.2 非目标

- 不修改 `implementation_executor_select` 动作本身的参数定义
- 不修改 `continue_wait` 的超时默认继续机制
- 不改变“默认推荐项为 1”这个产品选择
- 不在本次修复中新增新的工作流状态

## 6. 修复设计

### 6.1 规则层修复

在 `skills/team-delegate/SKILL.md` 的 `NEEDS_IMPLEMENTATION_EXECUTOR` 规则中补齐以下硬约束：

1. 必须先停住等待用户选择
2. 禁止静默按默认 `1` 继续
3. 禁止把默认值当成用户已经选择
4. 必须要求用户直接回复 `1` 或 `2`
5. 在用户选择前，禁止进入 `model_confirm`、`model_select` 或 `RUNNING_IMPLEMENTATION`

### 6.2 用户可见文案修复

在桥接服务首次返回 `NEEDS_IMPLEMENTATION_EXECUTOR` 时，把停步要求写进 `user_message` 和 `next_business_action`：

1. 明确这是“实施执行方选择”
2. 明确这是因为方案和计划都已确认
3. 明确必须直接回复 `1` 或 `2`
4. 明确在收到选择前不会继续推进

### 6.3 测试修复

补三层护栏：

1. 单元测试：首次进入 `NEEDS_IMPLEMENTATION_EXECUTOR` 时，文案必须包含“请直接回复 `1` 或 `2`”
2. 交付测试文本断言：skill 必须包含“必须先停住等待用户选择执行方”“禁止静默按默认 1 继续”“禁止把默认值当成用户已经选择”
3. 安装产物断言：打包后的 skill 文本必须保留上述硬约束

### 6.4 回退方案

如果本次修复引发其它节点文案断言失败，回退范围只限于：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 规则段落
2. 首次返回的业务文案
3. 新增的测试断言

不回退其他状态机能力。

## 7. 修改范围

- `skills/team-delegate/SKILL.md`：补实施执行方选择节点的停步硬约束
- `src/session/bridge-service.ts`：补首次进入实施执行方选择时的明确停步文案
- `tests/unit/bridge-service-workflow.test.ts`：补首次返回文案的红灯与回归断言
- `tests/delivery/team-delegate-skill.delivery.test.ts`：补 skill 文本规则断言
- `tests/plugin/install.plugin.test.ts`：补安装产物 skill 规则断言
- `docs/superpowers/specs/2026-05-23-implementation-executor-default-selection-bugfix-design.md`：本次设计文档
- `docs/superpowers/plans/2026-05-23-implementation-executor-default-selection-bugfix-plan.md`：本次计划文档

## 8. 自动化验证目标

- 红灯测试先证明：当前首次进入实施执行方选择时，测试未强制要求“请直接回复 `1` 或 `2`”与“不准静默默认继续”
- 修复后目标测试通过：
  1. `tests/unit/bridge-service-workflow.test.ts`
  2. `tests/delivery/team-delegate-skill.delivery.test.ts`
  3. `tests/plugin/install.plugin.test.ts`
- 相关模块测试和全量测试保持通过
- 构建和插件准备命令保持通过，确保交付物可安装

## 9. 交付测试目标

- 真实入口：安装当前插件，刷新或重启 Codex，打开 Codex CLI，以自然语言触发团队委派流程
- 真实业务语言：
  - “设计和计划已经确认，直接进入实施。”
  - 进入实施执行方选择后，不立即回复 `1` 或 `2`
- 原失败链路：
  1. 进入“实施执行方选择”
  2. 主会话自行说“跳过 2 选 1，默认选择 1”
  3. 直接转入主会话实施
- 修复后同链路复测：
  1. 用相同自然语言进入实施入口
  2. 观察系统是否停在“实施执行方选择”
  3. 验证系统明确要求用户直接回复 `1` 或 `2`
  4. 在未回复时，系统不得继续进入主会话实施或 ACP 实施闭环
  5. 用户回复 `1` 或 `2` 后，流程再按对应路径推进
- 通过标准：
  1. 不再出现“跳过 2 选 1，默认选择 1”
  2. 未收到明确选择前，流程稳定停在实施执行方选择
  3. 回复 `1` 后进入主会话实施；回复 `2` 后进入 ACP 模型确认/选择
  4. `docs/团队委派交付测试必过表.md` 中相关项同时通过
- 若复测失败：
  1. 记录失败截图或日志
  2. 判断是规则层漏改、文案层漏改还是安装产物未刷新
  3. 补测试、补规则、重新构建安装后再次执行同一链路

## 10. 风险与回退

- 风险：
  1. 只改 skill 不改首次返回文案，真实入口仍可能给主会话留下误读空间
  2. 只改文案不改测试，后续版本可能再次把这条硬约束删掉
  3. 安装产物若未覆盖新断言，真实插件仍可能和仓库内容漂移
- 回退路径：
  1. 回退本次 skill 规则和文案增强
  2. 同步回退新增断言
  3. 保留设计与计划文档，便于重新实施

## 11. 上下文恢复说明

- 当前任务聚焦的是“实施执行方选择”节点，不是 `continue_wait` 的超时默认继续，也不是缓存刷新问题
- 关键判断：状态机没有自动代选；问题出在主会话规则层把 `default_option=1` 误解为“可直接代选”
- 实施时优先顺序：先补测试红灯，再改 skill 和首次返回文案，再做自动化验证，最后跑真实交付测试
