# model_confirm 阶段 Invalid params BUG 修改计划

## 1. Bug 与设计来源

- Bug 名称：`model_confirm/model_select` 后先被主流程强制设置 `mode` 拦截，去掉 `mode` 后又被旧的 `requirement_text` 全动作必填契约拦截
- 设计文档：`docs/superpowers/specs/2026-05-20-model-confirm-invalid-params-design.md`
- 当前失败链路：
  - 用户从真实 Codex CLI 入口发起团队委派；
  - `start` 成功返回 `NEEDS_MODEL_CONFIRM`；
  - 第一层失败：用户确认或显式选择模型后，插件内部调用 `session/set_config_option(mode, plan|build)`，当前真实环境不接受该值；
  - 第二层失败：去掉 `mode` 后，`planning` 链路里的 `model_confirm` 在未重复携带 `requirement_text` 时，又被 MCP 工具层入参校验直接拒绝。
- 本计划目标：
  - 让模型确认后的 ACP 执行链路恢复可用；
  - 从 workflow 主流程移除 `mode` 强制传递；
  - 让 `requirement_text` 只在 `start` 时必填，后续动作依赖缓存恢复原始任务正文；
  - 证明无 `mode` 时方案和计划仍停在各自审核门禁；
  - 补齐自动化回归和真实入口复测。
- 本计划不处理：
  - 模型选择业务文案重写；
  - 其它与本次 `mode` 失败无关的 ACP 协议重构。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 模型确认后能继续进入 ACP 执行 | Task 01, Task 03 | UT-01, UT-02, UT-03 | DT-01 | 待实施 |
| 主流程不再强制设置 `mode` | Task 02 | UT-01, UT-02 | DT-01, DT-02 | 待实施 |
| 后续动作不再错误强制重复提交 `requirement_text` | Task 02 | UT-03, UT-04 | DT-01 | 待实施 |
| 无 `mode` 时方案/计划仍停在审核门禁 | Task 02, Task 03 | UT-01, UT-02, UT-03 | DT-01, DT-02 | 待实施 |
| 真实 Codex CLI 同链路复测通过 | Task 03 | 全量自动化验证 | DT-01, DT-02, DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01: 固化失败事实并更新 workflow 回归断言

**业务目标：**

先把当前失败现象和修复后的业务边界固定成自动化回归，防止修复后再次退化。

**对应设计目标：**

- 模型确认后能继续进入 ACP 执行
- 无 `mode` 时方案/计划仍停在审核门禁

**修改范围：**

- `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 保留当前 workflow 测试链路。
2. 去掉对 `current_agent_mode=plan/build` 的旧假设。
3. 改为验证无 `current_agent_mode` 时，方案仍停在 `WAITING_DESIGN_APPROVAL`，实施前链路仍按既有状态推进。

**自动化验证：**

- `npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

为真实 CLI 模型确认链路提供稳定回归基础。

**完成标准：**

- 单测不再依赖 `current_agent_mode=plan/build`。
- workflow 状态断言仍能覆盖方案确认和实施前状态推进。

### Task 02: 收敛模型确认后的内部契约与上下文恢复

**业务目标：**

让插件只依赖真实必需的 session、model 和 prompt 执行，不再让 `mode` 成为模型确认后的阻断点；同时让外层工具契约与“缓存恢复原始任务正文”的设计保持一致。

**对应设计目标：**

- 主流程不再强制设置 `mode`
- 后续动作不再错误强制重复提交 `requirement_text`
- 无 `mode` 时方案/计划仍停在审核门禁

**修改范围：**

- `src/session/bridge-service.ts`
- `src/mcp-tools/schemas.ts`
- `src/plugin/mcp-server.ts`

**实施步骤：**

1. 移除 workflow 初始化后的 `setWorkflowAgentMode(workflow, "plan", true)`。
2. 移除实施阶段和整改实施阶段前的 `setWorkflowAgentMode(workflow, "build", true)`。
3. 将 `ExecuteTaskSchema` 和 MCP 对外 `inputSchema` 收敛为：`start` 必填 `requirement_text`，非 `start` 动作可选。
4. 在 `BridgeService.resolveEffectiveStartInput()` 中把“恢复后必须拿到原始正文”做成硬兜底；若缓存也缺失，则返回明确错误。
5. 保留已有 session 创建 / 恢复、model 设置、prompt 执行和 workflow 门禁逻辑。
6. 确认 `activeAgentMode` 即使为空，也不会影响状态推进与对外业务表达。

**自动化验证：**

- `npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

直接恢复 `model_confirm/model_select` 后的真实业务推进能力。

**完成标准：**

- 代码中不再把 `mode` 作为方案、计划、实施启动前置。
- workflow 在无 `mode` 情况下仍可继续执行。
- `model_confirm/model_select/status` 等后续动作在不重复带 `requirement_text` 时仍能继续已有任务。

### Task 03: 自动化验证与真实业务交付测试

**业务目标：**

证明这次修复不仅让单测通过，而且真实用户入口下的同链路业务已恢复，且不会跳过方案确认 / 计划确认门禁。

**对应设计目标：**

- 模型确认后能继续进入 ACP 执行
- 无 `mode` 时方案/计划仍停在审核门禁
- 真实 Codex CLI 同链路复测通过

**修改范围：**

- 安装脚本执行
- 真实 CLI 复测产物

**实施步骤：**

1. 执行相关单测、交付测试脚本、构建和本地安装检查。
2. 重新安装插件并刷新 Codex 环境。
3. 用真实自然语言走 `start -> model_confirm -> ACP 执行` 链路。
4. 观察方案链路是否停在 `WAITING_DESIGN_APPROVAL`。
5. 观察计划链路是否停在 `WAITING_PLAN_APPROVAL`。
6. 再复测 `model_select` 分支，确认不再报 `Invalid params`。
7. 补充通过或失败证据到 `runtime/`。

**自动化验证：**

- 见第 5 章

**交付测试影响：**

这是本任务是否可汇报完成的最终判断依据。

**完成标准：**

- 同链路真实复测通过；
- 方案和计划都停在对应审核门禁；
- `docs/团队委派交付测试必过表.md` 所有要求通过；
- 失败则进入整改闭环，不宣称完成。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 方案链路依赖 `current_agent_mode=plan` | 去掉 `mode` 后断言失败 | `current_agent_mode` 可为空，且仍停在 `WAITING_DESIGN_APPROVAL` |
| UT-02 | 实施前链路依赖 `current_agent_mode=build` | 去掉 `mode` 后断言失败 | `current_agent_mode` 可为空，且仍进入既有实施状态推进 |
| UT-03 | `model_confirm` 不重复带 `requirement_text` 会被外层契约拦截 | `model_confirm` 因缺少 `requirement_text` 失败 | `start` 缓存的原始正文可被恢复，流程继续推进 |
| UT-04 | `start` 不带 `requirement_text` 仍会被错误放行 | 无正文也能创建任务 | `start` 缺正文时在 schema 层直接失败 |

## 5. 自动化验证计划

1. 相关模块测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test:unit -- tests/integration/delegate-tools.integration.test.ts
npm run test:unit -- tests/delivery/delegate-loop.delivery.test.ts
```

2. 交付相关自动化回归：

```bash
npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts
```

3. 全量验证：

```bash
npm test
```

4. 构建与安装检查：

```bash
npm run build
npm run prepare:plugin
npm run plugin:install-local
codex plugin list
```

## 6. 真实业务交付测试计划

### DT-01: model_confirm 同链路复测

- 真实入口：
  - 安装当前插件；
  - 刷新 Codex 环境；
  - 打开 Codex CLI；
  - 用真实业务语言发起团队委派。
- 用户真实表达：
  - “帮我用团队委派流程完成这个插件的一个 BUG 修复。现在还没有方案，请直接进入方案制定，并让 ACP 负责方案制定。如果需要执行模型，选择 llm-router-openai-compatible/kimi-for-roo。”
- 复测步骤：
  1. 触发 `start`。
  2. 等待主会话提示模型确认。
  3. 选择默认继续使用历史模型。
4. 验证不再出现 `Invalid params`，而是进入 ACP 方案制定。
 5. 验证即使主会话未重复提交 `requirement_text`，也不会再被旧契约拦截。
 6. 继续观察最终停在 `WAITING_DESIGN_APPROVAL`。
- 通过标准：
  - `model_confirm` 后继续进入 ACP 执行；
  - 不再因缺少 `requirement_text` 被工具层拦截；
  - 方案链路停在方案确认，不自动越级实施。

### DT-02: 计划链路门禁复测

- 用户真实表达：
  - “设计和计划都按团队委派流程来处理，过程中有进展就告诉我。”
- 复测步骤：
  1. 触发包含计划制定的真实链路。
  2. 观察计划编写完成后的最终状态。
  3. 验证最终停在 `WAITING_PLAN_APPROVAL`。
- 通过标准：
  - 计划链路不自动进入实施。

### DT-03: model_select 显式选模与必过表复核

- 用户真实表达：
  - 在需要重新选模时，明确选择 `llm-router-openai-compatible/kimi-for-roo`。
- 复测步骤：
  1. 触发需要选模的链路，或在确认节点选择“重新选择”。
  2. 显式提交模型。
  3. 验证不再出现 `Invalid params`。
  4. 按 `docs/团队委派交付测试必过表.md` 全量复核。
- 通过标准：
  - `model_select` 后继续进入 ACP 执行；
  - 必过表任一项失败都视为本次交付测试失败。

## 7. 交付测试失败整改记录

初始状态：待执行。

若交付测试失败，必须追加记录：

- 新失败事实
- 是否属于本次 BUG 闭环
- 新增整改任务
- 新增测试
- 再次复测结果

## 8. 设计完成核对清单

- [ ] 已固定失败事实和根因证据
- [ ] 已移除 workflow 主流程中的 `mode` 强制设置
- [ ] 已收敛 `requirement_text` 契约：`start` 必填、后续动作可从缓存恢复
- [ ] 已更新 workflow 回归断言，不再依赖 `current_agent_mode=plan/build`
- [ ] 已补 `model_confirm` 无正文时的缓存恢复回归
- [ ] 自动化测试通过
- [ ] 本机真实 Codex CLI 同链路复测通过
- [ ] 方案链路停在 `WAITING_DESIGN_APPROVAL`
- [ ] 计划链路停在 `WAITING_PLAN_APPROVAL`
- [ ] `docs/团队委派交付测试必过表.md` 全部通过
- [ ] 完成中文 commit，且未执行 `git push`

## 9. 上下文恢复说明

- 当前已确认是双层问题：
  - 第一层不是 CLI 启动参数，而是模型确认后内部 `mode` 配置调用触发了真实环境不接受的旧值；
  - 第二层是 `delegate.task.execute` 外层 schema 仍把 `requirement_text` 设成全动作必填，没有跟随后续动作的缓存恢复设计一起收敛。
- 关键证据：
  - `setConfig(model)` 成功；
  - `setConfig(mode, "plan")` 失败；
  - 去掉 `mode` 后，`planning` 链路里的 `model_confirm` 因未重复带 `requirement_text` 被工具层拦截；
  - 跳过 `mode` 设置后 `runTurn()` 可以成功；
  - 真实验证表明去掉 `mode` 后，方案停在 `WAITING_DESIGN_APPROVAL`，计划停在 `WAITING_PLAN_APPROVAL`。
- 下一步顺序：
  1. 收敛 `requirement_text` 契约与缓存恢复；
  2. 跑自动化；
  3. 做真实 CLI 同链路交付复测；
  4. 全部通过后提交代码。
