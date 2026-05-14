import { z } from "zod";

const MAX_TIMEOUT_MS = 86_400_000;

export const InitSessionSchema = z.object({
  workspace_path: z.string().min(1),
  session_alias: z.string().min(1),
  session_strategy: z.enum(["auto", "new", "load", "resume"]).optional(),
  preferred_model: z.string().optional(),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const RunTurnSchema = z.object({
  bridge_session_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  prompt_text: z.string().min(1),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const ReworkTurnSchema = z.object({
  bridge_session_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  rework_prompt_text: z.string().min(1),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const SetConfigSchema = z.object({
  bridge_session_id: z.string().min(1),
  config_id: z.string().min(1),
  value: z.string().min(1),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const CancelSchema = z.object({
  bridge_session_id: z.string().min(1),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const CloseSchema = z.object({
  bridge_session_id: z.string().min(1),
  force: z.boolean().optional(),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const ExecuteTaskSchema = z.object({
  workspace_path: z.string().min(1),
  requirement_text: z.string().min(1),
  session_alias: z.string().min(1).optional(),
  design_planning_executor: z.enum(["main", "acp"]).optional(),
  development_type: z.enum(["feature", "bugfix", "need_user_input"]).optional(),
  development_type_reason: z.string().min(1).optional(),
  development_type_evidence: z.array(z.string().min(1)).optional(),
  model_confirm_choice: z.enum(["use_saved_model", "select_new_model"]).optional(),
  selected_model: z.string().min(1).optional(),
  start_phase: z.enum(["design", "planning", "implementation", "need_user_input"]).optional(),
  start_phase_reason: z.string().min(1).optional(),
  start_phase_evidence: z.array(z.string().min(1)).optional(),
  missing_context: z.array(z.string().min(1)).optional(),
  action: z
    .enum([
      "start",
      "model_confirm",
      "model_select",
      "status",
      "continue_wait",
      "handoff_to_main",
      "design_feedback",
      "design_approve",
      "planning_feedback",
      "planning_approve",
      "delivery_test_pass",
      "delivery_test_fail",
      "remediation_approve",
      "cancel_follow_up"
    ])
    .optional(),
  feedback_text: z.string().min(1).optional(),
  preferred_model: z.string().min(1).optional(),
  acceptance_criteria: z.string().min(1).optional(),
  max_rework_rounds: z.number().int().min(0).max(10).optional(),
  auto_close: z.boolean().optional(),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
}).superRefine((value, ctx) => {
  const action = value.action ?? "start";
  if (action !== "start" && !value.session_alias) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["session_alias"],
      message: "非 start 动作必须提供 session_alias"
    });
  }
  const needsFeedback = action === "design_feedback" || action === "planning_feedback";
  if (needsFeedback && !value.feedback_text?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feedback_text"],
      message: "反馈动作必须提供 feedback_text"
    });
  }
  if (action === "delivery_test_fail" && !value.feedback_text?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feedback_text"],
      message: "交付测试失败时必须提供失败材料"
    });
  }
  if (action === "model_confirm" && !value.model_confirm_choice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["model_confirm_choice"],
      message: "model_confirm 动作必须提供 model_confirm_choice"
    });
  }
  if (action === "model_select" && !value.selected_model?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selected_model"],
      message: "model_select 动作必须提供 selected_model"
    });
  }
});
