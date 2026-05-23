# 团队委派空参数调用触发前置拦截 BUG 修复计划

## 1. Bug 与设计来源

- Bug 名称：团队委派空参数调用触发前置拦截
- 设计文档：`docs/superpowers/specs/2026-05-23-empty-start-preflight-bugfix-design.md`
- 当前失败链路：宿主侧把 `delegate.task.execute` 暴露成空参数签名，首次调用容易发出 `arguments={}`，随后在运行时被完整 schema 拦截
- 本计划目标：在同一份 schema 文件中拆出公开 schema 与运行时校验层，修复工具签名暴露退化，同时保持 `preflight -> start` 与既有动作校验不回退
- 本计划不处理：实施阶段跟进策略、整改阶段策略、低层会话协议重构

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 拆分公开 schema 与运行时校验，修复宿主可见签名退化 | Task 01 | UT-01, UT-02 | DT-01 | 待实施 |
| 保持 `preflight -> start` 与动作级校验不回退 | Task 02 | UT-03, UT-04 | DT-01, DT-02 | 待实施 |
| 增加 MCP 契约级测试，覆盖工具暴露 schema | Task 03 | UT-05, UT-06 | DT-03 | 待实施 |
| 防止空调用与校验放松双重回归 | Task 04 | UT-07, UT-08 | DT-01, DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01：拆分公开 schema 与运行时校验层

**业务目标：**
让宿主侧看到的 `delegate.task.execute` 参数签名重新稳定为完整对象结构，不再退化成空参数工具。

**对应设计目标：**
拆分公开 schema 与运行时校验，修复宿主可见签名退化。

**修改范围：**
- `src/mcp-tools/schemas.ts`
- `src/mcp-tools/delegate-tools.ts`
- `src/plugin/mcp-server.ts`

**实施步骤：**
1. 提取 `ExecuteTaskShape`，作为字段唯一来源。
2. 基于该 shape 构造纯 `z.object(...)` 的 `ExecuteTaskPublicSchema`。
3. 将 `.superRefine(...)` 或等价动作校验改造成运行时解析函数。
4. 在 MCP 服务注册时使用 `ExecuteTaskPublicSchema`。
5. 在工具执行时显式走运行时解析逻辑。

**伪代码：**
```text
ExecuteTaskShape = { ...字段定义... }
ExecuteTaskPublicSchema = z.object(ExecuteTaskShape)
parseExecuteTaskInput(input):
  parsed = ExecuteTaskPublicSchema.parse(input)
  再按 action 做运行时校验
  返回 parsed
```

**自动化验证：**
- `tests/plugin/lifecycle.plugin.test.ts`
- 新增 MCP 契约测试

**完成标准：**
- `listTools` 暴露出来的 `delegate.task.execute.inputSchema` 不再退化为空对象。

### Task 02：保持 `preflight -> start` 与动作级校验不回退

**业务目标：**
修复签名暴露后，仍然保留现有业务闭环和动作级拦截能力。

**对应设计目标：**
保持 `preflight -> start` 与动作级校验不回退。

**修改范围：**
- `src/mcp-tools/schemas.ts`
- `src/mcp-tools/delegate-tools.ts`
- `tests/unit/*`

**实施步骤：**
1. 保留 `start` 必须要求 `requirement_text` 的运行时校验。
2. 保留非 `start` 必须要求 `session_alias` 或 `task_id` 的运行时校验。
3. 保留 `model_confirm`、`model_select`、`implementation_executor_select` 等动作级必填项校验。
4. 验证现有 `delegate.task.preflight` 与业务闭环逻辑无需回退。

**伪代码：**
```text
if action == start and requirement_text 为空:
  拒绝
if action != start and session_alias/task_id 都为空:
  拒绝
if action == implementation_executor_select and implementation_executor 为空:
  拒绝
```

**自动化验证：**
- `tests/unit/*`
- `tests/integration/delegate-tools.integration.test.ts`

**完成标准：**
- 宿主签名修复后，运行时校验仍与现状一致。

### Task 03：增加 MCP 契约级测试，覆盖工具暴露 schema

**业务目标：**
让回归测试能直接发现“工具看起来又变成空参”的问题。

**对应设计目标：**
增加 MCP 契约级测试，覆盖工具暴露 schema。

**修改范围：**
- `tests/plugin/lifecycle.plugin.test.ts`
- 新增 MCP 契约测试文件

**实施步骤：**
1. 启动真实 MCP server。
2. 调用 `listTools` 获取工具列表。
3. 断言 `delegate.task.execute.inputSchema.properties` 至少包含 `workspace_path`、`action`、`requirement_text`、`session_alias`、`task_id`。
4. 断言 `required` 至少包含 `workspace_path`。

**伪代码：**
```text
tools = listTools()
executeTool = tools["delegate.task.execute"]
assert executeTool.inputSchema.properties.workspace_path 存在
assert executeTool.inputSchema.properties.action 存在
assert executeTool.inputSchema.required 包含 workspace_path
```

**自动化验证：**
- 新增 MCP 契约测试
- `tests/plugin/lifecycle.plugin.test.ts`

**完成标准：**
- 测试可以稳定捕获宿主侧 schema 退化。

### Task 04：防止空调用与校验放松双重回归

**业务目标：**
确保以后既不会再出现空签名误导，也不会因为修签名把运行时校验放松掉。

**对应设计目标：**
防止空调用与校验放松双重回归。

**修改范围：**
- `tests/unit/*`
- `tests/plugin/lifecycle.plugin.test.ts`
- 真实交付验证记录

**实施步骤：**
1. 增加 `start` 缺参失败断言。
2. 增加非 `start` 缺少 `session_alias/task_id` 失败断言。
3. 保留真实交付日志核验，确认本轮不再出现首次空调用失败。

**伪代码：**
```text
start 缺 requirement_text -> 应失败
status 缺 session_alias/task_id -> 应失败
implementation_executor_select 缺 implementation_executor -> 应失败
交付日志中不应再出现首次空调用失败
```

**自动化验证：**
- 单元测试 + 插件测试 + 交付测试

**完成标准：**
- 回归测试同时卡住“展示层”和“执行层”。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | `delegate.task.execute` 对外 schema 退化为空对象 | `listTools` 缺少关键字段 | 宿主可见 schema 恢复完整字段 |
| UT-02 | 公开 schema 与运行时解析脱节 | 解析失败或字段漂移 | 公开 schema 与运行时共享同一 shape |
| UT-03 | `start` 校验被放松 | 缺少 `requirement_text` 仍通过 | 继续失败 |
| UT-04 | 非 `start` 校验被放松 | 缺少 `session_alias/task_id` 仍通过 | 继续失败 |
| UT-05 | `implementation_executor_select` 校验回退 | 缺少 `implementation_executor` 仍通过 | 继续失败 |
| UT-06 | 工具名存在但暴露 schema 丢字段 | 仅文本断言通过但契约测试失败 | 文本断言和契约测试都通过 |
| UT-07 | 首次真实调用仍被空签名误导 | 真实链路首轮失败 | 首轮能正常进入后续阶段 |
| UT-08 | 修复签名后其它闭环回退 | 相关集成或交付测试失败 | 相关链路通过 |

## 5. 自动化验证计划

1. 精准回归：

```bash
npm run test -- tests/unit
npm run test -- tests/plugin/lifecycle.plugin.test.ts
<新增 MCP 契约测试文件>
```

2. 相关模块：

```bash
npm run test -- tests/unit/bridge-service-workflow.test.ts
npm run test -- tests/integration/delegate-tools.integration.test.ts
```

3. 全量回归：

```bash
npm test
```

4. 构建验证：

```bash
npm run build
```

## 6. 真实业务交付测试计划

### DT-01：信息齐全场景

- 入口：安装插件 -> 刷新环境 -> Codex CLI
- 用户语言：

```text
我已经确认这是 Windows 托盘更新链路问题，按 BUG 修复实施流程继续团队委派。
```

- 通过标准：
  1. 首轮 `delegate.task.execute` 不再出现空参数调用失败
  2. 能进入可执行阶段（或执行方选择/模型确认）

### DT-02：信息不足场景

- 用户语言：

```text
帮我继续这个问题。
```

- 通过标准：
  1. 返回业务化缺失提示
  2. 不触发高风险 start

### DT-03：日志核验

- 核验点：
  1. 本轮交付测试日志中不出现首次 `delegate.task.execute(arguments={})` 失败
  2. 宿主工具列表里 `delegate.task.execute` 具备完整参数签名
- 通过标准：日志零命中且工具签名完整

### 必过项

- 必须再次执行 `docs/团队委派交付测试必过表.md` 全项；任一失败即交付失败。

## 7. 交付测试失败整改记录

- 初始状态：待执行
- 若失败，按以下模板补录：
  - 失败链路
  - 用户输入
  - 实际表现
  - 预期表现
  - 根因归属（编排层/技能规则/插件实现）
  - 整改任务与复测结果

## 8. 设计完成核对清单

- [ ] 设计目标已全部映射实施任务
- [ ] `delegate.task.execute` 已完成公开 schema / 运行时校验分层
- [ ] MCP 契约级测试已落地
- [ ] 自动化测试全部通过
- [ ] 真实入口交付测试通过
- [ ] 必过表全项通过

## 9. 上下文恢复说明

- 中断后先读本计划与对应设计文档。
- 优先检查：
  1. `delegate.task.execute` 对外注册是否使用公开 schema
  2. 运行时解析是否仍保留动作级校验
  3. `listTools` 暴露的 `inputSchema` 是否仍完整
- 再执行自动化验证与真实入口复测。
