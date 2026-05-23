# 实施阶段业务分流与主会话内部派工边界错位 BUG 修复设计

## 1. 问题摘要

- Bug 名称：实施阶段业务分流与主会话内部派工边界错位
- 影响对象：通过 Codex CLI 使用团队委派流程、并已完成方案与计划确认的最终用户
- 影响业务链路：
  1. 用户从真实入口进入团队委派流程
  2. 方案和计划已经确认
  3. 流程进入“实施执行方选择”
  4. 用户本应在“主会话继续实施 / ACP 委派实施”之间二选一
  5. 主会话却把内部 `coder` 子代理混入该业务选择
- 当前失败结果：
  1. 用户看到的不是插件定义的业务选项，而是被改写后的内部执行选项
  2. 用户表面选择“子代理/coder”时，底层实际提交的仍是 ACP 路径
  3. 用户无法稳定理解自己是在选择“实施执行方”，还是在选择“主会话内部派工方式”
- 修复完成后应恢复的业务结果：
  1. 实施入口对用户只暴露“主会话继续实施 / ACP 委派实施”两项
  2. 选择主会话后，插件闭环立即结束
  3. 主会话内部是否再派 coder，只能在插件闭环结束后由主会话自行决定，不能出现在插件业务选择中

## 2. 失败事实

- 触发入口：Codex CLI 真实自然语言入口
- 用户输入：进入团队委派流程后，已明确“设计和计划已经确认，直接进入实施”
- 实际表现：
  1. 用户看到的二选一被表述成“主会话直接改 / 交给 coder 子代理实施”
  2. 用户选择第二项后，后续仍继续进入 ACP 路径，并触发 `opencode models`
- 预期表现：
  1. 用户只能看到“主会话继续实施 / ACP 委派实施”
  2. 只有在用户明确选择 ACP 后，才允许进入模型确认、模型选择和 `opencode models`
- 失败场景：实施阶段入口选择
- 是否可复现：已有用户截图证据，且当前代码与规则边界能够稳定解释该错位
- 证据：
  1. 用户截图显示实施入口出现了 `coder` 子代理选项，并在选择该项后继续进入 ACP 路径
  2. [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:2656) 返回的正式业务选项只有 `主会话继续实施` 与 `ACP 委派实施`
  3. [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:1588) 明确规定：选择 `implementation_executor=main` 后立即转 `TRANSFERRED_TO_MAIN`
  4. [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4749) 明确规定：转主会话后插件闭环结束，后续编码、自动化测试、真实交付测试和失败修复由主会话负责
  5. [skills/team-delegate/SKILL.md](/var/work/acp_codex2opencode/skills/team-delegate/SKILL.md:160) 对 `NEEDS_IMPLEMENTATION_EXECUTOR` 的正式规则也只允许 `主会话继续实施 / ACP 委派实施`

## 3. 影响范围

- 受影响功能：团队委派流程中的“实施执行方选择”节点
- 受影响用户动作：
  1. 用户完成方案确认和计划确认后，进入实施入口
  2. 用户需要判断是继续由主会话负责，还是交给 ACP
  3. 用户在未选择 ACP 的情况下，却看到了 `coder/子代理` 这类内部实现词汇
- 受影响状态或数据：
  1. 用户可见的业务分流语义被污染
  2. 业务选项标签与底层动作语义发生错位
  3. ACP 路径可能在用户并未明确选择 ACP 的前提下被误触发
- 不受影响范围：
  1. `implementation_executor_select` 的状态机契约仍然正确，仍只接受 `main` 或 `acp`
  2. 选择 `main` 后插件闭环结束、选择 `acp` 后继续 ACP 的状态迁移仍然正确
  3. 设计阶段、计划阶段的主会话/ACP 分流规则不在本次根因范围内
- 如果不修复的交付风险：
  1. 用户会把“插件业务分流”误解成“主会话内部派工”
  2. 测试 ACP 路径时无法确认自己是在测插件，还是在测主会话内部策略
  3. 后续任何涉及 `coder` 的主会话规则都可能继续污染插件实施入口

## 4. 根因分析

### 4.1 直接原因

实施入口的插件状态机与主会话对用户的转述口径发生了错层：

1. 插件返回的是“实施执行方选择”
2. 主会话向用户表达时却改写成了“主会话直接改 / coder 子代理实施”
3. 改写后的第二项在动作层仍被映射成 `implementation_executor=acp`

最终导致“用户看到的是子代理，系统执行的是 ACP”。

### 4.2 深层原因

插件业务边界和主会话内部工作流边界没有被明确卡死：

1. 插件这一层负责的是“由谁进入实施阶段”
2. 主会话内部的 `coder/子代理` 只是“主会话已经接手后，内部如何组织编码”的实现策略
3. 当前 skill 与返回契约虽然定义了 `main/acp` 二选一，但没有再加一条更硬的约束，禁止主会话把内部派工策略暴露成插件业务选项
4. 仓库协作规则中又强调“开发任务优先安排 coder 子代理写代码”，于是主会话容易在业务分流节点提前暴露内部策略

### 4.3 为什么现有测试没有发现

现有测试覆盖了：

1. 实施入口会进入 `NEEDS_IMPLEMENTATION_EXECUTOR`
2. 状态机只接受 `implementation_executor=main|acp`
3. 选择 `main` 后进入 `TRANSFERRED_TO_MAIN`
4. 选择 `acp` 后才进入 ACP 实施闭环

但没有覆盖：

1. 面向用户的业务选项标签不得出现 `coder`、`子代理`、`opencode`、`模型选择`
2. 主会话在该节点必须原样遵循插件的 `main/acp` 业务边界，不能替换成内部实现语言
3. 用户未明确选择 ACP 前，不得出现 ACP 后续动作的用户可见提示

### 4.4 证据链

1. 插件首次返回实施执行方选择时，只返回 `主会话继续实施 / ACP 委派实施`：
   - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:2656)
2. 选择 `main` 后，插件立即转 `TRANSFERRED_TO_MAIN`：
   - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:1588)
3. 转主会话后的正式业务语义是“插件闭环结束，由主会话负责后续工作”：
   - [src/session/bridge-service.ts](/var/work/acp_codex2opencode/src/session/bridge-service.ts:4749)
4. skill 的正式规则同样只允许 `主会话继续实施 / ACP 委派实施`：
   - [skills/team-delegate/SKILL.md](/var/work/acp_codex2opencode/skills/team-delegate/SKILL.md:160)
5. 现有单元测试也只验证 `main/acp` 两条路径，没有任何测试要求“不得向用户暴露 coder/子代理”：
   - [tests/unit/bridge-service-workflow.test.ts](/var/work/acp_codex2opencode/tests/unit/bridge-service-workflow.test.ts:815)

## 5. 修复目标与非目标

### 5.1 修复目标

- 实施入口对用户只暴露 `主会话继续实施 / ACP 委派实施`
- 主会话在 `NEEDS_IMPLEMENTATION_EXECUTOR` 节点不得把 `coder/子代理` 改写成插件业务选项
- 用户未明确选择 ACP 前，不得出现 ACP 模型选择、`opencode models` 或 ACP 运行态的用户可见提示
- 选择 `main` 后，插件闭环结束与“主会话内部是否再派 coder”之间的边界必须被明确写死
- 自动化测试和真实 Codex CLI 交付测试必须锁住这条边界，避免回归

### 5.2 非目标

- 不修改 `implementation_executor_select` 的参数协议
- 不新增新的工作流状态
- 不重构 ACP 实施、持续跟进、交付测试和整改闭环
- 不在本次修复中改变主会话接手后是否可以使用 coder 子代理的内部实现自由度

## 6. 修复设计

### 6.1 规则层修复

在 `skills/team-delegate/SKILL.md` 的 `NEEDS_IMPLEMENTATION_EXECUTOR` 规则段补一条明确边界：

1. 该节点面向用户只能使用插件定义的业务选项
2. 禁止把 `coder`、`子代理`、`直接改代码`、`opencode`、`模型选择` 等内部实现语言暴露成此节点的用户选项
3. 如果用户选择 `main`，只允许表达“插件闭环结束，后续由主会话负责”
4. 主会话内部是否再派 coder，只能发生在插件闭环结束之后，且不属于插件业务流程

### 6.2 返回契约修复

在桥接服务的 `NEEDS_IMPLEMENTATION_EXECUTOR` 返回结构中增加更强的边界提示，避免主会话误改写：

1. 保留现有 `user_message`、`next_business_action`、`user_options`
2. 新增明确的业务边界字段，例如：
   - 当前是“实施执行方选择”，不是“主会话内部派工选择”
   - 未选择 ACP 前，不得进入 ACP 模型确认或模型选择
   - `main` 表示“转主会话并结束插件闭环”，不是“立即决定主会话内部用谁写代码”
3. 如果恢复态 `status` 分支也展示该节点，保持同一套边界字段与文案一致

### 6.3 用户可见行为修复

修复后，用户在实施入口应只看到这类语义：

1. `1` 主会话继续实施
2. `2` ACP 委派实施

禁止再出现这类错层语义：

1. `1` 我主会话直接改
2. `2` 交给 coder 子代理实施
3. 任何把 `coder/子代理` 与 `ACP` 混成同一层级的表述

### 6.4 测试修复

补四层护栏：

1. 单元测试：实施入口返回必须只包含 `main/acp` 业务语义，并带“主会话内部派工不属于此节点”的边界提示
2. skill 文本测试：`NEEDS_IMPLEMENTATION_EXECUTOR` 必须明确禁止暴露 `coder/子代理`
3. 安装产物测试：打包后的 skill 仍保留这条边界约束
4. 真实交付测试：从 Codex CLI 真实入口进入实施阶段时，用户首屏只能看到 `主会话继续实施 / ACP 委派实施`

### 6.5 回退方案

如果本次修复引发其他节点文案断言失败，回退范围只限于：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 的 skill 规则段
2. 桥接服务在该节点的边界提示字段与文案
3. 新增的测试断言

不回退现有状态机迁移逻辑。

## 7. 修改范围

- `skills/team-delegate/SKILL.md`：补实施入口“不得暴露 coder/子代理”的硬约束
- `src/session/bridge-service.ts`：补实施入口结构化边界字段与一致化文案
- `tests/unit/bridge-service-workflow.test.ts`：补 `main/acp` 业务边界与禁止暴露 `coder/子代理` 的断言
- `tests/delivery/team-delegate-skill.delivery.test.ts`：补 skill 文本边界断言
- `tests/plugin/install.plugin.test.ts`：补安装产物 skill 边界断言
- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md`：本次设计文档
- `docs/superpowers/plans/2026-05-23-impl-executor-boundary-bugfix-20260523-plan.md`：后续实施计划文档

## 8. 自动化验证目标

- 先补红灯测试，证明当前自动化护栏没有覆盖“禁止暴露 coder/子代理”的缺口
- 修复后目标测试通过：
  1. `tests/unit/bridge-service-workflow.test.ts`
  2. `tests/delivery/team-delegate-skill.delivery.test.ts`
  3. `tests/plugin/install.plugin.test.ts`
- 旧测试必须保持通过：
  1. 实施执行方选择的现有状态机测试
  2. ACP 实施链路相关测试
  3. 插件打包与安装产物测试
- 构建与打包检查仍需通过：
  1. `npm test`
  2. `npm run build`
  3. `npm run prepare:plugin`

## 9. 交付测试目标

- 真实入口：安装当前插件，重启或刷新 Codex 环境，从真实 Codex CLI 发起团队委派
- 真实业务语言：使用类似“帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。”
- 原始失败链路复测：
  1. 进入实施阶段
  2. 观察首屏业务选择
  3. 验证首屏只能看到 `主会话继续实施 / ACP 委派实施`
  4. 验证在未选择 ACP 前，不出现 `coder`、`子代理`、`模型选择`、`opencode models`
- 通过标准：
  1. 用户首屏只能看到插件定义的两项业务分流
  2. 选择 `主会话继续实施` 后，插件闭环结束，不再继续 ACP 提示
  3. 选择 `ACP 委派实施` 后，才继续进入 ACP 模型确认与实施闭环
- 如果复测失败：
  1. 记录失败截图、失败回复和实际链路
  2. 主会话补充整改方案与整改计划
  3. 修复后重新执行同一条真实业务链路

## 10. 风险与回退

- 风险：
  1. 只改 skill 文案但不补结构化边界字段时，主会话仍可能在别处继续改写
  2. 只改返回字段但不补交付测试时，真实宿主行为仍可能回归
  3. 如果主会话的通用协作规则优先级高于插件边界提示，需要通过更强的 skill 约束与真实测试共同兜住
- 回退路径：
  1. 先回退新增边界字段与对应断言
  2. 保留现有 `main/acp` 状态机
  3. 重新评估是否需要把修复范围升级到“主会话通用规则层”

## 11. 上下文恢复说明

- 当前已确认：插件状态机本身没有把 `coder/子代理` 作为业务选项，错位发生在主会话转述层
- 当前设计结论：修复应聚焦“业务分流语义与主会话内部派工语义”的边界加固
- 下一步：基于本设计文档编写实施计划文档，拆出规则层、返回契约层、测试层和真实交付测试层任务
