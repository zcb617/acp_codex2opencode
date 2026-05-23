# 团队委派空参数调用触发前置拦截 BUG 修复设计

## 1. 问题摘要

- Bug 名称：团队委派入口出现空参数调用，流程在插件接管前被参数校验或风控拦截
- 影响对象：通过 Codex CLI 用自然语言触发团队委派流程的最终用户
- 影响业务链路：自然语言需求 -> 主会话判定阶段与开发类型 -> 调用高层入口 -> 插件状态机接管
- 当前失败结果：主会话通过真实宿主看到的 `delegate.task.execute` 工具签名退化成空参数对象，首次调用经常以 `arguments={}` 发出，在插件正式业务编排前即失败，用户看到“参数缺失/风险拒绝”
- 修复后业务结果：宿主看到的高层入口参数签名与真实执行校验重新对齐；主会话不会再被空参数签名误导；当信息不足时先返回业务化补充指引；满足条件后稳定进入插件闭环

## 2. 失败事实

- 触发入口：Codex CLI 自然语言触发团队委派
- 实际表现：日志记录到 `delegate.task.execute` 首次以空参数调用，随后返回 `workspace_path Required`；同一轮在补齐显式参数后再次调用可以成功进入后续阶段
- 预期表现：入口调用必须携带完整最小上下文，至少应包含工作目录和动作对应的必要字段；不能出现空调用
- 失败证据：
  - `runtime/doc-gate-guidance-live-20260520/design-review-current-codex-exec.jsonl` 第 18-21 行出现两次 `arguments:{}` 调用并失败
  - `runtime/model-confirm-no-mode-live-20260520/planning-confirm-after-requirement-fix-codex-exec.jsonl` 第 18-21 行出现空调用并失败
- 失败阶段定位：发生在宿主消费 MCP 工具签名并首次发起调用时，不是插件内部状态流转失败

## 3. 影响范围

- 受影响功能：团队委派高层入口的首次调用和继续调用前置编排
- 受影响用户动作：用户发起“直接进入 BUG 修复实施/继续任务”等自然语言需求
- 受影响状态：入口阶段无法稳定进入 `start/status/model_confirm` 等业务动作
- 不受影响范围：插件内部已有的方案/计划/实施/交付测试状态机逻辑
- 不修复风险：
  - 用户持续看到前置失败，误判为插件编排不可用
  - 业务流程在“未接管”阶段反复中断
  - 同类问题难以在回归测试中提前发现

## 4. 根因分析

### 4.1 直接原因

- `delegate.task.execute` 当前对外注册时直接暴露了带 `.superRefine(...)` 的复杂 schema。
- MCP SDK 在“列工具生成 `inputSchema`”这条路径里无法把这类复杂 schema 识别成纯对象结构，于是把该工具的 `inputSchema` 降级为 `{}`。
- 结果是宿主侧看到的是“像无参工具”的签名，首次调用容易发出 `arguments={}`；但工具真正执行时仍按原始 schema 做校验，于是立即报缺少 `workspace_path`、`requirement_text` 等必填参数。

### 4.2 深层原因

- 目前同一份 `ExecuteTaskSchema` 同时承担了两种职责：
  1. 向宿主暴露工具参数契约
  2. 在运行时做动作级校验
- 这两种职责要求的 schema 形式并不相同：前者需要稳定的纯对象结构，后者允许叠加动作级约束。
- 现有实现没有把“公开参数契约”和“运行时校验”分层，导致宿主展示层和工具执行层对同一份 schema 产生了不同解释。

### 4.3 为什么现有测试没有发现

- 现有测试只验证了工具是否注册、技能文本是否包含预检与硬门禁规则，但没有验证真实 `listTools` 暴露出来的 `delegate.task.execute.inputSchema` 仍包含 `workspace_path`、`action` 等字段。
- 没有覆盖“宿主展示层 schema 不应退化成空对象”这类 MCP 契约级回归测试。

### 4.4 证据链

- `src/mcp-tools/schemas.ts` 已定义 `workspace_path` 为必填，且 `start` 还要求 `requirement_text`，说明首次空调用必然失败。
- `src/plugin/mcp-server.ts` 当前直接以 `ExecuteTaskSchema` 注册 `delegate.task.execute`，没有区分公开 schema 与运行时 schema。
- MCP SDK 的 `normalizeObjectSchema()` 只会稳定导出纯对象 schema；无法对象化时，`listTools` 会把 `inputSchema` 退化为 `{}`。
- 真实交付日志显示：`delegate.task.preflight` 成功后，第一次 `delegate.task.execute` 失败；补齐显式参数后第二次调用成功，说明问题不在状态机，而在首次工具签名暴露与调用构造层。

## 5. 修复目标与非目标

### 5.1 修复目标

1. 将 `delegate.task.execute` 的公开参数契约与运行时动作级校验分层，确保宿主看到的工具签名不再退化成空对象。
2. 保持现有 `preflight -> start` 业务闭环不回退，继续用预检结果驱动首次正式入场。
3. 保持运行时动作级校验强度不下降，不能为了修复签名暴露而放松 `start`、`model_confirm`、`implementation_executor_select` 等动作校验。
4. 增加 MCP 契约级回归测试，持续防止 `delegate.task.execute.inputSchema` 再次退化为空对象。

### 5.2 非目标

1. 不重构插件核心状态机阶段枚举。
2. 不改动实施阶段持续跟进策略。
3. 不新增低层 `delegate.session.*` / `delegate.turn.*` 用户入口。
4. 不推翻已引入的 `delegate.task.preflight` 业务入口。

## 6. 修复设计

### 6.1 公开 schema 与运行时校验分层

在同一个 schema 模块内拆成三层：

1. `ExecuteTaskShape`
   - 只维护字段集合
   - 不附带动作级约束
2. `ExecuteTaskPublicSchema`
   - 由 `z.object(ExecuteTaskShape)` 直接构造
   - 专门用于 MCP 对外注册，让宿主稳定拿到纯对象 `inputSchema`
3. `parseExecuteTaskInput()` / `ExecuteTaskRuntimeSchema`
   - 基于公开 schema 再叠加动作级校验
   - 专门用于工具真正执行前的运行时校验

这样可以保证：

- 宿主展示层只消费纯对象 schema
- 工具执行层继续保留复杂动作校验
- 字段定义仍然只维护一处，不会因为拆文件而漂移

### 6.2 保留 preflight 业务闭环，不回退首次入场硬门禁

主会话仍然固定两步：

1. 先调用 `delegate.task.preflight`
2. 仅当 `preflight` 返回可进入时，才调用 `delegate.task.execute(action=start)`

本次修复不改变这条业务闭环，而是修复 `delegate.task.execute` 被宿主错误暴露成空参数工具的问题。

### 6.3 运行时动作校验下沉到独立解析逻辑

把当前 `.superRefine(...)` 中的动作约束改造成独立运行时校验逻辑，例如：

- `start` 必须提供 `requirement_text`
- 非 `start` 必须提供 `session_alias` 或 `task_id`
- `model_confirm` 必须提供 `model_confirm_choice`
- `model_select` 必须提供 `selected_model`
- `implementation_executor_select` 必须提供 `implementation_executor`

要求：

- 对外公开 schema 不承担动作级约束
- 运行时校验强度与现状保持一致或更严格
- 错误提示继续保留现有业务语义

### 6.4 MCP 契约级测试护栏

新增两类测试：

1. MCP 工具暴露测试
   - 启动真实 MCP server
   - 调 `listTools`
   - 断言 `delegate.task.execute.inputSchema` 仍包含 `workspace_path`、`action`、`requirement_text`、`session_alias`、`task_id`
2. 运行时校验回归测试
   - 断言 `start` 仍会拦截缺少 `requirement_text`
   - 断言非 `start` 仍会拦截缺少 `session_alias/task_id`
   - 断言 `implementation_executor_select`、`model_confirm` 等动作校验不回退

## 7. 修改范围

- `src/mcp-tools/schemas.ts`：把 `delegate.task.execute` 拆成字段 shape、公开 schema、运行时解析层
- `src/mcp-tools/delegate-tools.ts`：`executeTask` 改为显式走运行时解析
- `src/plugin/mcp-server.ts`：`delegate.task.execute` 改为注册公开 schema
- `tests/plugin/lifecycle.plugin.test.ts`：从“仅工具名存在”升级为“工具暴露 schema 仍有完整字段”
- `tests/unit/*`：补运行时动作校验不回退的断言
- 视测试实现需要，增加一份 MCP 契约级测试文件

## 8. 自动化验证目标

1. 红灯：先证明当前 `delegate.task.execute` 暴露到 `listTools` 的 schema 可能退化为空对象，且测试能捕获。
2. 绿灯：修复后宿主可见 schema 恢复完整字段，且运行时动作校验仍然生效。
3. 回归：已存在的 `preflight`、状态机与交付测试关键断言不回退。

## 9. 交付测试目标

### 9.1 真实入口

1. 安装插件并刷新 Codex 环境
2. 打开 Codex CLI
3. 用自然语言发起 BUG 修复实施委派

### 9.2 同链路复测

- 用户表达：

```text
我已经确认这是 Windows 托盘更新链路问题，按 BUG 修复实施流程继续团队委派。
```

- 验收标准：
  1. 首轮不会再触发“看起来像空参工具”的错误调用
  2. 若信息不足，会先进入业务化补充提示
  3. 信息齐全后能稳定进入指定业务阶段

### 9.3 必过项

- 必须再次通过 `docs/团队委派交付测试必过表.md` 全部测试项

## 10. 风险与回退

- 风险：
  1. 公开 schema 与运行时校验拆分后，字段集合可能出现维护漂移
  2. 修复宿主可见 schema 时，若处理不当可能放松既有动作级校验
- 控制：
  1. 只在同一个 schema 模块内维护字段 shape，避免跨文件漂移
  2. 用 MCP 契约测试和运行时校验测试同时卡住“展示层”和“执行层”
- 回退：
  1. 若新分层影响范围超预期，可回退 `delegate.task.execute` 的 schema 分层实现，但保留新增测试，避免再次漏检

## 11. 上下文恢复说明

- 当前问题定位：发生在宿主消费 MCP 工具签名并构造首次调用的阶段，根因是复杂 schema 对外暴露退化
- 下一步实施顺序：
  1. 先把 `delegate.task.execute` 的公开 schema 与运行时校验分层
  2. 再补 `listTools` / 运行时双层测试
  3. 最后执行自动化验证与真实交付链路验证
