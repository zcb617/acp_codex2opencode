# ACP Codex2OpenCode Plugin

本项目交付一个可本地目录安装的 Codex 插件，用于通过 OpenCode ACP 执行通用委派闭环：

- 初始化/恢复会话
- 多轮 run/rework 委派
- 会话模型切换
- 取消轮次与关闭会话

## 团队委派模式（默认使用）

安装后，优先让模型调用高层入口：

- `delegate.task.execute`
- Skill：`team-delegate`
- Skill：`ian-think`（用于模糊需求的需求挖掘）

`team-delegate` 已加入硬守卫：

1. 先在主对话判定起始阶段（`design` / `planning` / `implementation` / `need_user_input`）和开发类型（`feature` / `bugfix` / `need_user_input`），再调用 `delegate.task.execute(action=start)`。
2. `start` 必须携带 `start_phase` 和 `development_type`（可选带 `start_phase_reason` / `start_phase_evidence` / `development_type_reason` / `development_type_evidence` / `missing_context`）。
3. `start` 后先完成模型闸门（`NEEDS_MODEL_CONFIRM` / `NEEDS_MODEL_SELECTION`），再进入 ACP 执行阶段。
4. 后续只能按 `next_action_required` 推进，不允许越级执行。

你只需要给出需求文本，插件内部会按阶段执行并停等确认。运行阶段采用持续跟进：首次同步等待最长 3 分钟；如果 ACP 在这 3 分钟内完成会立刻返回。后续必须按 1-2 分钟节奏持续跟进并返回增量进展供主会话总结；只有超过 5 分钟仍无新进展，才要求用户决定继续等待或主会话接手。

1. `action=start`：先走模型闸门：
   - 若存在且可用历史模型：返回 `NEEDS_MODEL_CONFIRM`
   - 若历史模型不可用或不存在：返回 `NEEDS_MODEL_SELECTION`（附 `available_models`）
2. `action=model_confirm`：确认是否继续使用历史模型（`use_saved_model` / `select_new_model`）
3. `action=model_select`：提交本次使用模型（`selected_model`），并写入本地模型记录文件供后续校验
4. 模型确认完成后，按主对话提供的 `start_phase` 分流：
   - `start_phase=design/planning`：默认返回主会话执行（`NEEDS_MAIN_DESIGN` / `NEEDS_MAIN_PLANNING`）
   - `start_phase=implementation`：直接进入 ACP 委派执行
   - `start_phase=need_user_input`：返回 `NEEDS_USER_INPUT`；先询问是否进入 `ian-think` 需求挖掘，或直接补充 `missing_context`
   - 如需让 ACP 执行 Design / Planning，可在 `start` 传 `design_planning_executor=acp`
5. Design / Planning 文档规则按主对话提供的 `development_type` 分流：
   - `development_type=feature`：读取 `team-delegate` skill 自带 `docs/` 下的可交付开发设计/计划指南
   - `development_type=bugfix`：读取 `team-delegate` skill 自带 `docs/` 下的可交付 BUG 修改设计/计划指南
   - `development_type=need_user_input`：返回 `NEEDS_USER_INPUT`，要求补充这是新增功能还是 BUG 修改
6. `action=status`：查询当前阶段进度，并返回 ACP 新输出摘要素材（如有）
7. `action=design_feedback`：按反馈修订 Design（仍停在待确认）
8. `action=design_approve`：进入 Planning 文档产出（停在待确认）
9. `action=planning_feedback`：按反馈修订 Planning（仍停在待确认）
10. `action=planning_approve`：进入计划实施；实施完成后进入真实业务交付测试等待节点，不直接判定完成
11. `action=continue_wait`：当返回 `NEEDS_USER_DECISION` 时，继续新的持续跟进周期
12. `action=handoff_to_main`：当返回 `NEEDS_USER_DECISION` 时，转交主会话（自动取消并关闭 ACP 会话）
13. `action=delivery_test_pass`：主会话已完成真实业务交付测试且测试通过，插件进入完成状态
14. `action=delivery_test_fail`：主会话已完成真实业务交付测试但测试失败，必须提供失败材料，插件进入整改闭环
15. `action=remediation_approve`：用户确认整改方案和整改计划后，进入当前整改实施
16. `action=cancel_follow_up`：完成 3 次整改后仍未通过时，用户取消后续工作，本次任务不声明交付完成

返回结果会包含：

- `workflow_status`：`NEEDS_MODEL_CONFIRM` / `NEEDS_MODEL_SELECTION` / `NEEDS_USER_INPUT` / `NEEDS_MAIN_DESIGN` / `NEEDS_MAIN_PLANNING` / `RUNNING_DESIGN` / `WAITING_DESIGN_APPROVAL` / `RUNNING_PLANNING` / `WAITING_PLAN_APPROVAL` / `RUNNING_IMPLEMENTATION` / `NEEDS_DELIVERY_TEST` / `DELIVERY_TEST_FAILED` / `RUNNING_REMEDIATION` / `NEEDS_REMEDIATION_DECISION` / `NEEDS_USER_DECISION` / `TRANSFERRED_TO_MAIN` / `CANCELLED` / `COMPLETED` / `FAILED`
- `next_action_required`：下一步可执行动作
- `current_model`：当前使用中的模型
- `follow_up_policy`：当前持续跟进节奏（60-120 秒范围、5 分钟无新进展决策条件、下一次持续跟进时间）
- `progress_update`：ACP 新输出增量；主会话应将其总结成简短中文进展，不直接粘贴完整原始过程

`NEEDS_USER_DECISION` 处理约束：

1. 先提示用户二选一并停住等待用户输入。
2. 禁止在当前轮使用阻塞等待命令（如 `Start-Sleep`）模拟倒计时自推进。
3. 当 `allow_timeout_default=true` 且超时未收到用户选择时，由后续跟进周期按 `decision_source=timeout_default` 自动进入新的等待周期。

## 业务交付闭环

ACP 实施完成只代表代码实施阶段结束，不代表任务已经交付。插件会在实施完成后进入 `NEEDS_DELIVERY_TEST`，要求主会话从真实业务入口执行交付测试。

闭环规则：

1. 只有主会话确认真实业务交付测试通过，并调用 `delivery_test_pass` 后，插件才进入 `COMPLETED`。
2. 如果交付测试失败，主会话必须调用 `delivery_test_fail` 并提供失败位置、用户输入、实际表现、预期表现和复现步骤。
3. 插件会形成整改方案和整改计划，等待用户确认后进入整改实施。
4. 整改完成后必须回到同一条真实业务交付测试链路。
5. ACP 整改次数固定为 3 次，由插件状态机控制，不由 LLM 或调用参数决定。
6. 完成 3 次整改后仍未通过时，用户只能选择主会话接手整改或取消后续工作。
7. 用户取消后续工作时，插件进入 `CANCELLED`，不会声明交付完成。

最小前置动作：

1. 先在主对话完成起始阶段判定，再调用 `delegate.task.execute(action=start)`。
2. 判定不明确时，用 `start_phase=need_user_input` + `missing_context` 明确向用户索取必要信息；若需求仍模糊，先询问是否进入 `ian-think` 做需求挖掘。
3. 开发类型判定不明确时，用 `development_type=need_user_input` + `missing_context` 明确向用户索取新增功能或 BUG 修改信息。

起点判定规则（主对话模型决策）：

1. 主对话模型根据“需求 + 引用文档 + 同 alias 历史上下文”返回唯一阶段：Design / Planning / Implementation / NEEDS_USER_INPUT。
2. 不使用“置信度阈值”作为外部接口语义；只返回明确下一步。
3. 当主对话模型判断信息不足、上下文冲突或模棱两可时，统一返回 `NEEDS_USER_INPUT` 并要求补充最小必要上下文。
4. 插件不做“本地穷举判定”或“ACP 二次判定”来替代主对话结论，只负责编排执行。

开发类型判定规则（主对话模型决策）：

1. 主对话模型根据用户需求和上下文返回唯一开发类型：`feature` / `bugfix` / `need_user_input`。
2. `feature` 表示新增功能或业务流程调整，Design / Planning 使用可交付开发设计/计划指南。
3. `bugfix` 表示修复已有能力的错误表现，Design / Planning 使用可交付 BUG 修改设计/计划指南。
4. 当主对话无法明确判断新增功能或 BUG 修改时，返回 `need_user_input`，由用户补充后重试。
5. 四份指南是插件资源，随 `team-delegate` skill 安装到 `~/.codex/skills/team-delegate/docs/`。
6. 主会话或 ACP 执行 Design / Planning 时必须读取该 skill 自带 `docs/`，不能把用户项目目录下的 `docs/` 或 `docs/superpowers/` 当成插件指南。
7. 插件不通过关键词穷举判断开发类型，只根据主会话传入的 `development_type` 选择文档规则。

Design/Planning 执行方规则：

1. 默认主会话执行（返回 1/2 选项，默认 1）。
2. 选择 ACP 执行时，重新调用 `action=start` 并传 `design_planning_executor=acp`。

模型策略（固定单模型）：

1. 每次执行前必须先确认/选择模型。
2. 选定后本次 workflow 全程固定该模型，不自动切换模型。
3. 下次执行前会校验该历史模型是否仍可用，再决定复用或重选。
4. 模型记录文件：`<ACP_BRIDGE_STATE_DIR>/preferred-models.json`（默认在插件 runtime 目录下）。

## 构建

```bash
npm install
npm run build
npm run prepare:plugin
```

## 本地安装

跨平台统一命令（Windows/macOS/Linux）：

```bash
npm run plugin:install-local
```

安装脚本会自动完成：

1. 依赖安装与插件构建。
2. 本地 marketplace 生成与注册。
3. 插件启用写入 `~/.codex/config.toml`。
4. MCP 兜底配置写入 `[mcp_servers.acp_codex2opencode_plugin]`（含 `OPENCODE_CONFIG_CONTENT` 自动授权）。
5. 自动安装 `team-delegate` 与 `ian-think` 到 `~/.codex/skills/`，并安装四份指南到 `~/.codex/skills/team-delegate/docs/`。

脚本输出 `INSTALLATION-COMPLETED` 即表示安装完成。  
详细线性步骤见：

`docs/superpowers/runbooks/plugin-local-install.md`

## 核心工具

- `delegate.task.execute`（推荐）
- `delegate.session.init`
- `delegate.turn.run`
- `delegate.turn.rework`
- `delegate.session.set-config`
- `delegate.turn.cancel`
- `delegate.session.close`

## 真实 ACP 联调测试

默认集成测试会跳过真实 `opencode acp`。如需执行真实联调：

```powershell
$env:RUN_REAL_ACP='1'
npm run test:integration -- tests/integration/real-acp.integration.test.ts
```

说明：

1. 取消轮次默认按 ACP 规范发送 `session/cancel` 通知。
2. 若通知后 5 秒内轮次未收敛，插件会自动回退到“`session/close` + 重建会话”策略。
