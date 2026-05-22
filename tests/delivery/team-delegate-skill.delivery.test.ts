import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("team-delegate skill delivery wording", () => {
  it("must describe continuing an existing delegated session on approval-only replies", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("continue previous delegated session with rework");
    expect(skill).toContain("继续已有委派会话");
    expect(skill).toContain("用户在方案/计划执行方选择节点只回复 `1/2`");
    expect(skill).toContain("用户在确认节点只回复 `可以/同意/确认`");
    expect(skill).toContain("这些都必须视为“继续当前委派任务”");
    expect(skill).toContain("后续调用必须继续携带同一个 `workspace_path`");
    expect(skill).toContain("action\": \"planning_approve\"");
    expect(skill).toContain("action\": \"implementation_executor_select\"");
    expect(skill).toContain("\"workspace_path\": \"<当前工作目录>\"");
    expect(skill).toContain("\"session_alias\": \"<同一任务别名>\"");
  });

  it("must stop following up when the restored workflow no longer offers continue_wait", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("当前仍是运行态且 next_action_required 包含 status");
    expect(skill).toContain("继续持续跟进");
    expect(skill).toContain("只有进入非运行态");
    expect(skill).toContain("NEEDS_USER_DECISION 且 next_action_required 不包含 continue_wait");
    expect(skill).toContain("必须停止持续跟进");
    expect(skill).toContain("输出 user_message");
    expect(skill).toContain("继续已委派任务");
    expect(skill).toContain("优先调用 `action=continue_wait`");
    expect(skill).toContain("禁止把继续任务当成新任务重新 `start`");
  });

  it("must require main-dialog development type judgement before start", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("开发类型");
    expect(skill).toContain("development_type");
    expect(skill).toContain("feature");
    expect(skill).toContain("bugfix");
    expect(skill).toContain("need_user_input");
    expect(skill).toContain("禁止在插件内部通过关键词穷举判断开发类型");
    expect(skill).toContain("BUG 修改必须使用 BUG 修改设计和计划指南");
    expect(skill).toContain("询问用户是否进入 `ian-think` 需求挖掘");
    expect(skill).toContain("满足以下任一条件");
    expect(skill).toContain("输入仅为“方法论文档/参考资料 + 一句话目标”");
    expect(skill).toContain("输入仅为“纯一句话新增需求”");
    expect(skill).toContain("缺少最小业务信息");
    expect(skill).toContain("先任务定位，再判断是否需要需求深挖，再决定是否进入方案");
    expect(skill).toContain("不得直接进入 `design`");
    expect(skill).toContain("先判断这是“现有功能升级”还是“新功能开发”");
    expect(skill).toContain("反例（必须判为 `need_user_input`");
    expect(skill).toContain("我给你一个方法论，再补一句‘按这个思路加 AI 功能’。");
    expect(skill).toContain("参考这份资料，帮我优化一下插件。");
    expect(skill).toContain("我要增加一个翻译功能，比如翻译截图里的文字，翻译当前选中行的文字。");
  });

  it("must read plugin-owned guide docs instead of project docs", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("必须读取本 skill 自带 `docs/` 目录里的对应指南");
    expect(skill).toContain("禁止把用户项目目录下的 `docs/` 或 `docs/superpowers/` 当成插件指南");
    expect(skill).toContain("新增功能方案读取 `docs/可交付开发设计文档编写指南-v0.1.md`");
    expect(skill).toContain("BUG 修改计划读取 `docs/可交付BUG修改计划编写指南-v0.1.md`");
  });

  it("must require design and planning outputs to be markdown files", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("方案/计划必须落成文件");
    expect(skill).toContain("required_output_document.relative_path");
    expect(skill).toContain("docs/superpowers/specs/<YYYY-MM-DD>-<session_alias>-design.md");
    expect(skill).toContain("docs/superpowers/plans/<YYYY-MM-DD>-<session_alias>-plan.md");
    expect(skill).toContain("不得只在聊天回复中输出方案/计划正文");
  });

  it("must require planning to use the matched design source", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("计划必须对齐方案来源");
    expect(skill).toContain("把该方案文件路径写入 `requirement_text`");
    expect(skill).toContain("source_type=design_document_path");
    expect(skill).toContain("source_type=inline_design_from_requirement");
    expect(skill).toContain("不得另造方案");
  });

  it("must enforce confirmation loops for main-session design and planning docs", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("必须先停住等待用户选择执行方");
    expect(skill).toContain("禁止静默按默认 1 继续");
    expect(skill).toContain("请直接回复 `1` 或 `2`");
    expect(skill).toContain("方案确认");
    expect(skill).toContain("计划确认");
    expect(skill).toContain("design_complete");
    expect(skill).toContain("planning_complete");
    expect(skill).toContain("必须调用 `design_complete` 回填插件状态机");
    expect(skill).toContain("必须调用 `planning_complete` 回填插件状态机");
    expect(skill).toContain("如无补充请回复“可以/同意/确认”");
    expect(skill).toContain("确认类判定");
    expect(skill).toContain("补充类判定");
    expect(skill).toContain("修订同一份文档并再次发起确认");
    expect(skill).toContain("直到用户给出确认类回复");
    expect(skill).toContain("必须在原文档上增量修订");
    expect(skill).toContain("绝对禁止重写整篇文档");
    expect(skill).toContain("禁止通过新建“v2/新版”文档替代原文档");
    expect(skill).toContain("保持同一路径文件不变");
    expect(skill).toContain("保留已确认内容与章节结构");
  });

  it("must require pre-design node-by-node workflow analysis before writing design documents", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("写方案前前置梳理节点流");
    expect(skill).toContain("每个节点都必须逐个说明");
    expect(skill).toContain("现有功能升级");
    expect(skill).toContain("新功能开发");
    expect(skill).toContain("从本次任务涉及功能中去代码库查找现有代码");
    expect(skill).toContain("所有当前代码中的业务流程");
    expect(skill).toContain("修改后流程如何变化");
    expect(skill).toContain("按功能点分类");
    expect(skill).toContain("所有异常控制点");
    expect(skill).toContain("什么情况下触发");
    expect(skill).toContain("异常流程如何流转");
    expect(skill).toContain("用户确认/补充");
    expect(skill).toContain("修订回环");
    expect(skill).toContain("持续到用户明确确认为止");
    expect(skill).toContain("仅当节点 5 得到确认类回复后，才允许编制方案并写入");
  });

  it("must require timeout-default decisions to preserve user choice and reset counts correctly", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("allow_timeout_default");
    expect(skill).toContain("decision_source=timeout_default");
    expect(skill).toContain("decision_source=user_selected");
    expect(skill).toContain("主会话先提示用户二选一并停住等待用户输入");
    expect(skill).toContain("真实的后续唤醒");
    expect(skill).toContain("线程 heartbeat");
    expect(skill).toContain("automation_update");
    expect(skill).toContain("kind=heartbeat");
    expect(skill).toContain("destination=thread");
    expect(skill).toContain("重新调用 `status`");
    expect(skill).toContain("当前真实 Codex CLI 会话还能继续运行");
    expect(skill).toContain("在当前轮保留这 60 秒窗口");
    expect(skill).toContain("禁止结束当前轮后再靠人工补触发");
    expect(skill).toContain("用户明确选择");
    expect(skill).toContain("ACP 返回任意新进展");
    expect(skill).toContain("清空该计数");
    expect(skill).toContain("不是同一个机制");
    expect(skill).toContain("取消上一条默认继续用的后续唤醒");
  });

  it("must require real auto-follow-up instead of verbal promises", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("当前轮第一优先动作");
    expect(skill).toContain("优先调用 `automation_update`");
    expect(skill).toContain("当前真实 Codex CLI 会话");
    expect(skill).toContain("不得结束当前轮");
    expect(skill).toContain("同一个任务闭环");
    expect(skill).toContain("用户手动补发消息");
    expect(skill).toContain("手动再点一次");
    expect(skill).toContain("既没有 heartbeat 能力，也无法把当前轮保活");
    expect(skill).toContain("当前环境无法建立真实自动跟进");
    expect(skill).toContain("交付测试判为失败");
    expect(skill).toContain("follow_up_runtime_requirement");
    expect(skill).toContain("current_turn_must_stay_open_without_heartbeat");
    expect(skill).toContain("hold_until");
    expect(skill).toContain("post_recheck_timeout_default_action");
  });

  it("must stay quiet while same-turn hold waits without new progress", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("progress_update.has_new_output");
    expect(skill).toContain("same-turn-hold 保活等待窗口");
    expect(skill).toContain("不得额外输出");
    expect(skill).toContain("持续跟进中");
    expect(skill).toContain("仍在等待");
    expect(skill).toContain("我会继续跟进");
    expect(skill).toContain("保持安静");
    expect(skill).toContain("进入 `NEEDS_USER_DECISION`");
  });

  it("must require main session to write remediation plan before ACP fixes delivery failures", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("交付测试失败必须由主会话制定整改方案和整改计划");
    expect(skill).toContain("ACP 不负责制定该方案");
    expect(skill).toContain("必须把完整整改方案和整改计划放入 `feedback_text`");
    expect(skill).toContain("ACP 只执行整改实施");
  });

  it("must preserve task_id and expose the ACP session recovery decision", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("task_id");
    expect(skill).toContain("同一个 `task_id`");
    expect(skill).toContain("NEEDS_ACP_SESSION_DECISION");
    expect(skill).toContain("cancel_follow_up");
    expect(skill).toContain("不能静默启动新的 ACP 会话");
  });
});
