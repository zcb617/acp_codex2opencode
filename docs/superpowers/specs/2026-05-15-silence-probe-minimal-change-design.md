# silence-probe 最小改动委派任务设计文档

## 1. 背景与目标

本次任务目标是在 `coding/acp_codex2opencode` 项目内，通过 `team-delegate` 真实委派流程完成一个最小改动交付闭环：

1. 最终只创建 `runtime/silence-probe.txt`，文件内容为 `done`。
2. 创建文件前必须先执行一次 `420` 秒静默等待，期间不输出任何日志。
3. 跟进策略必须符合业务要求：有进展再汇报，长时间无进展才询问用户是否接手。
4. 必须进入交付测试节点，并形成通过或失败整改闭环。

## 2. 非目标

1. 不修改与本任务无关的业务逻辑。
2. 不通过低层 `delegate.session.*` 或 `delegate.turn.*` 绕过高层编排。
3. 不以单元测试或字段检查替代真实业务交付测试。
4. 不执行 `git push`。

## 3. 范围与术语

### 3.1 修改范围

1. 方案文档：`docs/superpowers/specs/2026-05-15-silence-probe-minimal-change-design.md`
2. 计划文档：`docs/superpowers/plans/2026-05-15-silence-probe-minimal-change-plan.md`（计划阶段生成）
3. 交付产物：`runtime/silence-probe.txt`

### 3.2 术语

1. 主会话：当前 Codex 会话，负责阶段判断、用户交互、交付测试判定。
2. ACP：被委派执行实施任务的执行端。
3. 静默等待：执行 `Start-Sleep -Seconds 420` 且不输出日志。
4. 真实业务交付测试：从真实用户入口触发并观察业务可感知结果的测试链路。

## 4. 架构与模块职责

1. 主会话（Orchestrator）：
   - 调用 `delegate_task_execute` 高层接口推进状态机。
   - 在 `RUNNING_IMPLEMENTATION` 阶段按策略汇报进展。
   - 在 `NEEDS_DELIVERY_TEST` 阶段执行交付测试并提交结论。
2. ACP 执行端（Executor）：
   - 按计划执行“先静默等待，再创建文件”。
3. 插件状态机（Workflow Engine）：
   - 负责 `Design -> Planning -> Implementation -> Delivery Test` 状态推进。
4. 文件系统产物层（Artifact）：
   - 持久化交付文件 `runtime/silence-probe.txt`。

## 5. 技术选型与约束

1. 执行环境：Windows PowerShell。
2. 静默等待命令：`Start-Sleep -Seconds 420`。
3. 文件写入命令：`Set-Content -LiteralPath runtime/silence-probe.txt -Value done`。
4. 强约束：
   - 睡眠期间禁止任何日志输出。
   - 最终仅允许新增 `runtime/silence-probe.txt` 作为业务产物文件。
   - 委派流程仅使用 `delegate_task_execute` 高层入口。

## 6. API 契约

### 6.1 启动流程

```json
{
  "action": "start",
  "task_id": "silence-probe-minimal-change",
  "session_alias": "silence-probe-minimal-change",
  "start_phase": "design",
  "development_type": "feature"
}
```

### 6.2 方案/计划审批推进

```json
{
  "action": "design_approve"
}
```

```json
{
  "action": "planning_approve"
}
```

### 6.3 实施跟进与决策

```json
{
  "action": "status"
}
```

```json
{
  "action": "continue_wait",
  "decision_source": "user_selected"
}
```

```json
{
  "action": "handoff_to_main"
}
```

### 6.4 交付测试结论

```json
{
  "action": "delivery_test_pass",
  "feedback_text": "记录真实入口、关键步骤与结果证据"
}
```

```json
{
  "action": "delivery_test_fail",
  "feedback_text": "记录失败位置、用户输入、实际表现、预期表现、复现步骤"
}
```

## 7. 数据模型

### 7.1 委派任务上下文

| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| task_id | string | 是 | 任务内唯一 | 标识同一闭环任务，确保状态连续推进 |
| session_alias | string | 是 | 与任务名一致 | 便于恢复和继续既有任务上下文 |
| start_phase | enum | 是 | design/planning/implementation | 表示当前业务阶段起点 |
| development_type | enum | 是 | feature/bugfix | 决定方案与计划文档规则 |
| requirement_text | string | 是 | 用户原始需求及补充限制 | 作为 ACP 实施输入来源 |

本表核心职责：定义委派流程的任务身份与阶段判定基础。

### 7.2 交付测试记录

| 字段名 | 类型 | 必填 | 约束/默认 | 字段作用（中文） |
|---|---|---|---|---|
| entry_path | string | 是 | Codex CLI 真实入口 | 标识本次测试是否从真实入口触发 |
| user_prompt | string | 是 | 自然语言输入 | 保留真实业务语句证据 |
| observed_result | string | 是 | 实际观察结果 | 记录用户可感知结果 |
| expected_result | string | 是 | 设计承诺 | 用于判定是否通过 |
| verdict | enum | 是 | pass/fail | 交付测试最终结论 |

本表核心职责：保存交付测试通过/失败判定证据，支撑整改闭环。

## 8. 主流程与状态机

1. 方案制定：主会话输出设计文档并获批。
2. 计划制定：主会话输出计划文档并获批。
3. 计划实施：ACP 执行以下链路：
   - `Start-Sleep -Seconds 420`（静默，无日志）
   - 创建 `runtime/silence-probe.txt`，写入 `done`
4. 持续跟进：
   - 有新输出时主会话汇报进展。
   - 无新输出且未达决策条件时不打断用户。
   - 达到无进展决策阈值时再询问“继续等待或主会话接手”。
5. 交付测试：
   - 实施完成后进入 `NEEDS_DELIVERY_TEST`。
   - 主会话提交 `delivery_test_pass` 或 `delivery_test_fail`。
6. 失败整改：
   - 若失败，先形成整改方案与整改计划，再执行整改并复测同链路。

## 9. 异常处理策略矩阵

| 异常层级 | 典型场景 | 处理动作 | 是否丢弃记录 | 是否重试 | 记录位置 | 对主流程影响 |
|---|---|---|---|---|---|---|
| 文档级 | 设计或计划文档写入失败 | 立即中止当前阶段并修复路径/权限后重试 | 否 | 是 | 主会话日志 | 阶段阻塞 |
| 实施级 | 420 秒等待期间出现日志输出 | 交付测试判定失败并进入整改闭环 | 否 | 是 | 交付测试记录 | 不可直接完成 |
| 产物级 | `runtime/silence-probe.txt` 缺失或内容不为 `done` | 判定实施未达标并走失败整改 | 否 | 是 | 交付测试记录 | 不可直接完成 |
| 会话级 | 当前轮无法重启 Codex 验证安装链路 | 在测试证据中显式标注限制并由用户确认 | 否 | 否 | 交付测试记录 | 需带限制结论 |

## 10. 幂等与去重规则

1. 任务幂等键使用 `task_id=silence-probe-minimal-change`，同任务必须复用同一 ID。
2. 实施命令重复执行时，`runtime/silence-probe.txt` 允许覆盖写入 `done`，结果一致。
3. 主会话不得并行发起同一 `task_id` 的多个 `start`，防止流程分叉。
4. 进入 `NEEDS_USER_DECISION` 后，仅在用户明确选择或超时默认策略触发时推进一次，防止重复推进。

## 11. 测试策略

1. 流程验证：
   - 验证 `design -> planning -> implementation -> delivery test` 完整链路。
2. 实施验证：
   - 验证等待 420 秒期间无日志输出。
   - 验证最终文件存在且内容精确为 `done`。
3. 交互验证：
   - 验证“有进展才汇报；长时间无进展才询问接手”。
4. 交付验证：
   - 从 Codex CLI 自然语言入口触发，并记录真实用户可见结果。
5. 当前限制：
   - 本轮不重启会话，需在交付结论中标注该限制。

## 12. 验收标准

1. 设计文档和计划文档均按规则落盘。
2. ACP 实施阶段先完成 `420` 秒静默等待，再创建文件。
3. `runtime/silence-probe.txt` 存在，且内容为 `done`。
4. 跟进过程中未出现“ACP 有持续输出仍反复询问接手”的行为。
5. 实施完成后必须进入交付测试判定，而非直接宣告完成。
6. 交付结论含真实入口证据与当前会话限制说明。

## 13. 发布与回滚 Runbook

1. 发布前：
   - 确认插件已安装且工具可用。
   - 确认当前任务使用固定 `task_id` 与 `session_alias`。
2. 实施执行：
   - 完成设计、计划审批后进入 ACP 实施。
3. 交付通过后：
   - 保留文档与测试证据，结束任务。
4. 回滚策略：
   - 若任务失败或需撤销，删除 `runtime/silence-probe.txt` 并记录回滚原因。
   - 回到 `DELIVERY_TEST_FAILED` 闭环，重新制定整改方案。

## 14. SLO 与告警

1. 跟进节奏 SLO：实施阶段按 1-2 分钟持续跟进状态。
2. 决策触发 SLO：仅当达到无进展阈值才触发接手询问。
3. 结果一致性 SLO：交付通过时文件内容 100% 精确匹配 `done`。
4. 人工告警：
   - 若发现等待期间异常日志输出，立即标记失败并整改。

## 15. 环境配置矩阵

| 环境 | 操作入口 | 关键配置 | 说明 |
|---|---|---|---|
| 本机开发环境 | Codex CLI | 已安装 `acp-codex2opencode` 插件 | 本次主要执行环境 |
| 真实交付测试环境 | Codex CLI 真实用户入口 | 自然语言触发 team-delegate | 必须使用业务语言验证 |
| 受限说明 | 当前会话 | 本轮不执行会话重启 | 需在交付结论中标注限制 |

## 16. 开发实施规范

1. 先方案、后计划、再实施，不得跳过审批闸门。
2. 实施阶段禁止先改代码后走委派状态机。
3. 仅在实施阶段执行目标命令：
   - `Start-Sleep -Seconds 420`
   - `Set-Content -LiteralPath runtime/silence-probe.txt -Value done`
4. 交付测试必须由主会话按真实业务入口执行并记录证据。
5. 若交付失败，必须先补整改方案与整改计划，再进入整改实施。

## 17. 上下文恢复说明

1. 当前任务：通过 team-delegate 闭环完成 silence probe 最小改动。
2. 当前完成：设计文档已落盘。
3. 下一步：进入计划文档阶段，并在审批后启动 ACP 实施。
4. 关键约束：静默等待 420 秒期间不输出日志；最终只产出 `runtime/silence-probe.txt`（内容 `done`）。
