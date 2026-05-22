# 团队委派空参数调用触发前置拦截 BUG 修复设计

## 1. 问题摘要

- Bug 名称：团队委派入口出现空参数调用，流程在插件接管前被参数校验或风控拦截
- 影响对象：通过 Codex CLI 用自然语言触发团队委派流程的最终用户
- 影响业务链路：自然语言需求 -> 主会话判定阶段与开发类型 -> 调用高层入口 -> 插件状态机接管
- 当前失败结果：主会话偶发发出 `delegate.task.execute(arguments={})`，在插件正式业务编排前即失败，用户看到“参数缺失/风险拒绝”
- 修复后业务结果：主会话不会再发空参数调用；当信息不足时先返回业务化补充指引；满足条件后稳定进入插件闭环

## 2. 失败事实

- 触发入口：Codex CLI 自然语言触发团队委派
- 实际表现：日志记录到 `delegate.task.execute` 以空参数调用，随后返回 `workspace_path Required`
- 预期表现：入口调用必须携带完整最小上下文，至少应包含工作目录和动作对应的必要字段；不能出现空调用
- 失败证据：
  - `runtime/doc-gate-guidance-live-20260520/design-review-current-codex-exec.jsonl` 第 18-21 行出现两次 `arguments:{}` 调用并失败
  - `runtime/model-confirm-no-mode-live-20260520/planning-confirm-after-requirement-fix-codex-exec.jsonl` 第 18-21 行出现空调用并失败
- 失败阶段定位：发生在插件状态机接管前，不是插件内部状态流转失败

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

- 主会话编排层在某些路径下未完成参数组装就触发了 `delegate.task.execute`。
- 结果是工具层先报入参错误（如缺少 `workspace_path`），插件无法进入业务阶段判断与用户引导。

### 4.2 深层原因

- 当前流程把“阶段判定/开发类型判定”要求写进了技能规则，但没有形成统一的“调用前硬门禁”。
- 缺少“禁止空调用”的自动化回归测试，导致这种错误可以穿透到真实入口。

### 4.3 为什么现有测试没有发现

- 现有测试主要验证插件接管后的状态机行为，缺少“编排层调用契约”测试。
- 没有针对日志或调用构造层的“`arguments` 不能为空对象”断言。

### 4.4 证据链

- `src/mcp-tools/schemas.ts` 已定义 `workspace_path` 为必填，说明空调用必然失败。
- `skills/team-delegate/SKILL.md` 要求先判定阶段和开发类型再 `start`，但缺少“空调用禁止”显式护栏。
- 运行日志显示真实存在 `arguments:{}` 调用并失败，确认问题在插件接管前。

## 5. 修复目标与非目标

### 5.1 修复目标

1. 增加调用前硬门禁：缺少关键字段时禁止触发 `delegate.task.execute`。
2. 新增高层预检入口：先做业务判定和缺失信息收敛，再决定是否进入 `start`。
3. 对外返回统一业务化提示：明确当前阶段、缺失信息、下一步动作。
4. 加入回归测试，持续防止 `arguments:{}` 再出现。

### 5.2 非目标

1. 不重构插件核心状态机阶段枚举。
2. 不改动实施阶段持续跟进策略。
3. 不新增低层 `delegate.session.*` / `delegate.turn.*` 用户入口。

## 6. 修复设计

### 6.1 新增高层预检入口（preflight）

在 `delegate.task.execute` 之前增加预检动作（`delegate.task.preflight`）：

- 输入：`workspace_path`、`requirement_text`、可选 `session_alias/task_id`
- 输出：
  - 判定出的 `start_phase`
  - 判定出的 `development_type`
  - 若信息不足，返回 `need_user_input` 与缺失项
- 作用：先做业务判定，不触发高风险执行动作

### 6.2 高层入口调用硬门禁

主会话改为固定两步：

1. 先调用 `preflight`
2. 仅当 `preflight` 返回可进入时，才调用 `delegate.task.execute(action=start)`

并新增规则：

- 禁止空参数对象调用
- 禁止在 `workspace_path` 缺失时调用
- `start` 禁止缺少 `start_phase` 或 `development_type`

### 6.3 插件层兜底语义

- 插件对缺少关键字段的请求返回业务化提示，不只给技术报错。
- 明确提示“当前阶段为什么不能继续”和“下一步需要补什么”。

### 6.4 测试护栏

- 单元测试：`preflight` 判定与缺失信息返回
- 插件测试：新增工具注册与 schema 验证
- 交付测试：真实入口验证不再出现 `arguments:{}` 调用

## 7. 修改范围

- `src/session/bridge-service.ts`：新增 `preflight` 业务判定入口与响应构造
- `src/mcp-tools/schemas.ts`：新增 `PreflightTaskSchema`
- `src/mcp-tools/delegate-tools.ts`：新增 `preflightTask` 工具实现
- `src/plugin/mcp-server.ts`：注册 `delegate.task.preflight`
- `skills/team-delegate/SKILL.md`：补“先 preflight、后 start”的硬规则与反例
- `tests/unit/bridge-stage-detection.test.ts`：补 preflight 判定与缺失上下文测试
- `tests/plugin/lifecycle.plugin.test.ts`：补工具注册断言
- `tests/plugin/install.plugin.test.ts`：补技能规则断言
- `tests/delivery/team-delegate-skill.delivery.test.ts`：补交付级规则断言

## 8. 自动化验证目标

1. 红灯：先证明当前没有 preflight 入口、没有硬门禁文案时测试失败。
2. 绿灯：修复后 `preflight` 能返回可执行判定或缺失上下文，且相关测试通过。
3. 回归：已存在的状态机与交付测试关键断言不回退。

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
  1. 首轮不会再触发空参数调用
  2. 若信息不足，会先进入业务化补充提示
  3. 信息齐全后能稳定进入指定业务阶段

### 9.3 必过项

- 必须再次通过 `docs/团队委派交付测试必过表.md` 全部测试项

## 10. 风险与回退

- 风险：
  1. preflight 规则过严，可能误拦截本可执行请求
  2. 新旧入口并存期间，主会话仍可能走旧路径
- 控制：
  1. 通过测试覆盖“可执行/不可执行”两类输入
  2. 在技能规则里把 preflight 设为强制步骤
- 回退：
  1. 若影响范围超预期，可回退 preflight 注册与调用，并保留测试用例用于二次修复

## 11. 上下文恢复说明

- 当前问题定位：发生在插件接管前的调用构造层
- 下一步实施顺序：
  1. 先落地 `preflight` 工具与 schema
  2. 再补技能硬规则
  3. 最后补测试并执行真实交付链路验证
