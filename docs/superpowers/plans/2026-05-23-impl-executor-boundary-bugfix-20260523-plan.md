## 1. Bug 与设计来源

- Bug 名称：实施阶段业务分流与主会话内部派工边界错位
- 设计文档：`docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md`
- 当前失败链路：
  1. 用户从真实 Codex CLI 入口进入团队委派流程
  2. 方案和计划已确认，进入实施阶段
  3. 插件本应让用户在“主会话继续实施 / ACP 委派实施”之间二选一
  4. 主会话却把 `coder/子代理` 混入该业务选择
  5. 用户表面选的是“子代理”，底层实际触发的是 ACP 路径，并继续进入 `opencode models`
- 本计划目标：
  1. 锁死实施入口的业务边界，只允许 `主会话继续实施 / ACP 委派实施`
  2. 禁止主会话把 `coder/子代理` 暴露成插件业务选项
  3. 在自动化测试和真实交付测试中锁住这条边界，防止回归
- 本计划不处理：
  1. `implementation_executor_select` 参数协议改造
  2. ACP 实施闭环、持续跟进和整改闭环的结构重构
  3. 主会话接手后内部是否可以继续使用 coder 子代理的策略自由度

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| 实施入口对用户只暴露 `主会话继续实施 / ACP 委派实施` | Task 01, Task 02, Task 03 | UT-01, UT-02, UT-04 | DT-01, DT-02 | 待实施 |
| 主会话不得把 `coder/子代理` 改写成插件业务选项 | Task 01, Task 02, Task 03 | UT-01, UT-03, UT-04 | DT-01, DT-03 | 待实施 |
| 用户未明确选择 ACP 前，不得出现 ACP 模型确认或 `opencode models` 的用户可见提示 | Task 02, Task 03 | UT-02, UT-04 | DT-03 | 待实施 |
| 选择 `main` 后插件闭环结束，与主会话内部派工边界清晰分离 | Task 01, Task 02 | UT-01, UT-02 | DT-02 | 待实施 |
| 安装产物、构建产物与真实交付测试都保留该边界 | Task 03, Task 04 | UT-03, UT-05, UT-06 | DT-01, DT-02, DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01: 补实施入口业务边界规则

**业务目标：**

让 `NEEDS_IMPLEMENTATION_EXECUTOR` 节点对主会话形成硬约束：此节点只允许暴露“主会话继续实施 / ACP 委派实施”，不得夹带主会话内部派工语言。

**对应设计目标：**

- 实施入口对用户只暴露 `主会话继续实施 / ACP 委派实施`
- 主会话不得把 `coder/子代理` 改写成插件业务选项
- 选择 `main` 后插件闭环结束，与主会话内部派工边界清晰分离

**设计来源：**

- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `6.1 规则层修复`

**修改范围：**

- `skills/team-delegate/SKILL.md`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**文件范围：**

- `skills/team-delegate/SKILL.md`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 在 `NEEDS_IMPLEMENTATION_EXECUTOR` 规则段补“只能使用插件定义的业务选项”。
2. 明确禁止 `coder`、`子代理`、`opencode`、`模型选择` 等内部实现词汇出现在此节点。
3. 明确写出：用户选 `main` 后插件闭环结束；主会话内部是否派 coder 不属于插件流程。
4. 同步补 skill 文本断言和安装产物断言。

**伪代码：**

```text
输入：workflow_status = NEEDS_IMPLEMENTATION_EXECUTOR
输出业务语义 = ["主会话继续实施", "ACP 委派实施"]
if 用户可见选项包含 coder/子代理/opencode/模型选择:
  视为违规表达
if 用户选择 main:
  输出 "插件闭环结束，后续由主会话负责"
  不讨论主会话内部派工
if 用户选择 acp:
  允许进入 ACP 模型确认与实施闭环
输出：实施入口业务边界被锁死
```

**自动化验证：**

- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**交付测试影响：**

这是防止主会话把内部派工混进插件业务分流的第一层门禁。

**对应交付场景：**

- 用户从真实 Codex CLI 入口进入实施阶段时，首屏不得出现 `coder/子代理`
- 插件安装后缓存产物中的 skill 也必须保留相同边界约束

**完成标准：**

- skill 规则中明确出现“只能是主会话/ACP 两选一”和“禁止暴露 coder/子代理”。
- 安装产物断言同步覆盖上述规则。

### Task 02: 补桥接服务实施入口的结构化边界提示

**业务目标：**

让桥接服务在首次返回实施入口和恢复态返回实施入口时，都显式告诉主会话：当前是“实施执行方选择”，不是“主会话内部派工选择”。

**对应设计目标：**

- 实施入口对用户只暴露 `主会话继续实施 / ACP 委派实施`
- 用户未明确选择 ACP 前，不得出现 ACP 模型确认或 `opencode models` 的用户可见提示
- 选择 `main` 后插件闭环结束，与主会话内部派工边界清晰分离

**设计来源：**

- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `6.2 返回契约修复`
- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `6.3 用户可见行为修复`

**修改范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**文件范围：**

- `src/session/bridge-service.ts`
- `tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 在首次进入 `NEEDS_IMPLEMENTATION_EXECUTOR` 的返回结构中补边界字段或边界文案。
2. 在恢复态 `status` 分支的同一节点补同样边界，保持首返与恢复态一致。
3. 明确写出：未选择 ACP 前，不应进入 ACP 模型确认或模型选择。
4. 保持现有 `main/acp` 动作契约不变，只加边界说明。
5. 补单元测试，确保文案或字段能表达“主会话内部派工不属于此节点”。

**伪代码：**

```text
输入：构造 NEEDS_IMPLEMENTATION_EXECUTOR 响应
user_options = ["主会话继续实施", "ACP 委派实施"]
boundary_text = "当前是实施执行方选择，不是主会话内部派工选择"
if implementation_executor 未选择:
  不输出 ACP 模型确认相关提示
if option == main:
  说明插件闭环结束
  不延展到 coder/子代理
输出：首返与恢复态都带同一边界提示
```

**自动化验证：**

- `tests/unit/bridge-service-workflow.test.ts`

**交付测试影响：**

这是把“插件业务分流”和“主会话内部派工”拆层表达的第二层门禁。

**对应交付场景：**

- 用户进入实施阶段时，首屏业务提示明确说明这是“实施执行方选择”
- 用户未选择 ACP 前，页面或回复中不出现 ACP 模型确认、模型选择或 `opencode models`

**完成标准：**

- 首返与恢复态实施入口都带一致边界提示。
- 单元测试能抓住“不得把实施入口写成 coder/子代理选择”。

### Task 03: 先补红灯测试，再锁回归

**业务目标：**

先证明当前自动化测试没有覆盖这条业务边界，再在修复后把这条边界锁成长期护栏。

**对应设计目标：**

- 主会话不得把 `coder/子代理` 改写成插件业务选项
- 用户未明确选择 ACP 前，不得出现 ACP 模型确认或 `opencode models` 的用户可见提示
- 安装产物、构建产物与真实交付测试都保留该边界

**设计来源：**

- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `6.4 测试修复`

**修改范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**文件范围：**

- `tests/unit/bridge-service-workflow.test.ts`
- `tests/delivery/team-delegate-skill.delivery.test.ts`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 先补红灯断言，要求实施入口必须包含“不是主会话内部派工选择”类边界语义。
2. 先补红灯断言，要求 skill 中明确禁止 `coder/子代理` 出现在该节点。
3. 跑目标测试，确认当前版本至少有一项失败，且失败点就是边界未被测试覆盖。
4. 实现 Task 01 和 Task 02。
5. 修复后复跑目标测试，确认全部变绿。

**伪代码：**

```text
输入：当前仓库的 skill 与 bridge-service 返回
新增断言 -> 实施入口只能是主会话/ACP 两选一
新增断言 -> 实施入口不得暴露 coder/子代理
运行目标测试
if 当前版本全部通过:
  说明红灯未抓住真实缺口，需要先修正断言
修复规则与返回后重新运行
输出：测试从红灯变绿，并锁住边界回归
```

**自动化验证：**

- 精准回归命令见第 5 节

**交付测试影响：**

这是防止未来再把主会话内部派工语言混回实施入口的自动化护栏。

**对应交付场景：**

- 真实用户在实施入口看到的首屏语义，必须能被自动化测试提前锁住
- 安装后的插件缓存仍保留同样规则，避免“源码对了、安装产物错了”

**完成标准：**

- 红灯测试能稳定抓住当前缺口。
- 修复后目标测试全部通过。

### Task 04: 分支、构建、安装与真实交付测试闭环

**业务目标：**

确保这次修复不只是文本正确，而是从真实插件安装到真实 Codex CLI 入口的整条业务链路都恢复正确。

**对应设计目标：**

- 安装产物、构建产物与真实交付测试都保留该边界

**设计来源：**

- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `9. 交付测试目标`
- `docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md` 的 `10. 风险与回退`

**修改范围：**

- `git` 分支与 worktree 操作
- 自动化验证命令与结果证据
- 真实 Codex CLI 交付测试记录

**实施步骤：**

1. 因为本次预计改动超过 3 个文件，实施前新建分支，避免直接在当前主线编码。
2. 先跑精准回归测试，再跑相关模块测试和全量测试。
3. 跑 `npm run build` 与 `npm run prepare:plugin`。
4. 在独立 worktree 中重新安装插件并重启/刷新 Codex 环境。
5. 用真实 Codex CLI 发起“设计和计划已经确认，直接进入实施”的业务链路。
6. 验证首屏只出现 `主会话继续实施 / ACP 委派实施`。
7. 继续验证 `main` 路径结束插件闭环，`acp` 路径才进入模型确认/实施闭环。
8. 若失败，记录事实、补整改、重新跑同一条交付链路。

**伪代码：**

```text
输入：已完成代码修改的工作区
if 修改文件数 > 3:
  创建新分支后再实施
运行自动化验证 -> 构建 -> prepare:plugin
在 worktree 中安装插件并重启真实 Codex 环境
从真实 CLI 输入实施业务语句
if 首屏出现 coder/子代理:
  判定交付测试失败并进入整改
else if 选择 main 后仍继续 ACP:
  判定交付测试失败并进入整改
输出：真实业务链路通过后才允许宣告完成
```

**自动化验证：**

- `npm test`
- `npm run build`
- `npm run prepare:plugin`

**交付测试影响：**

这是最终证明“用户看到的就是插件正确业务边界”的交付门禁。

**对应交付场景：**

- 在独立 worktree 中重新安装插件
- 在真实 Codex CLI 入口复现“设计和计划已经确认，直接进入实施”
- 同时验证 `main` 路径和 `acp` 路径的真实分流结果

**完成标准：**

- 已在独立分支与 worktree 中完成真实业务链路复测。
- 通过标准满足后，才能汇报修复完成。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 实施入口缺少“不是主会话内部派工选择”的边界提示 | `bridge-service` 返回不包含边界语义 | 首返与恢复态都包含明确边界提示 |
| UT-02 | 用户未选 ACP 前仍可能混入 ACP 后续语义 | 实施入口文案无法区分“业务分流”和“内部派工” | 实施入口明确只谈 `main/acp`，不谈 ACP 模型确认 |
| UT-03 | skill 未禁止暴露 `coder/子代理` | `team-delegate` skill 文本中找不到禁止条款 | skill 文本明确禁止该节点暴露 `coder/子代理` |
| UT-04 | 安装产物无法保证边界规则带到最终插件 | 安装产物断言缺少边界条款 | 安装产物保留边界条款 |
| UT-05 | 现有 `main/acp` 状态机能力被修坏 | 选择 `main` 或 `acp` 的旧测试失败 | 旧状态机测试保持通过 |
| UT-06 | 构建或 prepare 产物被破坏 | `npm run build` 或 `npm run prepare:plugin` 失败 | 两条命令都通过 |

## 5. 自动化验证计划

### 5.1 精准回归测试

1. 红灯测试：

```bash
npm test -- tests/unit/bridge-service-workflow.test.ts -t "implementation"
npm test -- tests/delivery/team-delegate-skill.delivery.test.ts -t "implementation executor"
npm test -- tests/plugin/install.plugin.test.ts
```

### 5.2 相关模块测试

2. 相关模块测试：

```bash
npm test -- tests/unit/bridge-service-workflow.test.ts
npm test -- tests/delivery/team-delegate-skill.delivery.test.ts
npm test -- tests/plugin/install.plugin.test.ts
```

### 5.3 全量测试

3. 全量验证：

```bash
npm test
```

### 5.4 编译或构建

4. 构建验证：

```bash
npm run build
```

### 5.5 插件或安装检查

5. 插件交付物验证：

```bash
npm run prepare:plugin
```

6. 若需要本地重装插件用于真实交付测试：

```bash
npm run plugin:install-local
```

## 6. 真实业务交付测试计划

### 6.1 真实入口

- 独立 `worktree`
- 已安装当前插件的真实 Codex 环境
- 真实 Codex CLI 自然语言入口

### 6.2 操作步骤

1. 先新建独立 worktree，避免污染项目代码。
2. 在 worktree 中安装当前插件，并重启或刷新 Codex 环境。
3. 打开真实 Codex CLI，使用真实业务语言发起：

```text
帮我用团队委派流程完成这个开发任务。设计和计划已经确认，直接进入实施。
```

4. 观察实施入口首屏。
5. 通过标准一：
   - 首屏只能看到 `主会话继续实施 / ACP 委派实施`
   - 不得出现 `coder`、`子代理`、`opencode`、`模型选择`
6. 继续验证主会话路径：
   - 选择 `1`
   - 插件必须结束闭环
   - 不得继续出现 ACP 路径提示
7. 继续验证 ACP 路径：
   - 重新发起同类链路并选择 `2`
   - 只有此时才允许出现 ACP 模型确认、模型选择、实施闭环

### 6.3 失败后整改与再测试

8. 任一项失败都判定本次交付测试失败，必须回到整改闭环。
9. 记录失败截图、失败回复、实际链路和触发选择。
10. 补充整改任务后，重新运行第 5 节自动化验证。
11. 自动化验证重新通过后，再按本节同一条真实业务链路复测。

## 7. 交付测试失败整改记录

初始状态：待实施

如交付测试失败，必须在本节补齐以下字段：

- 失败场景：
- 输入数据或用户输入：
- 期望结果：
- 实际结果：
- 根因分析：
- 修复方案：
- 复测命令：
- 复测结果：
- 是否继续整改：

## 8. 设计完成核对清单

- [ ] 实施入口只暴露 `主会话继续实施 / ACP 委派实施`
- [ ] skill 明确禁止在该节点暴露 `coder/子代理`
- [ ] bridge-service 首返与恢复态都表达“这是业务分流，不是内部派工”
- [ ] 用户未选择 ACP 前，不出现 ACP 后续用户可见提示
- [ ] 选择 `main` 后插件闭环结束的边界仍成立
- [ ] 红灯测试先失败，再在修复后变绿
- [ ] 相关模块测试、全量测试、构建、prepare:plugin 全部通过
- [ ] 真实 Codex CLI 交付测试通过

## 9. 上下文恢复说明

- 本计划承接的设计文档路径：`docs/superpowers/specs/2026-05-23-impl-executor-boundary-bugfix-20260523-design.md`
- 本次修复的核心不是改状态机，而是锁死“插件业务分流”和“主会话内部派工”的边界
- 实施前要先新建分支，因为预计修改文件超过 3 个
- 交付测试必须在独立 worktree 中从真实 Codex CLI 入口复测同一条失败链路
- 当前进度：设计文档已确认，计划文档正在补齐门禁要求
- 下一步：重新提交 `planning_complete`，通过计划门禁后进入实施
- 恢复入口：继续使用 `task_id/session_alias = impl-executor-boundary-bugfix-20260523` 在同一任务闭环中推进
