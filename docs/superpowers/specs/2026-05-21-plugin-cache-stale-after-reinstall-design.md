# plugin 重装后仍加载旧缓存 BUG 修改设计文档

## 1. 问题摘要

团队委派插件已经在仓库内实现了“计划确认后先进入实施执行方选择”的业务规则，但用户在另一台电脑执行 `npm run plugin:install-local` 重新安装后，真实入口仍然表现为“计划确认后直接进入实施”。

这不是单一提示词问题，而是插件本地安装链路没有可靠刷新插件缓存，导致真实入口继续命中旧插件包。修复后，同版本或新版本的本地重装都必须稳定加载最新 `team-delegate` 规则，不能再出现“仓库已修复、真实入口仍执行旧流程”的交付断层。

## 2. 失败事实

- 触发入口：
  - 用户另一台电脑上的真实 Codex 使用环境。
  - 通过 `npm run plugin:install-local` 重新安装本地插件后，再从 Codex 自然语言入口进入团队委派流程。
- 用户输入：
  - 计划确认后继续推进实施的真实业务表达。
- 实际表现：
  - 计划确认后直接进入实施，没有先进入“实施执行方选择”。
- 预期表现：
  - 计划确认后应先进入“实施执行方选择”，只有用户明确选择 ACP 实施时才继续进入模型选择与实施闭环。
- 复现频率：
  - 已稳定复现。
- 关键证据：
  1. 用户在另一台电脑执行了 `npm run plugin:install-local` 后，缓存目录中的：
     - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/0.1.0/skills/team-delegate/SKILL.md`
     中，搜索不到
     - `计划确认后必须先选择实施执行方`
     - `只有用户明确选择 ACP 实施时才需要选择 ACP 执行模型`
  2. 当前仓库中的：
     - `skills/team-delegate/SKILL.md`
     - `~/.codex/skills/team-delegate/SKILL.md`
     已包含上述新规则。
  3. 当前仓库的：
     - `package.json`
     - `.codex-plugin/plugin.json`
     版本号都仍为 `0.1.0`。
  4. `scripts/install-local.mjs` 会重建 marketplace、重装全局 skill，但不会清理：
     - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`

## 3. 影响范围

### 3.1 受影响功能

- 本地插件安装与重装链路。
- `team-delegate` skill 的真实运行版本选择。
- 团队委派所有依赖 plugin cache 中 skill 内容的业务规则。

### 3.2 受影响用户动作

- 开发者在另一台电脑或已安装过旧版本的机器上执行 `npm run plugin:install-local`。
- 用户从 Codex 真实入口发起团队委派流程。
- 用户依赖最新业务规则进行方案、计划、实施分流验证。

### 3.3 不受影响范围

- 仓库内 `BridgeService` 状态机代码本身。
- 当前工作区中的 README、测试和 skill 源文件内容。
- 仅直接读取 `~/.codex/skills/team-delegate/SKILL.md` 的场景。

### 3.4 不修复的交付风险

- 同一份仓库代码在不同机器上得到不同的真实业务行为。
- 用户误以为“重新安装已生效”，实际真实入口仍执行旧规则。
- 后续所有依赖 plugin skill 更新的业务修复都可能在另一台机器继续失效。
- 交付测试结论失真：自动化测试通过，但真实入口仍运行旧包。

## 4. 根因分析

### 4.1 直接原因

本地安装脚本只重建 marketplace 和全局 skill 目录，没有清理 Codex 的插件缓存目录：

- `~/.codex/plugins/cache/acp-local/acp-codex2opencode/...`

当缓存目录中仍保留旧版 `0.1.0` plugin skill 时，真实入口会继续读取旧缓存内容，从而执行旧流程规则。

### 4.2 深层原因

当前本地安装链路对“插件缓存”和“全局 skill”做了不对称处理：

1. 全局 skill 每次重装都会覆盖。
2. plugin cache 没有被显式清理或强制刷新。
3. 插件版本号又没有变化，仍然是 `0.1.0`。

这会让“同版本号 + 残留缓存”的组合成为稳定风险：即使执行了重装命令，Codex 仍可能复用旧缓存目录，而不是重新生成新的 plugin 缓存内容。

### 4.3 为什么现有测试没有发现

- 现有安装契约测试只验证仓库内源文件、manifest、README 和全局 skill 内容，没有验证 `~/.codex/plugins/cache/...` 是否被刷新。
- 自动化测试没有覆盖“已安装旧版本 -> 再次执行本地安装 -> 真实入口加载到最新 plugin skill”的机器级重装链路。
- 版本号没有随业务规则变化递增，也没有测试约束“manifest 版本变化时安装链路如何表现”。

### 4.4 证据链

1. 仓库中的 `skills/team-delegate/SKILL.md` 已包含“实施执行方选择”规则。
2. 当前机器的 `~/.codex/skills/team-delegate/SKILL.md` 也已包含新规则。
3. plugin cache 中的 `~/.codex/plugins/cache/acp-local/acp-codex2opencode/0.1.0/skills/team-delegate/SKILL.md` 仍是旧规则。
4. `scripts/install-local.mjs` 没有删除 plugin cache 目录。
5. `package.json` 与 `.codex-plugin/plugin.json` 版本都仍为 `0.1.0`。
6. 另一台机器真实入口继续表现为“计划确认后直接进入实施”，与旧缓存规则一致。

## 5. 修复目标与非目标

### 5.1 修复目标

- `npm run plugin:install-local` 后，不能再继续复用旧的 plugin cache。
- `npm run plugin:uninstall-local` 后，不能遗留当前插件的旧缓存目录。
- `package.json` 和 `.codex-plugin/plugin.json` 版本同步递增，避免不同机器继续命中旧的 `0.1.0` 缓存路径。
- 安装链路文档和测试要明确覆盖“缓存刷新”这一交付约束。
- 真实入口在另一台电脑重装后，必须稳定进入“实施执行方选择”。

### 5.2 非目标

- 不改动 `BridgeService` 的实施执行方状态机。
- 不改动 `team-delegate` 业务规则正文。
- 不重构 marketplace 机制。
- 不扩展为通用的所有插件缓存治理框架，只修当前插件的本地安装可靠性。

## 6. 修复设计

### 6.1 安装链路变化

在 `scripts/install-local.mjs` 中新增 plugin cache 清理步骤，目标至少包含：

- `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`

执行顺序应在 marketplace 重建前或后保持确定性，但必须保证：

1. 清理旧 cache。
2. 重建 marketplace。
3. 重新安装或启用插件。
4. 重装全局 skills。

### 6.2 卸载链路变化

在 `scripts/uninstall-local.mjs` 中同步清理：

- `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`

这样即使用户先卸载再安装，也不会带着旧 cache 回来。

### 6.3 版本治理变化

同步提升：

- `package.json`
- `.codex-plugin/plugin.json`

版本号至少从 `0.1.0` 升到新的补丁版本。目标不是“靠 bump 代替清缓存”，而是把“缓存清理 + 版本递增”两层都补齐：

1. 清缓存解决当前机器上已有旧残留的问题。
2. 版本递增降低其他机器未来复用旧缓存的概率。

### 6.4 用户可见行为变化

- 用户重新安装后，不再需要手工删除 plugin cache 才能拿到最新流程。
- 计划确认后的真实入口行为会与仓库当前业务规则一致。
- runbook 中会明确说明安装完成后应如何验证 plugin cache 已刷新。

### 6.5 测试与文档变化

- 安装契约测试要补充版本同步检查。
- runbook 要补充 plugin cache 刷新与验证步骤。
- 如测试环境允许，增加对安装脚本缓存清理行为的断言；若不能直接跑用户家目录，则至少抽出路径构造/删除目标供自动化验证。

### 6.6 回退方案

- 若缓存清理步骤引入误删风险，可回退到仅对当前插件命名空间目录做精准删除。
- 若版本 bump 导致安装链路其它工具兼容问题，可单独回退版本号提交，但不能回退缓存清理设计。

## 7. 修改范围

- `scripts/install-local.mjs`：新增 plugin cache 清理。
- `scripts/uninstall-local.mjs`：新增 plugin cache 清理。
- `package.json`：版本号递增。
- `.codex-plugin/plugin.json`：版本号递增。
- `tests/plugin/install.plugin.test.ts`：补版本/安装契约断言。
- `docs/superpowers/runbooks/plugin-local-install.md`：补缓存刷新与验证说明。
- `docs/superpowers/specs/2026-05-21-plugin-cache-stale-after-reinstall-design.md`
- `docs/superpowers/plans/2026-05-21-plugin-cache-stale-after-reinstall-plan.md`

## 8. 自动化验证目标

- 验证版本号在 `package.json` 与 `.codex-plugin/plugin.json` 中保持同步。
- 验证安装契约测试仍通过。
- 验证卸载/安装脚本变更不会破坏已有本地安装流程。
- 全量测试、构建、prepare-plugin 仍保持通过。

## 9. 交付测试目标

- 真实环境：
  - 另一台已经安装过旧版 `0.1.0` 插件的电脑。
- 真实入口：
  1. 执行 `npm run plugin:install-local`
  2. 完全重启 Codex
  3. 从 Codex CLI 自然语言入口发起团队委派
- 真实业务语言：
  - “设计和计划已经确认，直接进入实施。”
- 同链路复测：
  1. 安装新版本插件。
  2. 检查 plugin cache 中的 `team-delegate/SKILL.md` 已包含“实施执行方选择”规则。
  3. 在 Codex CLI 中再次走“计划确认 -> 进入实施”链路。
  4. 验证真实入口先进入“实施执行方选择”，而不是直接进入实施。
- 通过标准：
  - 另一台电脑无需手工删除缓存，也能加载到新规则。
  - plugin cache 和全局 skill 内容一致。
  - 真实入口先进入“实施执行方选择”。
- 失败后继续整改闭环：
  - 记录新机器上的残留路径、版本号、真实入口表现；
  - 判断是 cache 清理不完整、版本路径仍冲突，还是 Codex 自身缓存机制还需补额外处理；
  - 更新设计/计划并继续修复。

## 10. 风险与回退

- 风险：
  - 若 cache 清理路径写得过宽，可能误删不属于当前插件的目录。
  - 若只 bump 版本、不清 cache，当前问题仍会继续存在。
  - 若只清 cache、不 bump 版本，未来跨机安装仍可能重复踩坑。
- 控制措施：
  - 只删除当前插件命名空间目录：
    - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`
  - 把“版本同步 + cache 清理”做成同一交付包。
- 回退路径：
  - 回退缓存清理实现时，必须保留精准删除边界；
  - 不能回退到“继续依赖用户手工删缓存”的方案。

## 11. 上下文恢复说明

- 当前已经确认：这不是状态机代码未生效，而是另一台机器在执行 `npm run plugin:install-local` 后仍命中了旧 plugin cache。
- 当前最关键的技术缺口有两个：
  1. 安装/卸载脚本不清理 `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`
  2. 插件版本号仍停在 `0.1.0`
- 下一步应做：
  1. 写计划文档；
  2. 用户确认后修改安装/卸载脚本、版本号、测试和 runbook；
  3. 在真实另一台电脑上复测同链路。
