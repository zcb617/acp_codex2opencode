# 开发类型感知的方案与计划流程开发计划

## 1. 项目与目标

本计划实现团队委派插件的“开发类型感知”能力。目标是让插件在 Design 和 Planning 阶段根据主会话判断出的开发类型选择不同文档规则：

- 新增功能使用 `docs/可交付开发设计文档编写指南-v0.1.md` 和 `docs/可交付开发计划编写指南-v0.1.md`。
- BUG 修改使用 `docs/可交付BUG修改设计文档编写指南-v0.1.md` 和 `docs/可交付BUG修改计划编写指南-v0.1.md`。

当前痛点是：插件只有新增功能文档流程，BUG 修改任务会被迫输出新增功能方案和计划，缺少失败事实、根因分析、红灯测试和同链路复测目标。

交付后应达到的效果：

- 主会话像判断 `start_phase` 一样判断开发类型。
- 插件只接收判断结果并做流程决策，不做关键词穷举。
- BUG 修改任务进入 BUG 修改设计/计划规则。
- 新增功能任务保持现有新增功能规则。
- 判断不清时停在上下文补充节点。

本计划不处理：

- 不修改四份指南文档正文。
- 不新增第三种开发类型。
- 不改实施、交付测试、整改闭环的业务语义。
- 不执行未经授权的 `git push`。

## 2. 硬约束

- 全部文档和面向用户输出必须使用中文。
- 开发或修改代码前必须先获得用户批准。
- 开发代码必须在插件项目自己的 git 仓库中进行：`D:\zhangcb\my_wiki\coding\acp_codex2opencode`。
- 不使用外层 `D:\zhangcb\my_wiki` 仓库提交插件改动。
- 开发代码必须使用 `codex/` 前缀分支。
- 未经用户授权禁止执行 `git push`。
- 必须先写失败测试，再实现代码。
- 开发完成后必须执行编译。
- 真实业务交付测试必须使用本机真实环境和 Codex CLI 真实入口。
- 不允许用单元测试、字段检查或直接调用内部 MCP 工具代替真实业务交付测试。

## 3. 范围与非范围

### 3.1 本次交付

- 新增 `development_type` 入参和校验。
- 新增开发类型决策解析逻辑。
- workflow 状态保存开发类型和判断证据。
- Design prompt 根据开发类型选择新增功能或 BUG 修改指南。
- Planning prompt 根据开发类型选择新增功能或 BUG 修改指南。
- 文档门禁根据开发类型选择对应必备章节。
- Design / Planning 反馈和补全文档沿用 workflow 的开发类型。
- `team-delegate` skill 增加开发类型判断规则。
- README 更新调用说明。
- 自动化测试覆盖新增功能和 BUG 修改两条文档路径。
- 插件安装产物包含更新后的 skill 和 schema。

### 3.2 本次不交付

- 不新增低层 ACP 工具。
- 不新增数据库迁移。
- 不改模型选择机制。
- 不改交付测试失败后的整改次数。
- 不让插件内部通过关键词穷举判断类型。

## 4. 交付完成定义

只有同时满足以下条件，才能判定本功能交付完成：

- `start` 缺少开发类型时，插件返回上下文补充，不进入模型选择。
- `development_type=feature` 时，Design / Planning 使用新增功能文档规则。
- `development_type=bugfix` 时，Design / Planning 使用 BUG 修改文档规则。
- 反馈修订和门禁补全文档不改变最初确定的开发类型。
- workflow snapshot 能保存和恢复开发类型。
- skill 明确要求主会话判断开发类型，并禁止插件关键词穷举。
- README 说明新的开发类型入参和行为。
- 自动化验证通过。
- 本地真实 Codex CLI 入口能用自然语言触发新增功能和 BUG 修改两种流程。

## 5. 业务交付场景

### DS-01 新增功能任务进入新增功能文档规则

**业务目标：**
用户提出新增插件能力时，团队委派流程继续生成新增功能方案和计划。

**前置条件：**
插件已安装，Codex 已加载 `team-delegate` skill 和 MCP 工具。

**输入数据：**

- 用户需求：给团队委派插件新增开发类型感知能力。
- 主会话判断：开发类型为新增功能。

**操作步骤：**

1. 用户在 Codex CLI 中说：使用团队委派流程，给插件新增开发类型感知能力。
2. 主会话判断当前需要方案制定。
3. 主会话判断本次是新增功能。
4. 主会话调用插件高层入口。
5. 插件进入方案制定或返回主会话制定方案。
6. 方案和计划使用新增功能文档规则。

**期望输出：**

- 用户看到当前处于方案制定或计划制定阶段。
- 用户看到这是新增功能文档规则。
- 文档包含新增功能设计/计划指南要求的章节。

**数据校验：**

- 响应包含 `detected_development_type=feature`。
- `document_profile.design_guide` 指向可交付开发设计指南。
- `document_profile.planning_guide` 指向可交付开发计划指南。

**失败处理：**

- 如果缺少开发类型，流程应返回上下文补充。
- 如果错误进入 BUG 修改规则，交付测试失败并进入整改。

**对应开发任务：**
Task 01、Task 02、Task 03、Task 04。

### DS-02 BUG 修改任务进入 BUG 修改文档规则

**业务目标：**
用户提出修复已有问题时，团队委派流程生成 BUG 修改设计和 BUG 修改计划。

**前置条件：**
插件已安装，Codex 已加载 `team-delegate` skill 和 MCP 工具。

**输入数据：**

- 用户需求：修复恢复后找不到委派流程的问题。
- 主会话判断：开发类型为 BUG 修改。

**操作步骤：**

1. 用户在 Codex CLI 中说：使用团队委派流程，修复恢复后找不到委派流程的问题。
2. 主会话判断当前需要方案制定。
3. 主会话判断本次是 BUG 修改。
4. 主会话调用插件高层入口。
5. 插件进入方案制定或返回主会话制定方案。
6. 方案和计划使用 BUG 修改文档规则。

**期望输出：**

- 用户看到当前处于方案制定或计划制定阶段。
- 用户看到这是 BUG 修改文档规则。
- 文档包含失败事实、根因分析、修复目标、红灯测试和同链路复测目标。

**数据校验：**

- 响应包含 `detected_development_type=bugfix`。
- `document_profile.design_guide` 指向可交付 BUG 修改设计指南。
- `document_profile.planning_guide` 指向可交付 BUG 修改计划指南。

**失败处理：**

- 如果文档缺少 BUG 修改必备章节，门禁必须触发补全文档。
- 如果错误进入新增功能规则，交付测试失败并进入整改。

**对应开发任务：**
Task 01、Task 02、Task 03、Task 04。

### DS-03 类型不清时停在上下文补充

**业务目标：**
用户表达模糊时，插件不猜测开发类型，而是要求补充信息。

**前置条件：**
插件已安装。

**输入数据：**

- 用户需求：处理一下团队委派流程。
- 主会话判断：开发类型不明确。

**操作步骤：**

1. 用户在 Codex CLI 中提出模糊委派需求。
2. 主会话无法明确判断新增功能或 BUG 修改。
3. 主会话调用插件并传入需要补充上下文。
4. 插件返回上下文补充状态。

**期望输出：**

- 用户看到当前需要补充上下文。
- 用户被要求明确这是新增功能还是 BUG 修改。
- 插件不进入模型选择，不启动 ACP。

**数据校验：**

- 响应 `workflow_status=NEEDS_USER_INPUT`。
- `missing_context` 包含开发类型说明。

**失败处理：**

- 如果插件继续进入模型选择或 ACP，判定为失败。

**对应开发任务：**
Task 01、Task 02、Task 04。

### DS-04 恢复后沿用原开发类型

**业务目标：**
Codex 或插件进程恢复后，仍使用原 workflow 的开发类型。

**前置条件：**
已有进行中的 workflow，并持久化到本地状态。

**输入数据：**

- 原 workflow 开发类型：BUG 修改。
- 恢复后用户继续同一委派任务。

**操作步骤：**

1. 启动 BUG 修改 workflow。
2. 持久化 workflow。
3. 模拟服务重启。
4. 使用同一 alias 查询或继续 workflow。
5. 观察响应中的开发类型和文档画像。

**期望输出：**

- 恢复后仍显示 `bugfix`。
- 后续反馈或补全文档仍使用 BUG 修改规则。

**数据校验：**

- workflow snapshot 中保存 `developmentType=bugfix`。
- 恢复后的响应包含 `detected_development_type=bugfix`。

**失败处理：**

- 如果恢复后丢失类型或变成新增功能，判定为失败。

**对应开发任务：**
Task 01、Task 03、Task 05。

## 6. 自测命令

交付前必须执行：

```powershell
npm run test:unit
npm run test:integration
npm run test:plugin-install
npm run test:delivery
npm run build
npm run prepare:plugin
```

通过标准：

- 所有命令退出码为 0。
- 新增的开发类型测试通过。
- 旧的阶段判断、模型选择、交付测试闭环测试继续通过。
- `prepare:plugin` 产物包含更新后的 `team-delegate` skill。

## 7. 失败修复与复测机制

如果任一自测命令失败：

1. 停止声明完成。
2. 记录失败命令、失败输出、预期结果和实际结果。
3. 判断失败是否来自开发类型分流、旧流程回归或环境问题。
4. 若属于本次范围，补充或修正测试。
5. 修改代码。
6. 重新执行失败的精准测试。
7. 重新执行完整自测命令。
8. 重新执行真实业务交付测试。

失败记录模板：

```markdown
# 开发类型感知流程失败记录

## 失败场景

## 输入数据

## 期望结果

## 实际结果

## 根因分析

## 修复方案

## 复测命令

## 复测结果
```

## 8. 技术设计与模块边界

### 8.1 模块划分

- `src/mcp-tools/schemas.ts`：声明高层工具新增入参和 zod 校验。
- `src/plugin/mcp-server.ts`：注册 MCP 工具 schema，使安装产物暴露新增入参。
- `src/session/bridge-service.ts`：定义开发类型、解析类型决策、保存 workflow 状态、选择文档画像、构建提示词和门禁。
- `skills/team-delegate/SKILL.md`：约束主会话判断开发类型并传给插件。
- `README.md`：说明新的开发类型字段和业务行为。
- `tests/unit/bridge-service-workflow.test.ts`：覆盖服务层开发类型分流。
- `tests/integration/delegate-tools.integration.test.ts`：覆盖工具 schema。
- `tests/plugin/install.plugin.test.ts`：覆盖安装产物和 skill 文案。
- `tests/delivery/team-delegate-skill.delivery.test.ts`：覆盖真实业务规则文案。

### 8.2 数据流

```text
用户自然语言需求
-> 主会话判断 start_phase
-> 主会话判断 development_type
-> delegate.task.execute(action=start)
-> schema 校验
-> BridgeService 解析阶段和类型
-> 类型不明则 NEEDS_USER_INPUT
-> 类型明确则保存到 workflow
-> Design/Planning 根据 developmentType 选择文档画像
-> 文档门禁按画像检查章节
-> 审批、反馈、恢复都沿用 workflow 中的 developmentType
```

### 8.3 错误传播

- 结构错误由 zod 拒绝。
- 缺少开发类型不是结构错误，返回业务状态 `NEEDS_USER_INPUT`。
- 文档缺章节由现有 `DESIGN_GATE_FAILED` / `PLANNING_GATE_FAILED` 处理。
- 恢复旧 snapshot 缺少类型时使用 `feature` 兼容，不抛错。

## 9. API、数据模型与配置

### 9.1 `delegate.task.execute`

新增请求字段：

```json
{
  "development_type": "feature",
  "development_type_reason": "本次是新增插件能力",
  "development_type_evidence": [
    "用户要求补充 BUG 修改文档流程"
  ]
}
```

可选值：

- `feature`：新增功能或业务流程调整。
- `bugfix`：BUG 修改。
- `need_user_input`：开发类型不明确，需要补充上下文。

新增响应字段：

```json
{
  "detected_development_type": "feature",
  "development_type_evidence": [
    "主会话判定开发类型: feature；理由: 本次是新增插件能力"
  ],
  "document_profile": {
    "development_type": "feature",
    "design_guide": "docs/可交付开发设计文档编写指南-v0.1.md",
    "planning_guide": "docs/可交付开发计划编写指南-v0.1.md"
  }
}
```

### 9.2 `TaskWorkflowState`

新增字段：

```typescript
type DevelopmentType = "feature" | "bugfix";

interface TaskWorkflowState {
  developmentType: DevelopmentType;
  developmentTypeEvidence: string[];
}
```

### 9.3 配置

不新增环境变量。

## 10. 开发任务拆分

### Task 01: 增加开发类型协议和状态模型

**目标：**
工具 schema、输入类型和 workflow 状态能表达开发类型。

**对应交付场景：**
DS-01、DS-02、DS-03、DS-04。

**文件：**

- 修改：`src/session/bridge-service.ts`
- 修改：`src/mcp-tools/schemas.ts`
- 修改：`src/plugin/mcp-server.ts`
- 修改测试：`tests/integration/delegate-tools.integration.test.ts`

**实施步骤：**

1. 在 `bridge-service.ts` 增加 `DevelopmentType` 和 `DevelopmentTypeDecision` 类型。
2. 在 `ExecuteTaskInput` 增加 `development_type`、`development_type_reason`、`development_type_evidence`。
3. 在 `TaskWorkflowState` 增加 `developmentType` 和 `developmentTypeEvidence`。
4. 在 workflow snapshot 写入和恢复逻辑中处理新增字段。
5. 在两个 zod schema 中增加 `development_type` 相关字段。
6. 为 schema 增加集成测试。

**验证命令：**

```powershell
npm run test:integration -- tests/integration/delegate-tools.integration.test.ts
```

**完成标准：**

- 合法开发类型通过 schema。
- 非法开发类型被 schema 拒绝。
- TypeScript 编译不报类型错误。

### Task 02: 增加开发类型决策解析和上下文补充分支

**目标：**
插件在缺少或无法确定开发类型时返回上下文补充，不进入模型选择或 ACP。

**对应交付场景：**
DS-03。

**文件：**

- 修改：`src/session/bridge-service.ts`
- 修改测试：`tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 增加 `resolveDevelopmentTypeDecision(input)`。
2. 在 `handleStartWithModelGate` 中先解析起始阶段和开发类型。
3. 只要任一判断为 `need_user_input`，返回 `buildNeedsUserInputResponse`。
4. 扩展 `buildNeedsUserInputResponse`，同时说明阶段和开发类型缺口。
5. 在 `handleModelConfirmAction`、`handleModelSelectAction`、`startWorkflowAfterModelResolved` 中使用缓存的开发类型。
6. 写红灯测试：缺少 `development_type` 时，当前代码会继续旧流程或无法返回预期字段。
7. 实现后让测试变绿。

**验证命令：**

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "development type"
```

**完成标准：**

- 缺少 `development_type` 返回 `NEEDS_USER_INPUT`。
- `development_type=need_user_input` 返回 `NEEDS_USER_INPUT`。
- 响应 `missing_context` 明确要求补充新增功能或 BUG 修改。
- 未触发 `initSession`，未进入模型选择。

### Task 03: 增加文档画像并按开发类型选择提示词和门禁

**目标：**
Design / Planning 阶段按开发类型使用不同指南、章节和补全文档提示。

**对应交付场景：**
DS-01、DS-02、DS-04。

**文件：**

- 修改：`src/session/bridge-service.ts`
- 修改测试：`tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 定义 `DOCUMENT_PROFILES` 常量。
2. 将现有 `DESIGN_REQUIRED_SECTIONS` 和 `PLANNING_REQUIRED_SECTIONS` 归入 `feature` profile。
3. 新增 `bugfix` profile，章节来自 BUG 修改设计/计划指南。
4. 修改 `buildDesignPrompt`，接收 `developmentType` 并选择指南和章节。
5. 修改 `buildPlanningPrompt`，接收 `developmentType` 并选择指南和章节。
6. 修改 `buildDesignRepairPrompt`、`buildPlanningRepairPrompt`、`buildDesignFeedbackPrompt`、`buildPlanningFeedbackPrompt`，在提示中说明当前文档规则。
7. 修改 `runDesignPhase`、`applyDesignFeedback`、`runPlanningPhase`、`applyPlanningFeedback`，传入 workflow 的开发类型和对应必备章节。
8. 写红灯测试：`bugfix` 设计输出缺少“失败事实”时门禁不应通过。
9. 实现后让测试变绿。

**验证命令：**

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "bugfix"
```

**完成标准：**

- `feature` prompt 包含可交付开发设计/计划指南。
- `bugfix` prompt 包含可交付 BUG 修改设计/计划指南。
- `bugfix` 门禁检查失败事实、根因分析、真实业务交付测试计划等章节。
- 反馈和补全文档提示不会切回新增功能规则。

### Task 04: 更新 team-delegate skill 和 README

**目标：**
主会话知道必须判断开发类型，并把判断结果传给插件。

**对应交付场景：**
DS-01、DS-02、DS-03。

**文件：**

- 修改：`skills/team-delegate/SKILL.md`
- 修改：`README.md`
- 修改测试：`tests/plugin/install.plugin.test.ts`
- 修改测试：`tests/delivery/team-delegate-skill.delivery.test.ts`

**实施步骤：**

1. 在 skill 的硬门禁中加入“先判断阶段和开发类型，再 start”。
2. 在 skill 的阶段判断章节加入开发类型判断规则。
3. 明确 `feature` 使用新增功能指南，`bugfix` 使用 BUG 修改指南。
4. 明确禁止插件通过关键词穷举判断开发类型。
5. 更新调用模板，加入 `development_type`、`development_type_reason`、`development_type_evidence`。
6. 更新 README 的工具说明和流程说明。
7. 更新安装测试，确保安装产物包含新字段和新规则。
8. 更新交付测试，确保 skill 文案包含开发类型判断要求。

**验证命令：**

```powershell
npm run test:plugin-install
npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts
```

**完成标准：**

- skill 明确要求主会话判断开发类型。
- skill 明确开发类型不清时要补充上下文。
- README 给出新增功能和 BUG 修改两个调用示例。
- 安装产物测试通过。

### Task 05: 回归验证、构建和本地真实交付测试

**目标：**
证明新能力不破坏旧流程，并能从真实入口使用。

**对应交付场景：**
DS-01、DS-02、DS-03、DS-04。

**文件：**

- 不新增业务代码文件。
- 可能追加交付测试记录到本次最终汇报，不写入仓库，除非交付测试失败需要记录。

**实施步骤：**

1. 执行全量自动化验证。
2. 执行构建。
3. 执行插件准备。
4. 执行本地插件安装。
5. 重启或刷新 Codex 使用环境。
6. 在真实 Codex CLI 中输入新增功能团队委派需求。
7. 验证主会话判断为新增功能，插件使用新增功能文档规则。
8. 在真实 Codex CLI 中输入 BUG 修改团队委派需求。
9. 验证主会话判断为 BUG 修改，插件使用 BUG 修改文档规则。
10. 如果真实交付测试失败，按第 7 节记录并整改。

**验证命令：**

```powershell
npm run test:unit
npm run test:integration
npm run test:plugin-install
npm run test:delivery
npm run build
npm run prepare:plugin
npm run plugin:install-local
```

**完成标准：**

- 自动化验证全部通过。
- 插件构建和安装成功。
- 新增功能真实业务链路通过。
- BUG 修改真实业务链路通过。
- 未执行未经授权的 `git push`。

## 11. 测试策略

- 单元测试：覆盖开发类型解析、上下文补充分支、文档画像选择、prompt 内容和门禁章节。
- 集成测试：覆盖 MCP 工具 schema 对新增字段的接收和拒绝。
- 插件测试：覆盖安装产物中的工具 schema 和 skill 文案。
- 交付测试：覆盖主会话使用真实业务语言触发新增功能和 BUG 修改两种流程。
- 构建测试：覆盖 TypeScript 编译和插件产物生成。

最终完成门禁是真实业务交付测试通过。自动化测试是必要辅助，不能替代真实入口验证。

## 12. 需求到验收映射

| 需求 | 开发任务 | 验收场景 | 自动化验证 |
|---|---|---|---|
| 主会话传入开发类型 | Task 01、Task 02 | DS-01、DS-02、DS-03 | `tests/unit/bridge-service-workflow.test.ts`、`tests/integration/delegate-tools.integration.test.ts` |
| 类型不清时补充上下文 | Task 02 | DS-03 | `tests/unit/bridge-service-workflow.test.ts` |
| 新增功能走新增功能指南 | Task 03、Task 04 | DS-01 | `tests/unit/bridge-service-workflow.test.ts`、`tests/delivery/team-delegate-skill.delivery.test.ts` |
| BUG 修改走 BUG 修改指南 | Task 03、Task 04 | DS-02 | `tests/unit/bridge-service-workflow.test.ts`、`tests/delivery/team-delegate-skill.delivery.test.ts` |
| 恢复后沿用原开发类型 | Task 01、Task 03 | DS-04 | `tests/unit/bridge-service-workflow.test.ts` |
| 安装产物包含新规则 | Task 04、Task 05 | DS-01、DS-02 | `tests/plugin/install.plugin.test.ts` |

## 13. 最终交付清单

- [ ] 代码实现完成。
- [ ] 单元测试通过。
- [ ] 集成测试通过。
- [ ] 插件安装测试通过。
- [ ] 业务交付测试通过。
- [ ] 编译通过。
- [ ] 插件产物生成通过。
- [ ] 失败记录已处理。
- [ ] README 和 skill 已更新。
- [ ] 未使用外层 `my_wiki` 仓库提交插件改动。
- [ ] 未执行未经授权的 `git push`。
