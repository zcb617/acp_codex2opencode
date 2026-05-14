# Codex CLI 恢复后委派流程丢失 BUG 修改设计文档

## 1. 问题摘要

团队委派插件在真实 Codex CLI 入口中可以启动计划实施，也可以在长时间无新进展后要求用户选择继续等待或主会话接手。

但当 Codex CLI 会话结束后再恢复同一会话，并选择继续等待时，插件返回“未找到进行中的委派流程”。这会导致用户已经选择继续等待，却无法沿同一条业务流程继续推进，后续的交付测试失败、整改方案、整改计划、整改实施和复测都无法闭环。

修复后，进行中的业务流程必须能在插件进程重启或 Codex CLI 恢复后被找回。用户选择继续等待时，系统必须恢复到可继续跟进的业务状态，不能丢失任务。

## 2. 失败事实

- 触发入口：本机 Codex CLI 真实入口，使用 `$team-delegate` 自然语言触发插件。
- 用户输入：`我选择 1：继续等待。请继续按团队委派流程跟进当前计划实施；不要主会话接手。`
- 实际表现：恢复后插件返回“未找到进行中的委派流程，请先使用 action=start”，Codex CLI 对用户提示团队委派流程已中断。
- 预期表现：恢复后应继续同一条委派流程；如果仍在实施中，应继续持续跟进；如果实施完成，应进入交付测试；如果交付测试失败，应形成整改方案和整改计划。
- 复现频率：在 `runtime/delivery-closure-forced-20260514-094946` 业务交付测试中稳定复现。
- 证据：
  - 用户可见结果文件：`runtime/delivery-closure-forced-20260514-094946/codex-step1-continue-last-message.md`
  - 插件审计库记录：`task.execute` 在 `continue_wait` 和 `status` 时返回 `WORKFLOW_NOT_FOUND`
  - 数据库中仍存在 ACP 会话与运行中轮次：`delegate_sessions.status = ACTIVE`，`delegate_turns.status = RUNNING`

## 3. 影响范围

- 受影响功能：团队委派流程的长期实施、持续跟进、继续等待、交付测试失败后的整改闭环。
- 受影响用户动作：用户在沉默阈值后选择继续等待。
- 受影响状态或数据：业务流程状态、当前阶段、当前持续跟进计时、当前实施轮次、交付测试门禁。
- 不受影响范围：插件安装、模型选择、单次 CLI 进程内的基础状态推进、自动化单元测试中的内存态流程。
- 交付风险：只要真实业务任务超过一个 CLI 生命周期，就可能丢失流程，用户无法从原业务节点继续推进。

## 4. 根因分析

### 4.1 直接原因

业务流程状态保存在 `BridgeService.workflowByKey` 这个进程内存 Map 中。

`continue_wait`、`status`、`delivery_test_fail` 等动作都会调用 `loadWorkflowState()`，而 `loadWorkflowState()` 只从 `workflowByKey` 读取状态。插件进程重启后，Map 为空，即使 SQLite 中仍有 ACP 会话和轮次记录，也无法恢复业务流程。

### 4.2 深层原因

当前 SQLite 只持久化了 ACP 会话、轮次、事件和审计记录，没有持久化“业务流程状态”。因此插件能看到 ACP 层还有会话和运行中轮次，但无法知道业务层处于计划实施、持续跟进、交付测试还是整改阶段。

### 4.3 现有测试缺口

现有测试都在同一个 `BridgeService` 实例内完成，没有模拟插件进程重启。流程状态一直留在内存中，所以无法暴露恢复后 `workflowByKey` 为空的问题。

### 4.4 证据链

1. 真实业务测试中，任务 `delivery-closure-forced-20260514-094946` 启动成功，审计记录存在 `task.execute.start`。
2. 同一任务多次 `status` 成功，说明流程在原插件进程内存在。
3. Codex CLI 恢复后执行 `continue_wait`，审计记录显示 `WORKFLOW_NOT_FOUND`。
4. 同时 `delegate_sessions` 仍有该任务的 ACP 会话，`delegate_turns` 仍有运行中轮次。
5. 代码中 `loadWorkflowState()` 只读内存 Map，不读 SQLite。

## 5. 修复目标与非目标

### 5.1 修复目标

- 进行中的业务流程状态必须持久化。
- 插件进程重启后，`status` 和 `continue_wait` 能按 `workspace_path + session_alias` 恢复业务流程。
- 恢复后如果原阶段仍在运行中，应给出可继续跟进或可接手的业务状态。
- 恢复后不能误判为已完成。
- 交付测试失败、整改方案、整改确认、整改实施和复测状态也必须可持久化。

### 5.2 非目标

- 不改变 ACP 原始会话协议。
- 不重构模型选择机制。
- 不要求恢复已丢失的进程内 Promise。
- 不在本次强行实现跨进程继续等待原 Promise 的实时结果流；恢复后可以先进入可继续跟进或可接手的稳定业务状态。

## 6. 修复设计

### 6.1 状态持久化

新增 `delegate_workflows` 表，按 `workflow_key = workspace_path + session_alias` 保存业务流程快照。

快照必须包含：

- `workflow_id`
- `workflow_key`
- `workspace_path`
- `session_alias`
- `bridge_session_id`
- `stage`
- `active_phase`
- `detected_start_phase`
- `requirement_text`
- `acceptance_criteria`
- `selected_model`
- `delivery_test_passed`
- `delivery_test_result`
- `delivery_test_failures`
- `remediation_round`
- `pending_remediation_plan`
- `last_implementation_result`
- `steps`
- `phase_gates`
- `follow_up` 相关时间和策略

### 6.2 状态恢复

`loadWorkflowState()` 在内存未命中时，必须从 SQLite 读取快照并重建 `TaskWorkflowState`。

如果快照显示仍在运行中，但当前进程没有 `pendingTask`，恢复策略为：

- 保留业务阶段和当前 ACP 会话信息。
- 允许 `status` 返回业务可理解的恢复状态。
- 允许 `continue_wait` 重新进入持续跟进周期。
- 如果无法确认原 ACP 轮次仍可接续，必须给出主会话接手路径，而不是返回内部错误。

### 6.3 状态保存时机

以下时机必须保存快照：

- 创建流程后。
- 阶段启动后。
- 持续跟进周期变化后。
- 进展摘要更新后。
- 阶段完成后。
- 交付测试通过或失败后。
- 整改方案生成后。
- 整改确认并启动实施后。
- 主会话接手、取消、失败、完成后。

### 6.4 用户可见行为

用户不应看到 `WORKFLOW_NOT_FOUND` 这类内部错误作为主表达。

恢复后如果业务状态能继续，应提示：

```text
当前仍处于计划实施跟进阶段，我已恢复本次任务进度，将继续按约定跟进。
```

如果只能接手，应提示：

```text
当前委派执行端无法继续回传进展，后续需要由主会话接手或取消本次后续工作。
```

## 7. 修改范围

- `src/store/migrations/001_init.sql`：新增业务流程快照表。
- `src/store/sqlite.ts`：新增保存、读取、删除 workflow 快照的方法。
- `src/shared/types.ts`：新增 workflow 快照记录类型。
- `src/session/bridge-service.ts`：持久化和恢复 `TaskWorkflowState`。
- `tests/unit/bridge-service-workflow.test.ts`：新增插件进程重启后继续等待/状态查询测试。
- `docs/superpowers/specs/`：保存本 BUG 修改设计文档。

## 8. 自动化验证目标

- 先新增红灯测试：一个 `BridgeService` 启动实施流程并进入等待用户决策后，关闭该实例；新建第二个 `BridgeService`，对同一 `workspace_path + session_alias` 调用 `continue_wait`，当前应失败为 `WORKFLOW_NOT_FOUND`。
- 修复后该测试必须通过：恢复后不返回 `WORKFLOW_NOT_FOUND`，并返回可继续跟进或可接手的业务状态。
- 保持现有全部测试通过。
- 保持 `npm run build` 和 `npm run prepare:plugin` 通过。

## 9. 交付测试目标

真实入口：

本机 Codex CLI，插件已安装，用户使用 `$team-delegate` 自然语言触发。

用户语言：

```text
请使用 $team-delegate 完成当前目录里的开发任务。
当前已经有了《方案》和《计划》，按约定可以直接进入计划实施阶段。
首次交付测试失败后必须形成整改方案和整改计划，等待我确认整改。
```

原失败链路：

1. Codex CLI 触发团队委派实施。
2. 插件进入持续跟进。
3. 超过沉默阈值后询问用户继续等待或主会话接手。
4. 用户选择继续等待。
5. 恢复后插件返回 `WORKFLOW_NOT_FOUND`，业务中断。

复测链路：

1. 重新安装插件。
2. 从本机 Codex CLI 进入同一类业务任务。
3. 触发持续跟进和继续等待。
4. 恢复 CLI 后继续等待。
5. 插件必须恢复业务流程，不出现流程丢失。
6. 后续完成交付测试失败、整改方案、整改计划、整改实施、同链路复测。

通过标准：

- 不出现 `WORKFLOW_NOT_FOUND`。
- 用户可继续推进任务，或得到符合设计的接手路径。
- 交付失败后进入整改闭环。
- 整改后按同一通过标准复测通过。

失败后整改闭环：

如果复测仍失败，必须记录新失败事实，更新整改方案，并继续执行同链路复测。

## 10. 风险与回退

- 风险：持久化字段过多，可能引入历史快照兼容问题。
- 风险：恢复后的运行中 Promise 不存在，不能假装仍有实时进展。
- 风险：如果 ACP 子进程已经退出，恢复只能提供接手路径，不能继续读取原输出。

回退方案：

- 回退本次 workflow 快照表和恢复逻辑改动。
- 保留现有内存态流程。
- 回退后必须明确标注“不支持跨 CLI 恢复继续等待”。

## 11. 上下文恢复说明

当前 Bug 是：Codex CLI 恢复后，团队委派插件丢失进行中的业务流程状态，导致用户选择继续等待时返回 `WORKFLOW_NOT_FOUND`。

已确认失败事实：真实业务验收目录 `runtime/delivery-closure-forced-20260514-094946` 中，恢复前同一任务多次 `status` 成功，恢复后 `continue_wait` 和 `status` 均返回 `WORKFLOW_NOT_FOUND`。

当前阶段：BUG 修改设计已完成，下一步必须按 TDD 写失败测试，再实现业务流程状态持久化和恢复。

不能破坏的约束：

- 所有用户可见表达必须业务导向。
- 实施完成不等于交付完成。
- 交付测试失败必须进入整改闭环。
- ACP 整改次数固定为 3 次。
- 不允许用内部 API 测试替代最终真实业务交付测试。

## 12. 真实业务复测新增失败与整改

### 12.1 新失败事实

在 `runtime/delivery-recovery-live-20260514-102947` 中，已按真实业务入口完成插件安装并通过 Codex CLI 使用 `$team-delegate` 触发计划实施。

复测事实：

1. 第一次 CLI 进入计划实施，ACP 创建了 `started.md`，说明插件安装、skill 触发、模型确认和实施调用链路可用。
2. 业务流程快照已写入 `delegate_workflows`，阶段为 `RUNNING_IMPLEMENTATION`。
3. 第二次 CLI 使用自然语言选择继续等待后，插件不再返回 `WORKFLOW_NOT_FOUND`，审计记录为 `task.execute.continue-wait OK`。
4. 插件返回的业务状态为 `NEEDS_USER_DECISION`，`user_message` 为“当前委派执行端无法继续回传进展，后续需要由主会话接手处理。”，`next_action_required` 只有 `handoff_to_main`。
5. Codex 主会话没有把该业务决策输出给用户，而是继续每 1-2 分钟调用 `status`，导致用户仍然没有看到可执行选择。

### 12.2 根因补充

插件恢复逻辑已经返回了业务可理解的接手路径，但 `$team-delegate` skill 对 `NEEDS_USER_DECISION` 的描述只强调有 `continue_wait` 和 `handoff_to_main` 的二选一，没有明确规定：当插件返回的 `next_action_required` 不包含 `continue_wait` 时，主会话必须停止持续跟进并输出 `user_message`。

### 12.3 整改方案

1. 强化 `$team-delegate` skill：如果 `next_action_required` 不包含 `continue_wait`，必须停止持续跟进，禁止继续调用 `status`，并输出 `user_message` 与 `next_business_action`。
2. 强化 MCP 工具描述：明确返回 `next_action_required` 不包含 `continue_wait` 时，主会话必须停止持续跟进并向用户输出业务信息。
3. 增加交付契约测试，防止后续修改再次删除该停步规则。

### 12.4 复测目标

重新安装插件后，再次使用 Codex CLI 恢复同类业务任务并选择继续等待。通过标准：

- 插件仍不返回 `WORKFLOW_NOT_FOUND`。
- 主会话不能继续无限 `status`。
- 主会话必须把“委派执行端无法继续回传，需要主会话接手”的业务信息输出给用户。

### 12.5 第二轮复测新增失败与整改

全新 Codex CLI 会话中，用户使用自然语言说明“继续名为 `delivery-recovery-live-20260514-102947` 的委派任务，我选择继续等待”后，主会话调用了 `start`，插件返回模型确认，导致用户被带回“选择实施模型”，没有恢复已有业务流程。

整改要求：

1. Skill 必须明确：继续已委派任务时复用用户给出的任务名作为 `session_alias`，用户选择继续等待时优先调用 `continue_wait`，不能把继续任务当成新任务 `start`。
2. 插件必须兜底：如果同一个 `session_alias` 已经存在未终结业务流程，即使主会话误调用 `start`，也要恢复已有流程并返回当前业务状态，而不是重新进入模型选择。

新增验证：

- 单元测试覆盖“进程重启后，同名 `start` 应恢复已有流程”。
- 交付契约测试覆盖 skill 中“继续已委派任务”的停步规则。
