# plugin 重装后仍加载旧缓存 BUG 修改计划

## 1. Bug 与设计来源

- Bug 名称：
  - `npm run plugin:install-local` 后仍命中旧 plugin cache，导致真实入口继续执行旧 skill 规则
- 设计文档：
  - `docs/superpowers/specs/2026-05-21-plugin-cache-stale-after-reinstall-design.md`
- 当前失败链路：
  1. 另一台电脑曾安装过 `acp-codex2opencode@0.1.0`
  2. 用户执行 `npm run plugin:install-local`
  3. 真实入口仍读取旧 plugin cache 中的 `team-delegate/SKILL.md`
  4. 计划确认后直接进入实施，而不是先进入实施执行方选择
- 本计划目标：
  - 让本地重装能够稳定刷新 plugin cache
  - 同步提高插件版本号
  - 让另一台电脑的真实入口稳定执行新规则
- 本计划不处理：
  - `BridgeService` 业务状态机逻辑调整
  - `team-delegate` 正文规则重写

## 2. 设计目标覆盖表

| 设计目标 | 实施任务 | 自动化验证 | 交付测试验证 | 状态 |
|---|---|---|---|---|
| `plugin:install-local` 后不再复用旧 plugin cache | Task 01, Task 03 | UT-01, UT-02 | DT-01 | 待实施 |
| `plugin:uninstall-local` 后不再遗留当前插件 cache | Task 01, Task 03 | UT-01 | DT-01 | 待实施 |
| `package.json` 与 `.codex-plugin/plugin.json` 版本同步递增 | Task 02 | UT-02 | DT-01 | 待实施 |
| 安装文档和契约明确覆盖 cache 刷新 | Task 03 | UT-03 | DT-01 | 待实施 |
| 另一台电脑真实入口恢复“实施执行方选择” | Task 04 | 自动化全量通过 | DT-02 | 待实施 |

## 3. 实施任务拆分

### Task 01: 修复安装/卸载脚本的 plugin cache 清理链路

**业务目标：**

让用户在执行安装或卸载命令时，不再保留当前插件的旧缓存目录。

**对应设计目标：**

- `plugin:install-local` 后不再复用旧 plugin cache
- `plugin:uninstall-local` 后不再遗留当前插件 cache

**修改范围：**

- `scripts/install-local.mjs`
- `scripts/uninstall-local.mjs`

**实施步骤：**

1. 定位当前插件在 Codex 下的 cache 根路径。
2. 在安装脚本中加入当前插件 cache 目录删除步骤。
3. 在卸载脚本中加入相同目录的删除步骤。
4. 删除边界只限定在：
   - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/`
5. 保持现有 marketplace、config、global skills 流程不变。

**伪代码：**

```text
输入：homeDir + pluginName + marketplaceName
cacheRoot = ~/.codex/plugins/cache/acp-local/acp-codex2opencode
if cacheRoot exists:
  remove cacheRoot recursively
继续执行 marketplace remove/add or uninstall flow
输出：旧 plugin cache 已清理，后续安装不会复用旧 skill 包
```

**自动化验证：**

- 通过安装相关测试与脚本静态检查确认路径和流程正确。

**交付测试影响：**

- 这是另一台电脑能否真正加载新规则的前置门禁。

**完成标准：**

- 安装/卸载脚本都包含当前插件 cache 清理步骤。
- 删除边界精准，不扩散到其它插件目录。

### Task 02: 同步提升插件版本号并固化版本一致性

**业务目标：**

避免不同机器继续命中旧的 `0.1.0` 缓存路径，同时把版本同步做成安装契约的一部分。

**对应设计目标：**

- `package.json` 与 `.codex-plugin/plugin.json` 版本同步递增

**修改范围：**

- `package.json`
- `.codex-plugin/plugin.json`
- `tests/plugin/install.plugin.test.ts`

**实施步骤：**

1. 选择新的补丁版本号。
2. 同步更新 `package.json` 与 `.codex-plugin/plugin.json`。
3. 在安装契约测试中增加两处版本一致性断言。

**伪代码：**

```text
输入：packageJson.version + pluginManifest.version
newVersion = bump patch version
write packageJson.version = newVersion
write pluginManifest.version = newVersion
assert packageJson.version == pluginManifest.version
输出：版本递增且两处一致
```

**自动化验证：**

- 安装契约测试新增版本一致性断言。

**交付测试影响：**

- 让另一台电脑在重装时不再继续沿用 `0.1.0` 的旧缓存路径。

**完成标准：**

- 两处版本号一致。
- 测试会在未来版本不同步时直接红灯。

### Task 03: 更新安装契约与 runbook

**业务目标：**

把“重装必须刷新 plugin cache”写进项目的可交付规则，而不是靠口头经验。

**对应设计目标：**

- 安装文档和契约明确覆盖 cache 刷新

**修改范围：**

- `tests/plugin/install.plugin.test.ts`
- `docs/superpowers/runbooks/plugin-local-install.md`

**实施步骤：**

1. 在 runbook 中补充 plugin cache 刷新说明。
2. 写明安装后如何验证 cache 中 skill 已更新。
3. 补充测试断言，确保 runbook 与安装契约包含这部分内容。

**伪代码：**

```text
输入：runbook text + install contract test
append cache refresh steps to runbook
append validation step for cached team-delegate SKILL
assert docs/test contain cache refresh wording
输出：安装说明和测试都覆盖 cache 刷新
```

**自动化验证：**

- `tests/plugin/install.plugin.test.ts`

**交付测试影响：**

- 让执行人知道怎样验证另一台电脑已真正加载新规则。

**完成标准：**

- runbook 明确写出 cache 路径、刷新行为和验证方法。
- 对应测试通过。

### Task 04: 真实业务交付测试复测另一台电脑同链路

**业务目标：**

证明这次修复不是当前仓库自洽，而是另一台已装旧版的机器也能恢复到正确的真实入口行为。

**对应设计目标：**

- 另一台电脑真实入口恢复“实施执行方选择”

**修改范围：**

- 真实环境复测证据

**实施步骤：**

1. 在另一台电脑执行新的 `npm run plugin:install-local`。
2. 完全重启 Codex。
3. 检查 plugin cache 中的 `team-delegate/SKILL.md` 是否包含新规则。
4. 从真实 Codex CLI 入口输入：
   - “设计和计划已经确认，直接进入实施。”
5. 验证是否先进入“实施执行方选择”。

**伪代码：**

```text
输入：另一台旧环境机器
run plugin:install-local
restart Codex
verify cached team-delegate SKILL contains implementation executor text
run natural-language implementation entry
if first stage == NEEDS_IMPLEMENTATION_EXECUTOR:
  pass
else:
  record failure and continue remediation
```

**自动化验证：**

- 以自动化测试通过作为前置门禁，不替代真实复测。

**交付测试影响：**

- 这是本 BUG 是否真正恢复可交付的最终判断依据。

**完成标准：**

- 另一台电脑不需要手工删 cache，也能先进入“实施执行方选择”。

## 4. TDD 与红灯测试计划

| 测试编号 | 覆盖失败 | 红灯表现 | 修复后绿灯标准 |
|---|---|---|---|
| UT-01 | 安装/卸载链路未覆盖 plugin cache 清理 | 脚本文本或行为中找不到 cache 清理目标 | 安装/卸载脚本都包含当前插件 cache 清理 |
| UT-02 | 两处版本号仍停留或不同步 | manifest/version 不一致或未递增 | `package.json` 与 `.codex-plugin/plugin.json` 版本一致且已 bump |
| UT-03 | runbook 未说明 cache 刷新与验证 | 文档中找不到 cache 验证步骤 | runbook 与安装契约明确包含 cache 刷新和验证 |

## 5. 自动化验证计划

1. 精准回归：

```bash
npm run test:plugin-install
```

证明安装契约、runbook、manifest、skill 包装规则仍然成立。

2. 全量验证：

```bash
npm test
```

证明本次修改没有破坏已有委派能力。

3. 构建与打包检查：

```bash
npm run build
npm run prepare:plugin
```

证明插件构建与打包检查仍可通过。

4. 本地安装检查：

```bash
npm run plugin:install-local
codex plugin list
```

证明本机安装链路仍正常。

## 6. 真实业务交付测试计划

### DT-01: 另一台电脑重装后 plugin cache 刷新验证

**业务目标：**

证明用户执行重装命令后，不再继续命中旧缓存。

**真实环境：**

- 另一台曾安装过 `acp-codex2opencode@0.1.0` 的电脑。

**真实入口：**

- 终端执行 `npm run plugin:install-local`

**用户语言：**

```text
重新安装这个插件，然后我继续用团队委派流程跑实施入口。
```

**前置准备：**

1. 保留该机器原有旧环境，不手工删 cache。
2. 使用修复后的仓库执行安装命令。

**操作步骤：**

1. 执行 `npm run plugin:install-local`
2. 完全重启 Codex
3. 检查：
   - `~/.codex/plugins/cache/acp-local/acp-codex2opencode/.../skills/team-delegate/SKILL.md`
4. 确认其中包含：
   - `计划确认后必须先选择实施执行方`
   - `只有用户明确选择 ACP 实施时才需要选择 ACP 执行模型`

**期望用户可见结果：**

- 用户无需手工删除 cache，就能得到最新 plugin skill。

**辅助证据：**

- cache 文件内容
- 安装命令输出

**失败判定：**

- cache 文件仍是旧规则，直接判失败。

**失败后整改动作：**

- 记录残留路径、版本号与安装输出；
- 回到设计/计划补充新的缓存来源分析。

### DT-02: 计划确认后的真实入口复测

**业务目标：**

证明另一台电脑的真实入口已恢复到正确业务流程。

**真实环境：**

- 完成 DT-01 后的同一台电脑。

**真实入口：**

- Codex CLI 自然语言团队委派入口。

**用户语言：**

```text
设计和计划已经确认，直接进入实施。
```

**操作步骤：**

1. 从 Codex CLI 输入上述业务语言。
2. 观察计划确认后的首个业务阶段。

**期望用户可见结果：**

- 首先进入“实施执行方选择”。
- 不会直接进入实施。

**辅助证据：**

- CLI 截图或日志

**失败判定：**

- 如果仍然直接进入实施，判失败。

**失败后整改动作：**

- 记录当前 cache 内容、manifest 版本、真实入口输出；
- 判断是否还有未清理的 cache 来源或 Codex 侧缓存层。

## 7. 交付测试失败整改记录

初始状态：待执行。

若另一台电脑复测失败，必须追加：

- 新失败事实
- 失败机器的路径证据
- 是否属于当前缓存刷新闭环
- 新增整改任务
- 再次复测结果

## 8. 设计完成核对清单

- [ ] 已补安装脚本 plugin cache 清理
- [ ] 已补卸载脚本 plugin cache 清理
- [ ] 已同步 bump `package.json` 与 `.codex-plugin/plugin.json`
- [ ] 已补安装契约测试
- [ ] 已补 runbook cache 刷新与验证说明
- [ ] 自动化测试通过
- [ ] 本机安装链路通过
- [ ] 另一台电脑真实入口先进入“实施执行方选择”
