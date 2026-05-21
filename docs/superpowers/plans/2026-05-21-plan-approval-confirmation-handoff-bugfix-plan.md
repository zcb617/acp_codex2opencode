# 主会话方案/计划路径未进入确认状态机 BUG 修复计划

## 1. 设计来源

- 对应设计文档：
  - `docs/superpowers/specs/2026-05-21-plan-approval-confirmation-handoff-bugfix-design.md`
- 当前任务本质：
  - 修复主会话方案/计划路径没有接入插件确认状态机的问题
- 本次计划不再沿用上一次“入口提示 / 续接识别”那套任务划分

## 2. 当前失败链路

### 2.1 方案路径

1. 用户进入方案阶段
2. 用户选择主会话执行方案
3. 主会话完成方案文档
4. 插件没有进入 `WAITING_DESIGN_APPROVAL`
5. 后续只能靠主会话自由发挥，不是插件闭环

### 2.2 计划路径

1. 用户进入计划阶段
2. 用户选择主会话执行计划
3. 主会话完成计划文档
4. 插件没有进入 `WAITING_PLAN_APPROVAL`
5. 用户回复 `同意`
6. 系统直接进入普通实现流程
7. 没有先进入实施执行方选择

## 3. 本次计划目标

1. 为主会话方案路径补正式回填动作：`design_complete`
2. 为主会话计划路径补正式回填动作：`planning_complete`
3. 主会话完成方案后进入 `WAITING_DESIGN_APPROVAL`
4. 主会话完成计划后进入 `WAITING_PLAN_APPROVAL`
5. 继续复用现有：
   - `design_feedback / design_approve`
   - `planning_feedback / planning_approve`
6. 计划确认后统一进入实施执行方选择

## 4. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 真实交付测试 |
|---|---|---|---|
| 主会话方案完成后进入 `WAITING_DESIGN_APPROVAL` | Task 01, Task 03 | UT-01, UT-03 | DT-01 |
| 主会话计划完成后进入 `WAITING_PLAN_APPROVAL` | Task 01, Task 03 | UT-02, UT-03 | DT-02 |
| 主会话确认继续复用现有 approve/feedback 动作 | Task 02, Task 03 | UT-04 | DT-01, DT-02 |
| 计划确认后进入实施执行方选择 | Task 02, Task 03 | UT-05 | DT-02 |
| 技能与说明明确主会话 complete 动作契约 | Task 04 | UT-06 | DT-03 |

## 5. 实施任务拆分

### Task 01：补主会话 complete 动作的状态机能力

**业务目标**

让主会话写完方案/计划后，能够正式把“文档已完成”回填给插件状态机。

**修改范围**

1. `src/session/bridge-service.ts`
2. `src/mcp-tools/schemas.ts`

**实施步骤**

1. 在高层入口新增两个动作：
   - `design_complete`
   - `planning_complete`
2. 定义动作入参校验：
   - `workspace_path`
   - `session_alias` 或 `task_id`
   - `requirement_text`
3. 让 `design_complete` 推进到 `WAITING_DESIGN_APPROVAL`
4. 让 `planning_complete` 推进到 `WAITING_PLAN_APPROVAL`

**完成标准**

主会话路径不再停留在“只是告诉你去写文档”，而是能正式进入插件确认状态机。

### Task 02：让主会话确认路径接入现有 approve/feedback 闭环

**业务目标**

主会话路径进入确认态后，后续确认和反馈必须和 ACP 路径使用同一套动作。

**修改范围**

1. `src/session/bridge-service.ts`
2. 工作流状态推进逻辑

**实施步骤**

1. 确认 `design_feedback / design_approve` 可作用于主会话方案确认
2. 确认 `planning_feedback / planning_approve` 可作用于主会话计划确认
3. 保证 `planning_approve` 后统一进入 `NEEDS_IMPLEMENTATION_EXECUTOR`

**完成标准**

无论方案/计划是谁写的，只要进入确认态，后续推进动作一致。

### Task 03：补主会话确认闭环的红灯与回归测试

**业务目标**

先让测试抓住当前缺口，再验证修复结果。

**修改范围**

1. `tests/unit/bridge-service-workflow.test.ts`

**红灯测试点**

1. 主会话方案完成后必须进入 `WAITING_DESIGN_APPROVAL`
2. 主会话计划完成后必须进入 `WAITING_PLAN_APPROVAL`
3. 主会话计划确认后必须进入实施执行方选择
4. 不能直接掉回普通实现流程

**完成标准**

当前代码先失败，修复后变绿。

### Task 04：同步技能与说明文档

**业务目标**

让模型知道主会话写完文档后，不是自由推进，而是必须调用 complete 动作进入确认态。

**修改范围**

1. `skills/team-delegate/SKILL.md`
2. `README.md`
3. `tests/delivery/team-delegate-skill.delivery.test.ts`

**实施步骤**

1. 在技能里新增主会话 complete 动作调用模板
2. 明确说明：
   - 主会话写完方案 -> `design_complete`
   - 主会话写完计划 -> `planning_complete`
3. 保持已有确认动作说明不变，只补主会话状态挂接部分

**完成标准**

技能和 README 都能准确表达这次修复后的真实流程。

### Task 05：自动化验证

**命令**

1. `npm run test -- tests/unit/bridge-service-workflow.test.ts`
2. `npm run test -- tests/delivery/team-delegate-skill.delivery.test.ts`
3. `npm test`
4. `npm run build`
5. `npm run prepare:plugin`

**完成标准**

所有相关测试和全量自动化通过。

### Task 06：真实交付测试

**真实入口要求**

1. 安装当前插件
2. 重启或刷新 Codex 使用环境
3. 从真实 Codex CLI 自然语言入口发起

**链路一：主会话方案确认**

1. 用户进入方案阶段
2. 选择主会话执行方案
3. 主会话完成方案
4. 进入方案确认
5. 用户确认后进入下一阶段

**链路二：主会话计划确认**

1. 用户进入计划阶段
2. 选择主会话执行计划
3. 主会话完成计划
4. 进入计划确认
5. 用户只回复 `同意`
6. 进入实施执行方选择

**链路三：必过表复测**

1. 复跑 `docs/团队委派交付测试必过表.md` 相关项目

**完成标准**

真实用户路径上，主会话方案/计划也能稳定进入确认状态机。

## 6. TDD 与红灯顺序

必须按下面顺序做：

1. 先补单测红灯：
   - 主会话方案 complete
   - 主会话计划 complete
2. 运行目标测试，确认当前失败
3. 再改状态机代码
4. 变绿后补技能说明与交付测试

## 7. 风险与整改机制

### 7.1 风险

1. 新增 complete 动作后，现有技能如果不同步，真实入口仍不会调用
2. 主会话路径一旦建立 workflow，可能影响旧任务恢复逻辑
3. 如果把 complete 和 approve 混成同一个动作，后续状态会继续混乱

### 7.2 失败后的整改规则

如果交付测试失败：

1. 记录失败链路是哪个节点：
   - 没进入方案确认
   - 没进入计划确认
   - 计划确认后没进实施执行方选择
2. 补充测试
3. 修复后重新跑同一条真实链路

## 8. 当前推进位置

当前已完成：

1. 重新识别这次 BUG 的真实层级
2. 重写设计文档，不再沿用上一次的 BUG 结构

下一步：

1. 用户确认文档
2. 再进入红灯测试和代码实施
