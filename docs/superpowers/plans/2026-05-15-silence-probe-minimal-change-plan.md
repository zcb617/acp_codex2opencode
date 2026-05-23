# silence-probe 最小改动委派任务开发计划

## 1. 项目与目标

### 1.1 功能名称

`silence-probe-minimal-change` 团队委派最小改动任务。

### 1.2 业务目标

通过 `team-delegate` 完整闭环，交付一个可验证的最小产物链路：

1. 实施阶段先静默等待 `420` 秒。
2. 等待完成后创建 `runtime/silence-probe.txt`，内容为 `done`。
3. 跟进策略满足“有进展再汇报，没动静太久再询问是否接手”。
4. 实施完成后进入交付测试判定，不直接宣告完成。

### 1.3 方案来源

本计划严格基于以下设计文档：

- `docs/superpowers/specs/2026-05-15-silence-probe-minimal-change-design.md`

### 1.4 使用对象

1. 主会话操作者（负责阶段推进与交付判定）。
2. ACP 执行端（负责实施动作）。

### 1.5 不做内容

1. 不新增与任务无关的业务文件或代码改动。
2. 不通过低层委派接口绕过高层状态机。
3. 不以单元测试替代真实业务交付测试。

## 2. 硬约束

1. 全程中文输出。
2. 委派流程必须走 `delegate_task_execute` 高层入口。
3. 计划实施前必须完成并确认方案与计划文档。
4. 实施动作必须先 `Start-Sleep -Seconds 420`，且等待期间无日志输出。
5. 最终业务产物只允许 `runtime/silence-probe.txt`（内容 `done`）。
6. 未获授权不执行 `git push`。
7. 本轮按用户确认在当前会话执行，并在交付结论中标注“未重启会话”的限制。

## 3. 范围与非范围

### 3.1 本次交付范围

1. 生成并确认本计划文档。
2. 进入实施阶段并完成静默等待与文件写入。
3. 实施后执行交付测试判定（通过或失败整改闭环）。

### 3.2 本次非范围

1. 不改造插件通用逻辑。
2. 不新增自动化测试脚本。
3. 不执行版本发布动作。

## 4. 交付完成定义

只有同时满足以下条件，才判定交付完成：

1. 设计文档与计划文档已落盘。
2. ACP 实施阶段满足“先静默等待 420 秒，再创建文件”。
3. `runtime/silence-probe.txt` 文件存在且内容精确为 `done`。
4. 跟进交互符合“有进展再汇报；长时间无进展才询问接手”。
5. 主会话在 `NEEDS_DELIVERY_TEST` 阶段提交交付测试结论。
6. 若交付失败，已按同链路完成整改与复测；若交付通过，任务进入完成状态。

## 5. 业务交付场景

### DS-01 从真实委派入口推进到实施

**业务目标：**
用户通过团队委派语义触发并进入实施阶段。

**前置条件：**
1. 插件可用。
2. 方案与计划文档已生成。

**输入数据：**
1. 委派任务描述（包含 420 秒静默等待和最终文件要求）。

**操作步骤：**
1. 主会话复用 `task_id=silence-probe-minimal-change` 推进状态机。
2. 完成方案/计划阶段必要审批。
3. 进入实施阶段。

**期望输出：**
1. 流程进入 `RUNNING_IMPLEMENTATION`。

**数据校验：**
1. 任务身份保持同一 `task_id` 与 `session_alias`。

**失败处理：**
1. 若状态未进入实施，记录状态与原因并修正输入后重试。

**对应开发任务：**
Task 01、Task 02。

### DS-02 实施阶段静默等待并写入目标文件

**业务目标：**
验证 ACP 能按要求先长时间无进展，再完成最小产物写入。

**前置条件：**
1. 已进入 `RUNNING_IMPLEMENTATION`。

**输入数据：**
1. 实施指令：`Start-Sleep -Seconds 420` 后写入 `runtime/silence-probe.txt`。

**操作步骤：**
1. ACP 执行 420 秒静默等待。
2. 等待结束后创建并写入目标文件。

**期望输出：**
1. 文件创建成功。
2. 文件内容为 `done`。

**数据校验：**
1. `runtime/silence-probe.txt` 存在。
2. 文件内容与预期完全一致。

**失败处理：**
1. 缺文件或内容错误则提交 `delivery_test_fail`，进入整改闭环。

**对应开发任务：**
Task 03、Task 04。

### DS-03 跟进交互与无进展决策策略验证

**业务目标：**
确保实施阶段用户体验符合业务要求。

**前置条件：**
1. 实施阶段正在运行。

**输入数据：**
1. 跟进请求与用户选择（继续等待/主会话接手）。

**操作步骤：**
1. 主会话按 1-2 分钟节奏查询状态。
2. 有新输出时给出简短业务进展。
3. 长时间无进展时才询问是否接手。

**期望输出：**
1. 不出现有进展时反复询问接手。
2. 仅在无进展达到阈值后触发询问。

**数据校验：**
1. 询问触发时机与状态返回一致。

**失败处理：**
1. 记录偏差现象并走整改闭环。

**对应开发任务：**
Task 05。

### DS-04 交付测试闭环判定

**业务目标：**
验证“实施完成不等于交付完成”，必须经过交付测试结论。

**前置条件：**
1. 实施阶段已结束。

**输入数据：**
1. 交付测试观察证据（文件结果、流程结果、会话限制说明）。

**操作步骤：**
1. 进入 `NEEDS_DELIVERY_TEST`。
2. 主会话提交 `delivery_test_pass` 或 `delivery_test_fail`。
3. 若失败，按闭环执行整改与复测。

**期望输出：**
1. 仅在 `delivery_test_pass` 后进入完成态。

**数据校验：**
1. 交付结论包含真实入口描述与限制说明。

**失败处理：**
1. 按失败修复与复测机制执行。

**对应开发任务：**
Task 06。

## 6. 自测命令

本任务以流程交付为主，不新增代码编译目标。执行以下命令用于产物验证：

```powershell
Test-Path -LiteralPath runtime/silence-probe.txt
Get-Content -LiteralPath runtime/silence-probe.txt
```

通过标准：

1. 第一个命令返回 `True`。
2. 第二个命令返回 `done`。

## 7. 失败修复与复测机制

若任一关键步骤失败，执行以下流程：

1. 停止宣告完成。
2. 记录失败位置、用户输入、实际表现、预期表现、复现步骤。
3. 调用 `delivery_test_fail` 进入失败闭环。
4. 形成整改方案与整改计划，等待用户确认后执行 `remediation_approve`。
5. 整改后重新执行同一条交付测试链路。
6. 仅在复测通过后提交 `delivery_test_pass`。

## 8. 技术设计与模块边界

1. 主会话边界：
   - 只负责阶段推进、用户交互、交付判定。
2. ACP 边界：
   - 只负责按计划实施静默等待和文件写入。
3. 插件状态机边界：
   - 负责阶段门禁、跟进节奏、用户决策闸门、交付闭环。
4. 文件产物边界：
   - 仅 `runtime/silence-probe.txt` 为最终业务产物。

## 9. API、数据模型与配置

### 9.1 关键动作

1. `start`：推进设计/计划/实施阶段。
2. `status`：实施阶段持续跟进。
3. `continue_wait` / `handoff_to_main`：无进展决策分支。
4. `delivery_test_pass` / `delivery_test_fail`：交付测试结论。

### 9.2 关键任务字段

1. `task_id`: `silence-probe-minimal-change`
2. `session_alias`: `silence-probe-minimal-change`
3. `development_type`: `feature`
4. `workspace_path`: `D:/zhangcb/my_wiki/coding/acp_codex2opencode`

### 9.3 关键产物路径

1. `runtime/silence-probe.txt`
2. `docs/superpowers/specs/2026-05-15-silence-probe-minimal-change-design.md`
3. `docs/superpowers/plans/2026-05-15-silence-probe-minimal-change-plan.md`

## 10. 开发任务拆分

### Task 01: 生成并确认计划文档

**目标：**
输出可执行计划并与设计文档逐项对齐。

**对应交付场景：**
DS-01。

**文件：**
1. 新增 `docs/superpowers/plans/2026-05-15-silence-probe-minimal-change-plan.md`

**实施步骤：**
1. 读取设计文档。
2. 生成计划结构与任务拆分。
3. 落盘到指定路径。

**验证命令：**

```powershell
Test-Path -LiteralPath docs/superpowers/plans/2026-05-15-silence-probe-minimal-change-plan.md
```

### Task 02: 推进到实施阶段

**目标：**
复用同一任务身份进入 `RUNNING_IMPLEMENTATION`。

**对应交付场景：**
DS-01。

**文件：**
1. 无新增代码文件。

**实施步骤：**
1. 调用 `start` 推进阶段。
2. 完成必要审批动作。

**验证命令：**

```text
检查 delegate_task_execute 返回状态已进入 RUNNING_IMPLEMENTATION
```

### Task 03: 执行 420 秒静默等待

**目标：**
实现“长时间无进展”模拟。

**对应交付场景：**
DS-02、DS-03。

**文件：**
1. 无新增代码文件。

**实施步骤：**
1. ACP 执行 `Start-Sleep -Seconds 420`。
2. 等待期间不输出日志。

**验证命令：**

```text
通过实施阶段进度与最终结果间隔验证等待已发生
```

### Task 04: 写入最终产物文件

**目标：**
创建目标文件并写入 `done`。

**对应交付场景：**
DS-02。

**文件：**
1. 新增 `runtime/silence-probe.txt`

**实施步骤：**
1. 执行 `Set-Content -LiteralPath runtime/silence-probe.txt -Value done`。

**验证命令：**

```powershell
Test-Path -LiteralPath runtime/silence-probe.txt
Get-Content -LiteralPath runtime/silence-probe.txt
```

### Task 05: 跟进节奏与接手询问策略执行

**目标：**
满足业务侧跟进体验要求。

**对应交付场景：**
DS-03。

**文件：**
1. 无新增代码文件。

**实施步骤：**
1. 按 1-2 分钟节奏查询状态。
2. 有进展才汇报。
3. 无进展达阈值才询问是否接手。

**验证命令：**

```text
基于状态返回与会话输出核对询问触发时机
```

### Task 06: 交付测试判定与闭环提交

**目标：**
完成交付测试通过/失败闭环动作。

**对应交付场景：**
DS-04。

**文件：**
1. 无新增代码文件。

**实施步骤：**
1. 在 `NEEDS_DELIVERY_TEST` 提交测试结论。
2. 若失败，提交失败材料并进入整改闭环。
3. 若通过，提交 `delivery_test_pass`。

**验证命令：**

```text
检查任务状态进入 COMPLETED 或进入失败整改流程
```

## 11. 测试策略

1. 阶段测试：验证状态机按 `design -> planning -> implementation -> delivery test` 推进。
2. 产物测试：验证目标文件存在且内容正确。
3. 行为测试：验证 420 秒等待先于文件写入。
4. 交互测试：验证长时间无进展才询问接手。
5. 交付测试：基于真实业务语言触发并提交最终结论。
6. 限制说明：本轮不重启会话，该限制必须写入交付反馈。

## 12. 需求到验收映射

| 需求 | 开发任务 | 验收场景 | 自动化验证 |
|---|---|---|---|
| 先静默等待 420 秒 | Task 03 | DS-02 | 状态时间线与结果时序核对 |
| 创建 runtime/silence-probe.txt 且内容 done | Task 04 | DS-02 | `Test-Path` + `Get-Content` |
| 有进展再汇报，无进展过久再询问接手 | Task 05 | DS-03 | 状态跟进与用户提示核对 |
| 必须走交付测试闭环 | Task 06 | DS-04 | `delivery_test_pass/fail` 状态流转核对 |

## 13. 最终交付清单

- [ ] 设计文档已确认。
- [ ] 计划文档已确认。
- [ ] 已进入实施阶段并完成静默等待。
- [ ] 已创建 `runtime/silence-probe.txt` 且内容 `done`。
- [ ] 已执行交付测试判定并提交闭环结论。
- [ ] 未执行未经授权的 `git push`。
- [ ] 已记录本轮“未重启会话”限制。

