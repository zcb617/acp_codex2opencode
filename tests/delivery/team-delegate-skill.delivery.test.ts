import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("team-delegate skill delivery wording", () => {
  it("must stop following up when the restored workflow no longer offers continue_wait", async () => {
    const skill = await readFile("skills/team-delegate/SKILL.md", "utf8");

    expect(skill).toContain("如果 next_action_required 不包含 continue_wait");
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
  });
});
