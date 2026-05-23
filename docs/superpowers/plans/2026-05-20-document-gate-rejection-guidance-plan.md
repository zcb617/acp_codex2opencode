# 文档门禁拒绝缺少指南指引整改计划

## 1. Bug 与设计来源

- Bug 名称：方案/计划文档门禁拒绝后缺少对应指南指引，主会话无法按规范完成修订
- 设计文档：`docs/superpowers/specs/2026-05-20-document-gate-rejection-guidance-design.md`
- 设计日期：2026-05-20
- 当前失败链路：
  - 方案文档或计划文档被门禁拒绝后，只能看到笼统缺项或章节缺失。
  - 主会话不知道该回看 BUG 指南还是新增功能指南，也不知道该看设计指南还是计划指南。
  - 实施前计划门禁失败同样缺少这类指路能力，导致修订闭环不完整。
- 本计划目标：
  - 建立统一的文档修订指引结构；
  - 让方案拒绝、计划拒绝、实施前计划门禁失败三类场景都返回正确指南；
  - 保持原有门禁判断和状态流转不变。
- 本计划不处理：
  - 不细化到逐行级别的缺项解释；
  - 不修改章节判定规则本身；
  - 不新增新的开发类型或阶段状态。

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| G1：建立统一文档修订指引结构 | Task 01、Task 02 | UT-01、UT-02 | DT-01、DT-02 | 待实施 |
| G2：方案拒绝必须回看对应方案指南 | Task 02 | UT-03、UT-04 | DT-01 | 待实施 |
| G3：计划拒绝必须回看对应计划指南 | Task 02 | UT-05、UT-06 | DT-02、DT-03 | 待实施 |
| G4：实施前计划门禁失败复用同一指引 | Task 02 | UT-07 | DT-03 | 待实施 |
| G5：BUG 修改与新增功能分别命中正确指南 | Task 01、Task 02 | UT-03、UT-04、UT-05、UT-06、UT-07 | DT-01、DT-02、DT-03 | 待实施 |

## 3. 实施任务拆分

### Task 01: 先把拒绝后“该看哪份指南”打成红灯测试

**业务目标：**  
在改实现前，先证明当前返回结果无法明确指导主会话修订文档。

**对应设计目标：**  
G1、G5。

**修改范围：**  
`tests/unit/bridge-service-workflow.test.ts`

**实施步骤：**

1. 为方案确认态补一个失败测试，断言返回必须包含方案指南相对路径与修订指引。
2. 为计划确认态补一个失败测试，断言返回必须包含计划指南相对路径与修订指引。
3. 为实施前计划门禁失败补一个失败测试，断言返回必须包含计划指南相对路径与修订指引。
4. 区分 `bugfix` / `feature` 两类输入，分别断言不同指南路径。
5. 运行精确测试，确认当前代码先红灯。

**伪代码：**

```text
输入：bugfix/feature + design/planning/implementation gate 场景
调用 executeTask 或构造等待确认态 workflow
读取返回 payload
断言存在 document_revision_instruction
断言 guide_relative_path 与 development_type/document_type 对应
当前预期：测试先失败，证明实现还未提供该反馈
```

**自动化验证：**  
UT-01、UT-02、UT-03、UT-04、UT-05、UT-06、UT-07

**交付测试影响：**  
DT-01、DT-02、DT-03

**完成标准：**  
至少一组新增测试在修改实现前稳定红灯，失败原因与“缺少指南指引”一致。

### Task 02: 实现统一文档修订指引并接入三个拒绝出口

**业务目标：**  
让每一次文档门禁拒绝都能清楚告诉主会话：现在处于什么修订阶段，回看哪份指南，下一步怎么继续。

**对应设计目标：**  
G1、G2、G3、G4、G5。

**修改范围：**  
`src/session/bridge-service.ts`

**实施步骤：**

1. 提炼统一的文档修订指引构造函数，输入为开发类型、文档类型、缺项列表。
2. 从 `DOCUMENT_PROFILES` 读取对应指南路径、相对路径和 required sections。
3. 在 `WAITING_DESIGN_APPROVAL` 响应中加入方案修订指引。
4. 在 `WAITING_PLAN_APPROVAL` 响应中加入计划修订指引。
5. 在 `buildImplementationPlanGateNeedsInputResponse()` 中复用同一指引，避免单独维护另一套文案。
6. 更新 `user_message` / `next_business_action`，让业务首屏明确“去看哪份指南再修订”。

**伪代码：**

```text
输入：developmentType + documentType + missingSections
profile = DOCUMENT_PROFILES[developmentType]
guide = documentType == design ? profile.designGuideFile : profile.planningGuideFile
instruction = {
  document_type,
  development_type,
  guide_path,
  guide_relative_path,
  required_sections,
  missing_sections,
  next_step
}
把 instruction 注入 design review / plan review / implementation gate fail 响应
输出：业务文案 + 结构化修订指引
```

**自动化验证：**  
UT-03、UT-04、UT-05、UT-06、UT-07

**交付测试影响：**  
DT-01、DT-02、DT-03

**完成标准：**  
三类拒绝出口都返回正确的指南指引，且旧字段保持兼容。

### Task 03: 跑回归测试并验证真实入口修订链路

**业务目标：**  
确认这次整改不只是测试通过，而是真实主会话能依据反馈继续修订文档。

**对应设计目标：**  
G1、G2、G3、G4、G5。

**修改范围：**  
无新增代码文件；执行自动化验证与真实交付测试。

**实施步骤：**

1. 跑精准回归测试，确认新增断言全部转绿。
2. 跑相关模块测试，确认状态机与门禁旧行为未被破坏。
3. 构建并安装本地插件。
4. 在本机真实 Codex CLI 入口使用自然语言复测方案/计划修订链路。
5. 记录真实入口中是否已能明确看到对应指南指引。

**伪代码：**

```text
运行新增单测 -> 应从红灯转绿
运行 bridge-service 相关测试 -> 应保持通过
执行 plugin install/local build
打开真实 Codex CLI
输入自然语言触发方案或计划修订链路
观察返回是否明确包含对应指南指引
输出：自动化结果 + 真实入口交付结论
```

**自动化验证：**  
UT-01 到 UT-07

**交付测试影响：**  
DT-01、DT-02、DT-03

**完成标准：**  
自动化验证通过，真实入口可观察到“门禁拒绝时明确回看对应指南”的业务结果。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 方案确认态未返回修订指引结构 | 返回缺少 `document_revision_instruction` | 返回包含修订指引结构 |
| UT-02 | 计划确认态未返回修订指引结构 | 返回缺少 `document_revision_instruction` | 返回包含修订指引结构 |
| UT-03 | BUG 方案拒绝未指向 BUG 设计指南 | `guide_relative_path` 不存在或错误 | 返回 `docs/可交付BUG修改设计文档编写指南-v0.1.md` |
| UT-04 | 新增功能方案拒绝未指向开发设计指南 | `guide_relative_path` 不存在或错误 | 返回 `docs/可交付开发设计文档编写指南-v0.1.md` |
| UT-05 | BUG 计划拒绝未指向 BUG 计划指南 | `guide_relative_path` 不存在或错误 | 返回 `docs/可交付BUG修改计划编写指南-v0.1.md` |
| UT-06 | 新增功能计划拒绝未指向开发计划指南 | `guide_relative_path` 不存在或错误 | 返回 `docs/可交付开发计划编写指南-v0.1.md` |
| UT-07 | 实施前计划门禁失败没有复用统一指引 | 只有 `missing_sections`，没有指南路径 | 返回统一修订指引且路径正确 |

## 5. 自动化验证计划

1. 精准回归测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "guideline"
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts -t "implementation plan gate"
```

2. 相关模块测试：

```bash
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
```

3. 全量测试：

```bash
npm test
```

4. 编译或构建：

```bash
npm run build
npm run prepare:plugin
```

5. 插件或安装检查：

```bash
npm run plugin:install-local
codex plugin list
```

## 6. 真实业务交付测试计划

**真实入口：**

- 在本机真实环境安装当前插件。
- 刷新或重启 Codex 环境。
- 打开真实 Codex CLI。
- 使用自然语言触发团队委派流程，不允许直接调用内部 API 或 MCP 工具代替。

**操作步骤：**

1. 输入自然语言，让系统进入方案修订或计划修订场景，例如：
   - “帮我用团队委派流程完成这个 BUG 修复。设计文档如果还不合规，请明确告诉我应该回看哪份设计指南再修。”
   - “设计和计划已经确认，直接进入实施；如果计划不合规，请明确告诉我该按哪份计划指南修订。”
2. 观察拒绝反馈是否明确包含：
   - 当前业务阶段是方案修订还是计划修订；
   - 当前属于 BUG 修改还是新增功能；
   - 应回看的指南路径；
   - 下一步修订动作。
3. 分别覆盖 BUG 修改和新增功能至少各一条链路。

**通过标准：**

- 方案拒绝时，真实入口明确给出对应方案指南。
- 计划拒绝时，真实入口明确给出对应计划指南。
- BUG 修改与新增功能两类场景都不发生指南串错。
- 主会话看到拒绝后，可以直接继续修订，不再需要猜测该看哪套规范。

**失败后整改与再测试：**

- 如果真实入口仍只返回笼统缺项，记录当次输入、阶段、开发类型、实际返回文本和缺失字段。
- 回到单测补红灯，再修复反馈逻辑后，重走同一条真实 Codex CLI 链路。

## 7. 交付测试失败整改记录

- 失败场景：
  - 方案或计划文档被拒绝时，系统只说明不合规，但没有明确告诉主会话回看哪份指南。
- 输入数据：
  - “设计和计划已经确认，直接进入实施；如果计划不合规，请明确告诉我该按哪份计划指南修订。”
- 期望结果：
  - 返回明确的指南指引与下一步业务动作。
- 实际结果：
  - 只返回笼统缺项或阶段性拒绝，主会话仍需自行推断。
- 根因分析：
  - 拒绝出口未复用已存在的 `document_profile` 指南元数据。
- 修复方案：
  - 把指南元数据封装成统一文档修订指引，并接入三个拒绝出口。
- 复测命令：
  - `npm run test:unit -- tests/unit/bridge-service-workflow.test.ts`
  - 真实 Codex CLI 自然语言链路复测
- 复测结果：
  - 待实施后填写。

## 8. 设计完成核对清单

- [ ] 已为方案拒绝和计划拒绝分别建立统一修订指引。
- [ ] 已保证 BUG 修改与新增功能映射到不同指南。
- [ ] 已让实施前计划门禁失败复用同一指引。
- [ ] 已补红灯测试并验证转绿。
- [ ] 已完成自动化验证。
- [ ] 已完成真实入口交付测试。

## 9. 上下文恢复说明

- 当前进度：
  - 已完成整改设计与实施计划，下一步进入红灯测试编写。
- 下一步：
  1. 先在 `tests/unit/bridge-service-workflow.test.ts` 写失败测试。
  2. 再在 `src/session/bridge-service.ts` 实现统一文档修订指引。
  3. 跑自动化验证与真实入口交付测试。
- 恢复入口：
  - 先打开本计划与设计文档，再定位 `src/session/bridge-service.ts` 的设计/计划拒绝出口和 `tests/unit/bridge-service-workflow.test.ts` 中的相关断言。
