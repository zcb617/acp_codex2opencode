# 团队委派空参数调用触发前置拦截 BUG 修复计划

## 1. Bug 与设计来源

- Bug 名称：团队委派空参数调用触发前置拦截
- 设计文档：`docs/superpowers/specs/2026-05-23-empty-start-preflight-bugfix-design.md`
- 当前失败链路：主会话偶发发出 `delegate.task.execute(arguments={})`，在插件接管前被入参校验拒绝
- 本计划目标：增加 `preflight` 预检与调用硬门禁，确保真实入口不再出现空调用
- 本计划不处理：实施阶段跟进策略、整改阶段策略、低层会话协议重构

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 新增预检入口并返回阶段/类型判定 | Task 01 | UT-01, UT-02 | DT-01 | 待实施 |
| 强制“先 preflight 再 start”调用顺序 | Task 02 | UT-03, UT-04 | DT-01, DT-02 | 待实施 |
| 缺失信息时返回业务化补充提示 | Task 03 | UT-02, UT-05 | DT-02 | 待实施 |
| 防止空调用回归 | Task 04 | UT-06, UT-07 | DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01：新增 preflight 工具入口

**业务目标：**
在高风险入口前先完成阶段和开发类型判定，减少无效调用。

**对应设计目标：**
新增预检入口并返回阶段/类型判定。

**修改范围：**
- `src/mcp-tools/schemas.ts`
- `src/mcp-tools/delegate-tools.ts`
- `src/plugin/mcp-server.ts`
- `src/session/bridge-service.ts`

**实施步骤：**
1. 定义 `PreflightTaskSchema`，包含预检所需最小字段。
2. 在 `BridgeService` 增加 `preflightTask` 方法，复用现有判定能力。
3. 在工具层暴露 `preflightTask`。
4. 在 MCP 服务注册 `delegate.task.preflight`。
5. 统一返回业务化字段（阶段、原因、缺失项、下一步动作）。

**伪代码：**
```text
输入：workspace_path, requirement_text, session_alias
if workspace_path 缺失:
  返回 NEEDS_USER_INPUT + missing_context
startDecision = 判定起始阶段
typeDecision = 判定开发类型
if 任一判定为 need_user_input:
  返回 NEEDS_USER_INPUT + 缺失项 + 用户动作
else:
  返回 PREFLIGHT_READY + start_phase + development_type
```

**自动化验证：**
- `tests/unit/bridge-stage-detection.test.ts`
- `tests/plugin/lifecycle.plugin.test.ts`

**完成标准：**
- 可以独立调用 `delegate.task.preflight` 获得可执行结果或缺失信息。

### Task 02：接入“先 preflight 后 start”硬门禁

**业务目标：**
从流程层阻断空参数或未判定阶段就直接 start 的路径。

**对应设计目标：**
强制调用顺序。

**修改范围：**
- `skills/team-delegate/SKILL.md`
- `tests/plugin/install.plugin.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`

**实施步骤：**
1. 在技能铁律增加“必须先 preflight”的规则。
2. 增加反例说明：不得直接 `delegate.task.execute(arguments={})`。
3. 更新安装测试和交付测试断言技能规则生效。

**伪代码：**
```text
当触发团队委派:
  先执行 preflight
  if preflight 返回 NEEDS_USER_INPUT:
    输出缺失信息并停止 start
  else:
    组装 start 最小参数集
    调用 delegate.task.execute(action=start)
禁止：直接调用 start 或传空参数对象
```

**自动化验证：**
- `tests/plugin/install.plugin.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`

**完成标准：**
- 技能与打包产物都明确“先 preflight 后 start”。

### Task 03：缺失信息业务化回执收口

**业务目标：**
即使不能继续，也让用户知道当前业务阶段与下一步动作。

**对应设计目标：**
缺失信息业务化提示。

**修改范围：**
- `src/session/bridge-service.ts`
- `tests/unit/bridge-stage-detection.test.ts`

**实施步骤：**
1. 统一 preflight 的 `need_user_input` 响应结构。
2. 补充缺失信息清单与业务化 user_message。
3. 确保与现有状态机 `NEEDS_USER_INPUT` 语义一致。

**伪代码：**
```text
if 判定结果为 need_user_input:
  missing = 合并 start 缺失 + type 缺失
  user_message = 当前阶段 + 进入原因 + 用户选择 + 选择影响
  next_action_required = provide_context_then_preflight
  返回标准化业务响应
else:
  返回 preflight ready
```

**自动化验证：**
- `tests/unit/bridge-stage-detection.test.ts`

**完成标准：**
- 缺失信息回执包含明确业务动作，不只报技术错误。

### Task 04：空调用回归护栏

**业务目标：**
确保后续改动不会再出现 `arguments:{}` 的真实失败。

**对应设计目标：**
防止空调用回归。

**修改范围：**
- `tests/unit/bridge-stage-detection.test.ts`
- `tests/plugin/lifecycle.plugin.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`

**实施步骤：**
1. 增加工具注册断言，确保 preflight 可用。
2. 增加技能规则断言，确保“禁止空调用”被写入交付产物。
3. 在交付计划中加入运行日志核验项。

**伪代码：**
```text
执行团队委派链路测试
检查工具列表包含 delegate.task.preflight
检查技能文本包含“禁止空参数调用”
模拟信息不足输入 -> 只能返回 need_user_input
模拟信息齐全输入 -> 返回 preflight ready
断言：无路径允许直接空参数 start
```

**自动化验证：**
- 插件测试 + 交付测试

**完成标准：**
- 回归测试可稳定拦截空调用路径。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 缺少 preflight 工具 | 工具列表无该工具 | 工具注册成功 |
| UT-02 | preflight 缺少业务化缺失提示 | 返回结构缺少阶段/缺失项 | 返回完整业务字段 |
| UT-03 | 技能未强制 preflight | 技能断言失败 | 明确“先 preflight 后 start” |
| UT-04 | 技能仍允许直接 start | 反例断言失败 | 包含“禁止空调用”规则 |
| UT-05 | preflight 与 NEEDS_USER_INPUT 语义不一致 | 语义断言失败 | 语义一致 |
| UT-06 | 安装产物缺少新规则 | install 测试失败 | 安装产物通过 |
| UT-07 | 交付级技能规则回退 | delivery 测试失败 | delivery 测试通过 |

## 5. 自动化验证计划

1. 精准回归：

```bash
npm run test -- tests/unit/bridge-stage-detection.test.ts
npm run test -- tests/plugin/lifecycle.plugin.test.ts
npm run test -- tests/plugin/install.plugin.test.ts
npm run test -- tests/delivery/team-delegate-skill.delivery.test.ts
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
  1. 不出现空参数调用失败
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

- 核验点：本轮交付测试日志中不出现 `"tool":"delegate.task.execute","arguments":{}`
- 通过标准：日志零命中

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
- [ ] preflight 工具与 schema 已落地
- [ ] 技能硬门禁已更新
- [ ] 自动化测试全部通过
- [ ] 真实入口交付测试通过
- [ ] 必过表全项通过

## 9. 上下文恢复说明

- 中断后先读本计划与对应设计文档。
- 优先检查：
  1. `delegate.task.preflight` 是否已注册
  2. 技能是否强制“先 preflight 后 start”
  3. 日志是否仍出现空参数调用
- 再执行自动化验证与真实入口复测。
