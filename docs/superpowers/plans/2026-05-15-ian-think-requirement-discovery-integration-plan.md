# ian-think 需求挖掘集成开发计划

## 1. 项目与目标

本计划为 `acp_codex2opencode` 插件新增“模糊需求先做需求挖掘”的业务能力。

目标：

1. 当用户只给一句话、上下文明显不足，或主会话判断不适合直接进入方案阶段时，先询问用户是否进入 `ian-think` 需求挖掘。
2. 将 `ian-think` 作为插件技能资产的一部分，随本地安装命令自动安装到 `~/.codex/skills/ian-think`。
3. 保持现有委派状态机不破坏：仍由 `need_user_input` 承接上下文不足，只增强用户可见业务引导。

本次不处理：

1. 不改 ACP 低层会话协议。
2. 不改 Design/Planning/Implementation 主状态流转。
3. 不改整改闭环与交付测试判定规则。

## 2. 范围与改动点

1. 技能侧：更新 `skills/team-delegate/SKILL.md`，在 `NEEDS_USER_INPUT` 分支新增“先询问是否进入 ian-think”的业务动作规范。
2. 服务侧：更新 `src/session/bridge-service.ts` 的 `buildNeedsUserInputResponse` 文案，使返回消息明确给出两类业务动作：
   - 进入 `ian-think` 需求挖掘
   - 直接补充上下文后重试
3. 分发侧：将 `ian-think` 纳入插件安装/卸载/打包校验脚本。
4. 文档侧：更新 README 与安装 runbook，说明 `ian-think` 自动安装与使用场景。
5. 测试侧：补充/调整安装与流程文案相关测试，确保打包产物、安装链路和提示语符合预期。

## 3. 交付完成定义

同时满足以下条件才算完成：

1. `plugin:install-local` 后，`~/.codex/skills/ian-think/SKILL.md` 存在，且场景文件完整。
2. 模糊需求路径下，插件 `NEEDS_USER_INPUT` 返回文案明确询问“是否进入需求挖掘（ian-think）”。
3. `team-delegate` skill 在 `NEEDS_USER_INPUT` 规则中明确要求主会话先询问该业务选择。
4. 原有 `team-delegate` 状态机相关单元测试不回归。
5. 插件安装与打包测试通过。

## 4. 自动化验证

至少执行：

```powershell
npm run test:unit -- tests/unit/bridge-service-workflow.test.ts
npm run test:plugin-install
npm run test:delivery -- tests/delivery/team-delegate-skill.delivery.test.ts
npm run build
npm run prepare:plugin
```

如命令失败：记录失败点 -> 修复 -> 复跑同一命令，直到通过。

## 5. 真实业务交付测试计划

真实入口必须按插件项目约定执行：

1. 运行 `npm run plugin:install-local` 安装插件与技能。
2. 重启 Codex CLI。
3. 用真实自然语言输入模糊需求，例如：
   - “帮我用团队委派流程做一个优化。”
   - “我有个想法，帮我推进一下。”
4. 观察是否先进入业务化询问：是否先走 `ian-think` 需求挖掘。
5. 选择“进入需求挖掘”后，验证后续可按需求挖掘产出再进入方案/计划链路。
6. 选择“直接补充上下文”后，验证流程停留在补充信息路径而不误入实施。

通过标准：

1. 用户无需使用内部工具名即可触发上述行为。
2. 模糊需求不被直接当成可实施任务推进。
3. 用户可理解当前业务阶段与下一步选择。

## 6. 失败整改与复测

若交付测试失败，必须记录：

1. 失败位置
2. 用户输入
3. 实际表现
4. 预期表现
5. 修复内容

修复后必须从“安装插件 -> 重启 CLI -> 自然语言输入模糊需求”完整链路重新复测。

## 7. 上下文恢复说明

若会话中断，恢复时优先读取本文件，然后按以下顺序继续：

1. 确认 `ian-think` 已纳入 skills 分发链路。
2. 确认 `NEEDS_USER_INPUT` 业务文案已包含需求挖掘询问。
3. 跑测试并执行真实入口交付测试。
