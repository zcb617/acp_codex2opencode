# model_confirm 阶段 Invalid params BUG 修改设计文档

## 1. 问题摘要

团队委派插件在用户确认执行模型后，本应继续进入方案制定、计划制定或计划实施，但当前在 `model_confirm` / `model_select` 后直接失败，用户只能看到 `Invalid params`，无法继续推进任务。

这个问题影响的不是模型选择文案，而是“确认模型后能否真正启动 ACP 执行”这条核心业务链路。第一次修复确认了 `mode` 不是当前插件架构下的必需前置；继续复测后又确认，`delegate.task.execute` 的外层参数契约仍把 `requirement_text` 当成全动作必填，和后续动作依赖缓存恢复原始上下文的设计不一致。修复后，用户在模型确认后必须能够继续进入对应业务阶段，而不是被内部 `mode` 切换或旧契约拦截。

## 2. 失败事实

- 真实入口：
  - Codex CLI 自然语言团队委派入口。
  - 本机直接调用 `BridgeService.executeTask()` 连接真实 `opencode acp`。
- 用户输入：
  - “现在还没有方案，请直接进入方案制定，并让 ACP 负责方案制定。如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。”
- 实际表现：
  - `action=start` 返回 `NEEDS_MODEL_CONFIRM`。
  - `action=model_confirm` 返回 `PROMPT_EXEC_FAILED: Invalid params`。
  - 改走 `action=model_select` + `selected_model` 也返回同样错误。
- 预期表现：
  - 用户确认或显式选择模型后，流程应继续进入 ACP 方案制定、计划制定或实施阶段。
- 失败时间：
  - 2026-05-20，本机 `opencode 1.15.5` 环境。
- 关键证据：
  - `runtime/doc-gate-guidance-live-20260520/design-review-current-codex-exec.jsonl`
  - `runtime/model-confirm-no-mode-live-20260520/planning-confirm-codex-exec.jsonl`
  - 真实复现结果：
    - `setConfig(model)` 成功；
    - `setConfig(mode, "plan")` 失败并返回 `Invalid params`；
    - 跳过 `mode` 设置后，`runTurn("请回复一句测试文本。")` 可成功返回；
    - 继续复测 `planning` 链路时，`action=model_confirm` 在未重复提交 `requirement_text` 的情况下被 MCP 工具入参校验拒绝。

## 3. 影响范围

### 3.1 受影响功能

- 任何需要先经过模型确认再进入 ACP 执行的业务链路：
  - ACP 执行方案制定
  - ACP 执行计划制定
  - ACP 执行实施阶段
- `model_confirm`
- `model_select`

### 3.2 受影响用户动作

- 用户选择“继续使用历史模型”
- 用户选择“重新选择模型”
- 主会话在进入实施前要求 ACP 执行时的模型确认闭环

### 3.3 不受影响范围

- `start` 阶段的开发类型判定和起始阶段判定
- 历史模型检测与可用模型列表展示
- `session/set_config_option(model)` 的模型切换
- 不需要 ACP 执行的主会话方案/计划编写路径

### 3.4 不修复的交付风险

- 用户即使完成模型选择，也无法真正启动 ACP 执行。
- 团队委派流程在真实业务入口下停留在“模型确认”表面成功、实际无法推进的状态。
- 任何依赖 ACP 执行的设计、计划、实施链路都不具备可交付性。

## 4. 根因分析

### 4.1 直接原因

插件在模型确认后会调用 `session/set_config_option(mode, <value>)` 试图切换 ACP 会话模式。当前代码写死使用 `plan` 和 `build` 作为 mode 值，但当前安装插件后的真实 OpenCode 环境并不接受这两个旧值，因此 `mode=plan` / `mode=build` 被真实 ACP 视为非法值，并返回 `Invalid params`。

继续去掉 `mode` 后的真实复测又暴露出第二个直接原因：外层 `delegate.task.execute` schema 仍把 `requirement_text` 设为全动作必填，而 `model_confirm/model_select` 这类后续动作本质上是在继续已有任务，真实主会话可能只表达“继续使用历史模型”，不会重复提交整段任务正文，于是请求会在进入 `BridgeService` 之前就被工具层拦截。

### 4.2 深层原因

- 当前插件架构下，阶段边界真正由团队委派 workflow 状态机和审核门禁控制，而不是由 OpenCode 的 `mode` 强制控制。
- 主流程把 `mode` 当成启动前置条件，导致一个非必需配置项反而变成了业务阻断点。
- 后续动作已经引入“缓存并恢复 start 原始上下文”的能力，用于断开后继续推进任务；但工具契约层没有同步收敛，仍要求每次后续动作都重新提交 `requirement_text`。
- 单元测试只验证了 workflow 状态推进，没有验证“无 `mode` 时是否仍会停在方案确认 / 计划确认”，也没有验证“model_confirm 不重复带 `requirement_text` 时仍能从缓存恢复”。

### 4.3 为什么现有测试没有发现

- 单元测试默认假设 `setWorkflowAgentMode("plan"|"build")` 总是可用。
- 真实交付测试此前没有把“去掉 `mode` 后方案/计划是否会自动进入实施”固定为回归点。

### 4.4 证据链

1. 真实 `codex exec` 链路中，`start` 成功、`model_confirm` 和 `model_select` 同时失败，说明问题发生在“模型闸门通过后”的内部执行链路。
2. 去掉 `mode` 后，`model_select` 可以继续进入 ACP 方案运行态，证明第一层阻断已经解除。
3. 真实 `planning` 复测里，`model_confirm` 在未重复提交 `requirement_text` 时被 MCP 工具层直接拒绝，说明第二层阻断发生在“进入业务逻辑之前”的外层契约校验。
4. 使用真实 `BridgeService` + 真实 `opencode acp` 重放时：
   - `initSession` 成功；
   - `setConfig(model)` 成功；
   - `setConfig(mode, "plan")` 失败并返回 `Invalid params`；
   - 不设置 `mode` 时，`runTurn()` 可以成功完成。
5. 在临时真实验证中，仅 monkey patch 掉 `setWorkflowAgentMode` 后：
   - 方案链路最终停在 `WAITING_DESIGN_APPROVAL`；
   - 计划链路最终停在 `WAITING_PLAN_APPROVAL`；
   - 没有自动进入实施。

## 5. 修复目标与非目标

### 5.1 修复目标

- 在模型确认或显式选模后，团队委派流程能够继续进入 ACP 执行阶段。
- 从 workflow 主流程移除 `mode` 强制传递，不再让其作为启动前置。
- 让 `requirement_text` 只在 `start` 创建任务时强制要求；后续动作优先从缓存恢复原始任务正文。
- 保持现有方案确认 / 计划确认 / 交付测试门禁不变。
- 自动化测试要覆盖“无 `mode` 时仍停在方案确认 / 计划确认”和“model_confirm 不重复带 `requirement_text` 仍可继续”的业务约束。
- 真实 Codex CLI 交付测试要覆盖 `start -> model_confirm -> ACP 继续执行` 同一条失败链路。

### 5.2 非目标

- 不修改模型选择业务文案。
- 不重新设计 `start`、`model_confirm`、`model_select` 的业务语义。
- 不重构整个 ACP 客户端协议层。
- 不重新设计 workflow 阶段语义。

## 6. 修复设计

### 6.1 状态机变化

- 保持现有业务状态机不变。
- 修复点只放在“模型确认后创建/恢复 workflow 并启动 ACP 执行”这一内部步骤。

### 6.2 主流程执行策略

- 保留：
  - session 创建 / 恢复
  - model 设置
  - prompt 执行
- 保留并启用：
  - `start` 时缓存原始 `requirement_text`
  - `model_confirm/model_select` 时优先从缓存恢复原始任务正文
- 移除：
  - 方案 / 计划阶段前的 `setWorkflowAgentMode(workflow, "plan", true)`
  - 实施 / 整改实施阶段前的 `setWorkflowAgentMode(workflow, "build", true)`
- 调整：
  - `delegate.task.execute` 外层 schema 改为仅 `start` 强制要求 `requirement_text`
  - 若后续动作既没传 `requirement_text`、又无法恢复到缓存上下文，则明确报“缺少原始任务正文，需要重新 start 或补充正文”
- `activeAgentMode` 保持兼容读取，但新流程不再依赖它驱动阶段切换。

### 6.3 用户可见行为变化

- 用户侧不再看到模型确认后立即失败。
- 用户在模型确认后会继续看到对应业务阶段的推进结果或等待状态。
- 方案完成后仍停在方案确认，计划完成后仍停在计划确认，不会因为移除 `mode` 而自动实施。

### 6.4 数据结构与持久化变化

- 不新增字段。
- 允许旧 snapshot 中已有的 `activeAgentMode` 继续被读取。
- 新 workflow 默认可以没有 `activeAgentMode`。
- `pending start input` 继续承担原始任务正文的恢复职责。

### 6.5 错误处理变化

- `mode` 不再作为主流程必经步骤，因此不再成为 `model_confirm/model_select` 的失败源。
- 非 `start` 动作若未带 `requirement_text`，将优先走缓存恢复；只有在缓存也缺失时才返回明确的业务错误。
- 若未来仍需兼容特定 mode，只能作为可选增强，不能再次阻断主流程。

### 6.6 回退方案

- 若本次修复引出新的阶段控制问题，可回退到当前提交前版本。
- 若未来确有业务需要重新引入 mode，必须先证明：
  - mode 是真实必需条件；
  - 无 mode 会破坏方案确认 / 计划确认门禁；
  - 真实环境的 mode 契约稳定可依赖。

## 7. 修改范围

- `src/session/bridge-service.ts`：移除 workflow 主流程中的 `mode` 强制设置，并把后续动作的正文恢复做成硬兜底。
- `src/mcp-tools/schemas.ts`：把 `requirement_text` 改成仅 `start` 必填。
- `src/plugin/mcp-server.ts`：让 MCP 对外 `inputSchema` 与统一 `ExecuteTaskSchema` 保持一致。
- `tests/unit/bridge-service-workflow.test.ts`：更新 workflow 断言，并覆盖 `model_confirm` 无正文时的缓存恢复。
- `tests/integration/delegate-tools.integration.test.ts` / `tests/delivery/delegate-loop.delivery.test.ts`：补契约回归。
- `docs/superpowers/specs/2026-05-20-model-confirm-invalid-params-design.md`：本设计文档。
- `docs/superpowers/plans/2026-05-20-model-confirm-invalid-params-plan.md`：实施计划文档。

## 8. 自动化验证目标

- 修复后要证明：
  - 方案链路在无 `mode` 情况下仍进入 `WAITING_DESIGN_APPROVAL`；
  - 实施前链路在无 `mode` 情况下仍进入 `WAITING_PLAN_APPROVAL` / `RUNNING_IMPLEMENTATION` 的既有状态流转；
  - `model_confirm` / `model_select` 不再因 `mode` 报 `Invalid params`；
  - `model_confirm` 在不重复带 `requirement_text` 时仍可继续推进。
- 相关模块测试需覆盖 workflow 创建、状态推进和门禁等待。
- 全量测试、构建和本地安装检查仍需通过。

## 9. 交付测试目标

- 真实入口：
  - 安装当前插件；
  - 刷新 Codex 环境；
  - 通过 Codex CLI 使用真实业务语言发起团队委派。
- 真实业务语言：
  - “帮我用团队委派流程完成这个插件的一个 BUG 修复。现在还没有方案，请直接进入方案制定，并让 ACP 负责方案制定。如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。”
- 同链路复测方式：
  - 先触发 `start -> NEEDS_MODEL_CONFIRM`；
  - 再让主会话走默认“继续使用历史模型”；
  - 验证流程不再停在 `Invalid params` 或 “缺少 requirement_text” 的旧契约拦截，而是继续进入 ACP 执行；
  - 继续观察方案链路是否停在方案确认、计划链路是否停在计划确认；
  - 另测 `model_select` 显式选模分支同样通过。
- 通过标准：
  - `model_confirm` 和 `model_select` 都不再返回 `PROMPT_EXEC_FAILED: Invalid params`；
  - 方案链路停在 `WAITING_DESIGN_APPROVAL`；
  - 计划链路停在 `WAITING_PLAN_APPROVAL`；
  - `docs/团队委派交付测试必过表.md` 中要求的测试项仍全部通过。
- 失败后继续整改闭环：
  - 记录新的失败事实；
  - 判断是模型选择链路、阶段门禁还是其它真实环境变化；
  - 更新设计/计划；
  - 补回归测试；
  - 重新执行自动化验证与同链路交付测试。

## 10. 风险与回退

- 风险：
  - 若某些未来环境确实依赖 mode，移除后可能暴露新的阶段控制差异；
  - 单元测试若只验证状态名，可能仍遗漏真实 CLI 环境中的文案或等待行为。
- 控制措施：
  - 保留真实 CLI 同链路交付测试；
  - 把“方案确认 / 计划确认不自动越级实施”作为固定验收项。
- 回退路径：
  - 回退到当前提交前版本；
  - 或在确认真实必需前，仅把 mode 作为非阻断的可选增强重新引入。

## 11. 上下文恢复说明

- 当前已确认是双层根因：
  1. `session/set_config_option(mode, plan|build)` 会在真实环境中返回 `Invalid params`，而 `mode` 又不是当前插件架构下的主流程必需项；
  2. 去掉 `mode` 后，`delegate.task.execute` 外层 schema 仍把 `requirement_text` 设为全动作必填，和缓存恢复原始上下文的设计不一致。
- 当前分支：`codex/document-gate-guidance`
- 下一步：
  1. 更新计划文档；
  2. 收敛 `requirement_text` 契约：`start` 必填，后续动作靠缓存恢复；
  3. 跑自动化测试；
  4. 做真实 Codex CLI 同链路复测，确认模型确认后能继续推进，且方案/计划仍停在各自审核门禁。
