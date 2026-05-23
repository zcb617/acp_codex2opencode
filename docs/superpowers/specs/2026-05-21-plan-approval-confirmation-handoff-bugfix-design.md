# 主会话方案/计划路径未进入确认状态机 BUG 修复设计

## 1. 问题摘要

- Bug 名称：主会话方案/计划路径未进入确认状态机
- 影响对象：通过 Codex CLI 使用团队委派流程，由主会话执行方案或计划编写的最终用户
- 影响业务链路：
  1. 进入方案阶段或计划阶段
  2. 用户选择由主会话执行
  3. 主会话完成方案或计划文档
  4. 本应进入方案确认或计划确认
  5. 用户确认后进入下一阶段
- 当前失败结果：
  1. 主会话执行方案后，没有进入 `WAITING_DESIGN_APPROVAL`
  2. 主会话执行计划后，没有进入 `WAITING_PLAN_APPROVAL`
  3. 用户看到的是主会话直接继续推进，而不是插件确认闭环
  4. 计划完成后，用户回复 `同意`，系统直接进入普通实现流程，而不是先进入实施执行方选择
- 修复后业务结果：
  1. 主会话执行方案后，插件必须进入方案确认
  2. 主会话执行计划后，插件必须进入计划确认
  3. 用户确认后，系统继续当前委派闭环，而不是掉回普通开发流程
  4. 计划确认后的下一步必须先进入实施执行方选择

## 2. 与上一次 BUG 的边界区别

这次 BUG 和上一次不是一回事。

### 2.1 上一次 BUG 修的是什么

上一次修复的重点是：

1. 进入方案/计划阶段前，要显式展示“主会话执行 / ACP 委派执行”
2. 用户只回复 `同意`、`1`、`2` 这类短回复时，要优先按“继续已有委派闭环”理解

它修的是：

- 入口提示层
- 确认回合续接识别层

### 2.2 这一次 BUG 修的是什么

这一次修的是：

1. 用户选择主会话执行方案/计划后，主会话产出如何正式回填给插件状态机
2. 为什么主会话路径没有进入 `WAITING_DESIGN_APPROVAL / WAITING_PLAN_APPROVAL`
3. 为什么确认节点只在 ACP 方案/计划路径存在，而主会话路径不存在

它修的是：

- 主会话路径的状态机挂接层

### 2.3 为什么两次现象看起来像同一个问题

因为两次最终都表现为：

- 用户没有停在该停的业务节点
- 用户没有看到预期的下一步

但业务层级不同：

1. 上一次是“门口有没有正确的路牌”
2. 这一次是“主会话这条路后面根本没接到确认大厅”

## 3. 失败事实

### 3.1 真实业务现象

用户在真实入口中：

1. 进入方案阶段或计划阶段
2. 选择由主会话执行
3. 主会话完成方案或计划内容
4. 没有进入方案确认或计划确认
5. 后续继续由主会话直接推进
6. 计划完成后用户回复 `同意`
7. 没有先进入实施执行方选择，而是直接进入普通实现流程

### 3.2 预期表现

正确的业务链路应该是：

1. 进入方案阶段或计划阶段
2. 用户选择主会话执行
3. 主会话完成文档
4. 插件进入确认状态机：
   - 方案 -> `WAITING_DESIGN_APPROVAL`
   - 计划 -> `WAITING_PLAN_APPROVAL`
5. 用户确认或反馈
6. 确认后再进入下一阶段
7. 计划确认后先进入实施执行方选择

## 4. 根因分析

### 4.1 结构根因

当前代码中，主会话方案/计划路径和 ACP 方案/计划路径没有共享同一套确认状态机。

具体表现：

1. 当 `start` 判定到 `design/planning` 且选择主会话执行时，状态机会直接返回：
   - `NEEDS_MAIN_DESIGN`
   - `NEEDS_MAIN_PLANNING`
2. 这一步只是告诉主会话“下一步该去写文档了”，并没有把主会话后续产出挂回 workflow
3. 真正把 workflow 推进到：
   - `WAITING_DESIGN_APPROVAL`
   - `WAITING_PLAN_APPROVAL`
   的逻辑，只存在于 ACP 执行 `runDesignPhase / runPlanningPhase` 之后
4. 因此主会话路径天然缺少方案确认、计划确认

### 4.2 代码证据

#### 主会话路径只停在入口提示

- [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:1265)

这里在 `designPlanningExecutor === "main"` 时直接返回 `buildNeedsMainPhaseResponse(...)`，没有创建后续确认 workflow。

#### ACP 路径才会进入确认状态

- [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4490)
- [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4556)

这里分别在 ACP 执行完方案和计划后推进到：

- `WAITING_DESIGN_APPROVAL`
- `WAITING_PLAN_APPROVAL`

#### 当前确认态用户提示只覆盖已有 workflow

- [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4843)
- [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4869)

这说明确认态本身是存在的，但主会话路径没有走到这里。

### 4.3 为什么最近版本会稳定暴露

最近版本把入口选择和续接提示变得更严格以后，真实入口更容易稳定走到“主会话执行方案/计划”这条路径。

一旦走到这条路径，旧有结构缺口就会直接暴露：

1. 主会话写完文档
2. 没有状态机动作可以回填“已完成文档”
3. 也就不会进入确认态

所以从用户视角看，像是最近版本引入了新 BUG；从代码根因看，是旧结构缺陷被稳定暴露了。

## 5. 当前缺的不是提示语，而是状态动作

当前系统缺的不是一句“请确认”提示，而是两个正式的状态推进动作：

1. `design_complete`
   - 业务含义：主会话已完成方案文档
   - 插件收到后推进到 `WAITING_DESIGN_APPROVAL`

2. `planning_complete`
   - 业务含义：主会话已完成计划文档
   - 插件收到后推进到 `WAITING_PLAN_APPROVAL`

如果没有这两个动作，主会话路径只能停留在“口头上说写完了”，无法正式进入插件确认闭环。

## 6. 修复目标

### 6.1 必须完成

1. 新增主会话方案完成动作：`design_complete`
2. 新增主会话计划完成动作：`planning_complete`
3. `design_complete` 后推进到 `WAITING_DESIGN_APPROVAL`
4. `planning_complete` 后推进到 `WAITING_PLAN_APPROVAL`
5. 主会话确认节点继续复用：
   - `design_feedback`
   - `design_approve`
   - `planning_feedback`
   - `planning_approve`
6. `planning_approve` 后统一进入实施执行方选择
7. 技能和用户提示必须明确：
   - 主会话写完文档后，不是直接进入下一阶段
   - 而是必须调用对应 complete 动作进入确认态

### 6.2 不做的事

1. 不改 ACP 方案/计划执行路径的核心状态流
2. 不改实施执行方选择本身的状态定义
3. 不把这次问题再解释成缓存问题
4. 不仅靠补文案绕过结构问题

## 7. 修复设计

### 7.1 状态机扩展

在现有高层入口 `delegate.task.execute` 中新增两个动作：

1. `design_complete`
2. `planning_complete`

它们都属于“主会话完成文档后回填状态机”的动作。

### 7.2 业务流设计

#### 主会话方案路径

1. `start -> NEEDS_MAIN_DESIGN`
2. 用户选择主会话执行
3. 主会话完成前置梳理和方案文档
4. 调用 `design_complete`
5. 插件进入 `WAITING_DESIGN_APPROVAL`
6. 用户：
   - 确认 -> `design_approve`
   - 反馈 -> `design_feedback`

#### 主会话计划路径

1. `start -> NEEDS_MAIN_PLANNING`
2. 用户选择主会话执行
3. 主会话完成计划文档
4. 调用 `planning_complete`
5. 插件进入 `WAITING_PLAN_APPROVAL`
6. 用户：
   - 确认 -> `planning_approve`
   - 反馈 -> `planning_feedback`
7. `planning_approve` 后进入 `NEEDS_IMPLEMENTATION_EXECUTOR`

### 7.3 动作输入契约

`design_complete` 与 `planning_complete` 至少需要携带：

1. `workspace_path`
2. `session_alias` 或 `task_id`
3. `requirement_text`

如果需要校验文档路径一致性，可追加：

4. 当前文档路径或由插件按 `required_output_document` 回查

### 7.4 确认节点复用原则

这次不新增新的确认状态，也不新增新的确认动作。

复用现有：

1. `WAITING_DESIGN_APPROVAL`
2. `WAITING_PLAN_APPROVAL`
3. `design_feedback / design_approve`
4. `planning_feedback / planning_approve`

这样可以把修复范围收敛在“主会话路径如何接入现有状态机”。

## 8. 测试设计

### 8.1 红灯测试目标

必须先补失败测试，证明当前缺口真实存在：

1. 主会话方案路径完成后，没有进入 `WAITING_DESIGN_APPROVAL`
2. 主会话计划路径完成后，没有进入 `WAITING_PLAN_APPROVAL`
3. 主会话计划确认后，没有统一进入实施执行方选择

### 8.2 自动化验证目标

1. 单测覆盖：
   - `design_complete`
   - `planning_complete`
   - 主会话路径确认态推进
2. 交付规则测试覆盖：
   - 技能文案新增 complete 动作说明
   - 主会话确认闭环说明
3. 全量测试：
   - `npm test`
   - `npm run build`
   - `npm run prepare:plugin`

### 8.3 真实交付测试目标

必须用真实 Codex CLI 入口复测以下链路：

1. 用户进入方案阶段
2. 选择主会话执行方案
3. 主会话完成方案
4. 进入方案确认
5. 用户确认后进入下一阶段

以及：

1. 用户进入计划阶段
2. 选择主会话执行计划
3. 主会话完成计划
4. 进入计划确认
5. 用户只回复 `同意`
6. 进入实施执行方选择

## 9. 修改范围

至少涉及：

1. `src/session/bridge-service.ts`
2. `src/mcp-tools/schemas.ts`
3. `skills/team-delegate/SKILL.md`
4. `README.md`
5. `tests/unit/bridge-service-workflow.test.ts`
6. `tests/delivery/team-delegate-skill.delivery.test.ts`
7. 必要的交付测试脚本

## 10. 风险与回退

### 10.1 风险

1. 新增动作后，现有技能模板和调用说明需要同步更新，否则模型会不知道何时调用
2. 主会话路径接入 workflow 后，可能影响现有 `start` 恢复逻辑，需要验证旧任务恢复
3. 如果 complete 动作和现有 approve/feedback 动作职责划分不清，容易造成重复推进

### 10.2 回退原则

如果新增 complete 动作后发现状态语义不成立，可以回退到文档层重新设计，但不能继续停留在“只有提示，没有状态回填动作”的结构上。

## 11. 当前推进位置

当前任务推进到：

1. 已确认这次 BUG 和上一次不是同一个层级
2. 已确认当前文档必须重写，不能沿用上一次的 BUG 结构
3. 已确认当前真正缺的是主会话完成文档后的状态回填动作

下一步应做：

1. 按本设计重写计划文档
2. 用户确认后，再进入红灯测试与代码实施
