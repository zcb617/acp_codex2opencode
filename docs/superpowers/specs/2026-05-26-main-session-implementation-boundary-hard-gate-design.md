# 主会话越权替用户选择 ACP 的实施入口硬闸门 BUG 修复设计

## 1. 问题摘要

- Bug 名称：主会话越权替用户选择 ACP 的实施入口硬闸门缺失
- 影响对象：通过 Codex CLI 真实入口使用团队委派流程、并已完成方案和计划确认的最终用户
- 影响业务链路：
  1. 用户从真实入口进入团队委派流程
  2. 方案和计划已经确认
  3. 流程进入“实施执行方选择”
  4. 用户本应在“主会话继续实施 / ACP 委派实施”之间二选一
  5. 主会话却在用户未回复 `1/2` 的情况下，直接替用户提交 `implementation_executor_select(acp)`
- 当前失败结果：
  1. 用户没有真正完成“由谁进入实施阶段”的业务决策
  2. 主会话把内部“优先派 coder”策略提前套进插件业务分流节点
  3. 用户表面看到的是 `coder` / “委派实施”，底层实际执行的是 ACP 路径
  4. 后续直接进入模型确认与 ACP 实施闭环，破坏了实施责任归属的用户确认
- 修复完成后应恢复的业务结果：
  1. 实施入口必须停住，直到用户明确回复 `1` 或 `2`
  2. 该节点对用户只暴露“主会话继续实施 / ACP 委派实施”
  3. 只有用户明确选择 ACP 后，才允许继续模型确认与 ACP 实施闭环
  4. 用户明确选择主会话后，插件闭环结束；主会话内部是否再派 coder，属于插件闭环结束后的内部策略

## 2. 失败事实

- 触发入口：
  - Codex CLI 真实自然语言入口
  - 真实回放文件：`/home/zhangcb/.codex/sessions/2026/05/26/rollout-2026-05-26T19-19-08-019e6402-8b56-7821-9742-782991583cfb.jsonl`
- 用户输入：
  - 真实业务任务：修复 `/var/work/voice-input` 中 Linux 翻译内容读取不到选中文字的问题
  - 业务阶段已被主会话判定为“方案和计划都已具备，直接进入实施”
- 实际表现：
  1. 插件在 `start` 后先正确返回 `NEEDS_IMPLEMENTATION_EXECUTOR`
  2. 返回里已经明确要求用户“请直接回复 `1` 或 `2`”
  3. 用户尚未回复 `1/2`
  4. 主会话却输出“按项目规则，这一步实施执行方我直接走委派 coder，不走主会话自己写”
  5. 随后主会话直接调用 `implementation_executor_select(acp)`，把流程推进到 `NEEDS_MODEL_CONFIRM`
- 预期表现：
  1. 插件返回“实施执行方选择”后，主会话必须停住等待用户明确回复 `1` 或 `2`
  2. 在用户未明确选择前，主会话不得替用户调用 `implementation_executor_select(main|acp)`
  3. 主会话更不得把 `coder/子代理` 当成该节点的对外业务选项
- 失败时间或场景：
  - 2026-05-26 11:35 左右的真实委派实施入口链路
- 是否可复现：
  - 已有真实回放证据，可稳定复现并可稳定定位责任边界
- 证据：
  1. 真实会话回放中，`start` 的返回已经是“实施执行方选择”，并要求“请直接回复 `1` 或 `2`”
  2. 同一回放中，主会话在用户未选择的情况下，直接表达“走委派 coder”，随后提交 `implementation_executor_select(acp)`
  3. 当前仓库代码与当前已安装 skill 都已经把该节点定义成“主会话继续实施 / ACP 委派实施”二选一
  4. 当前问题不是缓存未刷新，也不是插件状态机缺少该节点，而是主会话编排层越权推进

## 3. 影响范围

- 受影响功能：
  - 团队委派流程中的“实施执行方选择”节点
  - 主会话读取插件返回后，对该节点的业务转述与推进逻辑
- 受影响用户动作：
  1. 用户完成方案与计划确认后进入实施
  2. 用户本应选择“主会话 / ACP”
  3. 主会话却把内部实现策略混入该节点，并提前推进
- 受影响状态或数据：
  1. `NEEDS_IMPLEMENTATION_EXECUTOR` 节点的用户确认被跳过
  2. `implementation_executor_select` 在无用户选择时被提前调用
  3. 用户可见业务选项与真实执行路径发生错层
- 不受影响范围：
  1. `implementation_executor_select` 的参数契约本身没有问题，仍只接受 `main` 或 `acp`
  2. 选择 `main` 后转 `TRANSFERRED_TO_MAIN`、选择 `acp` 后进入模型确认/ACP 实施闭环的状态机迁移本身没有问题
  3. 设计阶段和计划阶段的主会话/ACP 分流不属于本次根因
  4. 插件缓存刷新问题不属于本次根因
- 如果不修复会造成什么交付风险：
  1. 真实用户会被主会话替做关键业务决策
  2. 实施责任归属无法保证由用户确认
  3. “主会话内部派工”和“插件业务分流”会继续混层
  4. 以后即使插件节点返回正确，主会话仍可能继续越权代选

## 4. 根因分析

### 4.1 直接原因

主会话编排层在收到 `NEEDS_IMPLEMENTATION_EXECUTOR` 后，没有把该节点当成必须等待用户输入的硬闸门，而是继续套用了仓库侧“开发任务优先安排 coder”这类内部实施策略。

于是出现了两层语义混层：

1. 插件这一层负责的是“由谁进入实施阶段”
2. 主会话内部这一层负责的是“主会话已经接手后，是否再派 coder”

当前主会话把第二层提前套进第一层，直接替用户做了 ACP 选择。

### 4.2 深层原因

当前仓库已经把“实施执行方选择”写进了插件返回和 skill 规则，但还缺一层更硬的“宿主编排禁行规则”：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 目前对插件状态机是业务节点，对主会话更多还是文案约束
2. 没有额外机制显式约束“用户未回复前，不得调用 `implementation_executor_select`”
3. 没有额外机制显式区分“插件业务分流”和“主会话内部派工”
4. 当主会话同时受仓库协作规则影响时，容易优先执行“内部派工偏好”，压过插件业务节点

### 4.3 为什么现有测试没有发现

现有测试已经覆盖：

1. 插件会返回 `NEEDS_IMPLEMENTATION_EXECUTOR`
2. 用户可见业务文案是“主会话继续实施 / ACP 委派实施”
3. `implementation_executor_select(main|acp)` 的状态迁移正确
4. skill 文本里已经写明“禁止暴露 coder/子代理”

但没有覆盖：

1. 主会话在收到 `NEEDS_IMPLEMENTATION_EXECUTOR` 后，必须停住等待用户输入，不能直接继续调用 `implementation_executor_select`
2. 主会话不得把仓库协作规则里的“优先派 coder”提前套进该业务节点
3. 主会话越权推进时，真实宿主链路能否被自动化或真实交付测试捕获

### 4.4 证据链

1. 真实回放中，`delegate.task.execute(action=start)` 的返回已经是 `NEEDS_IMPLEMENTATION_EXECUTOR`
2. 该返回里已有“请直接回复 `1` 或 `2`”和 `implementation_executor_select` 的两项正式业务选项
3. 用户没有回复 `1/2`
4. 主会话却输出“走委派 coder”，随后直接调用 `implementation_executor_select(acp)`
5. 插件后续立即进入 `NEEDS_MODEL_CONFIRM`
6. 因此本次问题的责任不在插件状态机，而在主会话编排层越权代选

## 5. 修复目标与非目标

### 5.1 修复目标

- `NEEDS_IMPLEMENTATION_EXECUTOR` 必须成为对主会话也生效的硬闸门
- 用户未明确回复 `1/2` 前，主会话不得调用 `implementation_executor_select`
- 主会话不得把 `coder/子代理/opencode/模型选择` 等内部实现语言暴露为该节点的用户业务选项
- 用户选择 `main` 后，插件闭环结束；主会话内部是否再派 coder，只能发生在插件闭环结束之后
- 自动化验证和真实交付测试都要锁住这条“主会话不得越权代选”的边界

### 5.2 非目标

- 不修改 `implementation_executor_select` 的参数协议
- 不新增新的 workflow 状态
- 不重构 ACP 实施、持续跟进、交付测试与整改闭环
- 不在本次修复里决定“主会话接手后一定用 coder 还是一定自己改”
- 不处理插件缓存刷新问题

## 6. 修复设计

### 6.1 状态机变化

状态机本身不新增状态，也不改变既有迁移，仍保持：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 等待实施执行方选择
2. 选择 `main` 后转 `TRANSFERRED_TO_MAIN`
3. 选择 `acp` 后进入 `NEEDS_MODEL_CONFIRM / NEEDS_MODEL_SELECTION / RUNNING_IMPLEMENTATION`

本次变化不在状态枚举本身，而在“对主会话的使用约束”：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 不仅是插件状态机节点，还要成为主会话编排层的停步节点
2. 主会话只有在收到用户明确的 `1/2` 后，才允许调用 `implementation_executor_select`

### 6.2 用户可见行为变化

修复后，实施入口的用户可见行为必须固定成：

1. 只看到两项业务选择：
   - `1` 主会话继续实施
   - `2` ACP 委派实施
2. 在用户未明确选择前，主会话只允许：
   - 解释当前处于哪个业务阶段
   - 解释为什么需要做这个业务选择
   - 解释这个选择会怎样影响后续流程
   - 要求用户直接回复 `1` 或 `2`
3. 在用户未明确选择前，主会话不允许：
   - 代替用户提交 `implementation_executor_select`
   - 代替用户选 ACP
   - 代替用户选主会话
   - 暴露 `coder/子代理/opencode/模型选择`

### 6.3 数据结构或接口变化

本次不改变 `implementation_executor_select` 的输入协议，也不新增新的 MCP 动作。

本次数据层变化聚焦两点：

1. 强化 `NEEDS_IMPLEMENTATION_EXECUTOR` 返回的结构化边界提示，让主会话更难误读
2. 在主会话对插件返回结果的编排规则中，新增“宿主禁行规则”测试护栏

### 6.4 错误处理变化

需要增加或强化两类错误场景的保护：

1. 如果主会话在未收到用户明确选择时，仍尝试推进 `implementation_executor_select`，测试必须把这类行为视为违规
2. 如果主会话把 `coder/子代理` 暴露成该节点的用户选项，测试必须视为违规

这类错误不一定体现为插件接口报错，更可能体现为宿主业务行为越权，因此修复重点是“提前阻断”，不是事后容错。

### 6.5 兼容性处理

兼容要求如下：

1. 不破坏现有 `main/acp` 正常分流
2. 不破坏从 `status` 恢复时对该节点的表达
3. 不破坏已经存在的 skill 文本边界
4. 不破坏安装产物中的 skill 规则同步

### 6.6 回退方案

如果本次修复引发其他节点断言失败，回退范围只限于：

1. `NEEDS_IMPLEMENTATION_EXECUTOR` 的新增边界字段或文案
2. 主会话宿主禁行规则对应测试
3. 与本次越权代选直接相关的 skill/文案断言

不回退现有 `main/acp` 状态迁移逻辑。

## 7. 修改范围

- `src/session/bridge-service.ts`：强化实施入口的结构化边界提示
- `skills/team-delegate/SKILL.md`：补“主会话不得越权代选”的宿主级硬约束
- `tests/unit/bridge-service-workflow.test.ts`：补实施入口边界断言
- `tests/delivery/team-delegate-skill.delivery.test.ts`：补 skill 文本对宿主禁行规则的断言
- `tests/plugin/install.plugin.test.ts`：补安装产物断言，确保 skill 规则被打包带出
- `docs/superpowers/specs/2026-05-26-main-session-implementation-boundary-hard-gate-design.md`：本次设计文档
- `docs/superpowers/plans/2026-05-26-main-session-implementation-boundary-hard-gate-plan.md`：本次计划文档

## 8. 自动化验证目标

- 先补红灯测试，证明当前自动化护栏没有覆盖“主会话不得越权代选”
- 修复后目标测试通过：
  1. `tests/unit/bridge-service-workflow.test.ts`
  2. `tests/delivery/team-delegate-skill.delivery.test.ts`
  3. `tests/plugin/install.plugin.test.ts`
- 旧测试必须保持通过：
  1. 实施执行方选择的现有状态机测试
  2. ACP 实施链路测试
  3. 插件安装与准备测试
- 构建与交付物生成仍需通过：
  1. `npm run test`
  2. `npm run build`
  3. `npm run prepare:plugin`

## 9. 交付测试目标

- 真实入口：
  1. 安装当前插件
  2. 刷新或重启 Codex 使用环境
  3. 打开 Codex CLI
  4. 用真实自然语言触发团队委派流程
- 真实业务语言：
  - “帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。”
- 原始失败链路复测：
  1. 进入实施执行方选择
  2. 用户先不回复 `1/2`
  3. 观察主会话是否越权代选
  4. 观察主会话是否暴露 `coder/子代理`
  5. 观察是否在无用户选择时继续进入模型确认或 ACP 实施闭环
- 修复后要重新执行的同一条业务链路：
  1. 用相同真实业务语言进入实施入口
  2. 确认系统停在“实施执行方选择”
  3. 确认系统明确要求用户直接回复 `1` 或 `2`
  4. 在未回复前，系统不得继续推进
  5. 用户回复 `1` 后，插件闭环结束，后续由主会话负责
  6. 用户回复 `2` 后，才继续进入 ACP 模型确认与实施闭环
- 通过标准：
  1. 不再出现“主会话替用户选 ACP”
  2. 不再出现“把 coder/子代理暴露成该节点业务选项”
  3. 未回复 `1/2` 前，不再继续推进
  4. `docs/团队委派交付测试必过表.md` 中相关项同时通过
- 如果复测失败，如何继续整改：
  1. 记录失败截图、失败回复和真实回放
  2. 判断是 skill 规则、bridge-service 返回、安装产物，还是宿主编排仍有漏口
  3. 补红灯测试
  4. 实施整改
  5. 重新执行自动化验证与同一条真实业务链路

### 9.1 本轮真实交付测试新增失败事实

- 失败阶段：
  1. 已完成默认 `codex` CLI 真实入口复测
  2. 已确认“实施执行方选择”业务边界修复生效
  3. 但在进入真实 CLI 复测前，`npm run plugin:install-local` 暴露出新的安装产物漏口
- 失败现象：
  1. 安装脚本输出 `INSTALLATION-COMPLETED`
  2. 但默认 `codex plugin list` 仍显示 `acp-codex2opencode@acp-local not installed`
  3. 直到手动执行 `codex plugin add acp-codex2opencode@acp-local` 后，插件才变为 `installed, enabled`
- 业务影响：
  1. 用户按 runbook 执行 `npm run plugin:install-local` 后，会误以为插件已经安装完成
  2. 真实默认 CLI 入口可能直接报“插件未安装”，导致后续团队委派流程无法按正常入口启动
- 根因判断：
  1. 当前安装脚本只完成 marketplace 注册、配置写入和技能复制
  2. 但没有真正执行 `codex plugin add` 完成本地插件安装
- 本轮追加整改目标：
  1. `npm run plugin:install-local` 必须单独完成“注册 marketplace + 真正安装插件 + 启用配置 + 技能安装”
  2. 安装脚本本身要补安装后校验，确保 `codex plugin list` 结果为 `installed, enabled`
  3. 卸载脚本要与真实安装行为对称，避免旧安装状态残留影响重装复测
