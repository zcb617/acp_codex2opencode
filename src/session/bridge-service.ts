import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { Logger } from "../observability/logger.js";
import { AcpProcessSupervisor } from "../process/acp-process-supervisor.js";
import { newBridgeSessionId, newEventId, newRequestId, newTurnId, hashPrompt } from "../shared/ids.js";
import { ErrorCodes } from "../shared/error-codes.js";
import type { ErrorCode } from "../shared/error-codes.js";
import { BridgeError } from "../shared/errors.js";
import type {
  BridgeResult,
  DelegateAuditRecord,
  DelegateSessionRecord,
  DelegateTurnRecord,
  DelegateWorkflowRecord,
  TokenUsage
} from "../shared/types.js";
import { NdjsonTransport } from "../acp-client/ndjson-transport.js";
import { JsonRpcClient } from "../acp-client/jsonrpc-client.js";
import { AcpSessionApi } from "../acp-client/session-api.js";
import { SqliteStore } from "../store/sqlite.js";

type SessionStrategy = "auto" | "new" | "load" | "resume";

export interface InitSessionInput {
  workspace_path: string;
  session_alias: string;
  session_strategy?: SessionStrategy;
  preferred_model?: string;
  timeout_ms?: number;
}

export interface RunTurnInput {
  bridge_session_id: string;
  idempotency_key: string;
  prompt_text: string;
  timeout_ms?: number;
}

export interface ReworkTurnInput {
  bridge_session_id: string;
  idempotency_key: string;
  rework_prompt_text: string;
  timeout_ms?: number;
}

export interface SetConfigInput {
  bridge_session_id: string;
  config_id: string;
  value: string;
  timeout_ms?: number;
}

export interface CancelInput {
  bridge_session_id: string;
  timeout_ms?: number;
}

export interface CloseInput {
  bridge_session_id: string;
  force?: boolean;
  timeout_ms?: number;
}

export interface ExecuteTaskInput {
  workspace_path: string;
  requirement_text: string;
  task_id?: string;
  session_alias?: string;
  design_planning_executor?: DesignPlanningExecutor;
  development_type?: DevelopmentType | "need_user_input";
  development_type_reason?: string;
  development_type_evidence?: string[];
  model_confirm_choice?: "use_saved_model" | "select_new_model";
  selected_model?: string;
  start_phase?: WorkflowEntryPhase | "need_user_input";
  start_phase_reason?: string;
  start_phase_evidence?: string[];
  missing_context?: string[];
  action?: ExecuteTaskAction;
  decision_source?: ContinueWaitDecisionSource;
  feedback_text?: string;
  preferred_model?: string;
  acceptance_criteria?: string;
  max_rework_rounds?: number;
  auto_close?: boolean;
  timeout_ms?: number;
}

export type ExecuteTaskAction =
  | "start"
  | "model_confirm"
  | "model_select"
  | "status"
  | "continue_wait"
  | "handoff_to_main"
  | "design_feedback"
  | "design_approve"
  | "planning_feedback"
  | "planning_approve"
  | "delivery_test_pass"
  | "delivery_test_fail"
  | "remediation_approve"
  | "restart_acp_session"
  | "cancel_follow_up";

type ContinueWaitDecisionSource = "user_selected" | "timeout_default";

type WorkflowStage =
  | "RUNNING_DESIGN"
  | "WAITING_DESIGN_APPROVAL"
  | "RUNNING_PLANNING"
  | "WAITING_PLAN_APPROVAL"
  | "RUNNING_IMPLEMENTATION"
  | "NEEDS_DELIVERY_TEST"
  | "DELIVERY_TEST_FAILED"
  | "RUNNING_REMEDIATION"
  | "NEEDS_ACP_SESSION_DECISION"
  | "NEEDS_REMEDIATION_DECISION"
  | "NEEDS_USER_DECISION"
  | "TRANSFERRED_TO_MAIN"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

type WorkflowPhase = "design" | "planning" | "implementation" | "rework";
type WorkflowEntryPhase = "design" | "planning" | "implementation";
type DesignPlanningExecutor = "main" | "acp";
type DevelopmentType = "feature" | "bugfix";

interface WorkflowEntryDetection {
  phase: WorkflowEntryPhase | "need_user_input";
  evidence: string[];
  missingContext: string[];
  mergedRequirementText?: string;
}

interface WorkflowEntryModelDecision {
  phase: WorkflowEntryPhase | "need_user_input";
  missingContext: string[];
  reason?: string;
}

interface StartPhaseDecision {
  phase: WorkflowEntryPhase | "need_user_input";
  evidence: string[];
  missingContext: string[];
}

interface DevelopmentTypeDecision {
  type: DevelopmentType | "need_user_input";
  evidence: string[];
  missingContext: string[];
}

interface ModelPreferenceStore {
  version: 1;
  workspaces: Record<string, { model: string; updated_at: string }>;
}

interface WorkflowStep {
  phase: WorkflowPhase;
  turn_id?: string;
  stop_reason?: string;
  summary?: string;
  success: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

interface WorkflowProgressDelta {
  hasNewOutput: boolean;
  text: string;
  eventCount: number;
  turnId?: string;
  latestEventSeq?: number;
}

interface WorkflowProgressUpdate extends WorkflowProgressDelta {
  observedAt: string;
}

interface WorkflowGateState {
  passed: boolean;
  attempts: number;
  missingSections: string[];
}

interface TaskWorkflowState {
  workflowId: string;
  taskId: string;
  sessionAlias: string;
  workspacePath: string;
  bridgeSessionId: string;
  activeModel?: string;
  activeAgentMode?: "plan" | "build";
  fallbackModels: string[];
  requirementText: string;
  detectedStartPhase: WorkflowEntryPhase;
  detectionEvidence: string[];
  developmentType: DevelopmentType;
  developmentTypeEvidence: string[];
  acceptanceCriteria?: string;
  maxReworkRounds: number;
  autoClose: boolean;
  timeoutMs?: number;
  syncWaitMs: number;
  stage: WorkflowStage;
  activePhase?: WorkflowPhase;
  activePhaseStartedAt?: string;
  lastCompletedAt?: string;
  pendingTask?: Promise<void>;
  restoredWithoutRunner?: boolean;
  lastError?: { code: string; message: string; retryable: boolean };
  completedPayload?: Record<string, unknown>;
  deliveryTestPassed?: boolean;
  deliveryTestResult?: string;
  deliveryTestFailures: string[];
  remediationRound: number;
  pendingRemediationPlan?: string;
  lastImplementationResult?: Record<string, unknown>;
  handoffRequested?: boolean;
  pollIntervalMs: number;
  pollIntervalMinMs: number;
  pollIntervalMaxMs: number;
  silenceDecisionMs: number;
  currentPollCount: number;
  currentPollCycle: number;
  consecutiveTimeoutDefaultContinueCount: number;
  lastCountedPollAtMs?: number;
  nextPollDueAtMs?: number;
  lastProgressAtMs?: number;
  lastProgressAt?: string;
  userDecisionPromptedAtMs?: number;
  userDecisionPromptedAt?: string;
  userDecisionTimeoutAtMs?: number;
  userDecisionTimeoutAt?: string;
  lastTimeoutDefaultAutoContinueAtMs?: number;
  lastTimeoutDefaultAutoContinueAt?: string;
  progressCursorByTurn: Record<string, number>;
  lastProgressUpdate?: WorkflowProgressUpdate;
  phaseGates: {
    design?: WorkflowGateState;
    planning?: WorkflowGateState;
  };
  steps: WorkflowStep[];
  idempotencySeq: number;
}

export interface BridgeRuntimeOptions {
  opencodeBinPath: string;
  stateDir: string;
  turnTimeoutMs: number;
  workflowSyncWaitMs?: number;
  allowedWorkspaces?: string[];
  mcpServers?: string[];
}

function now(): string {
  return new Date().toISOString();
}

function currentDateStamp(): string {
  return now().slice(0, 10);
}

function toDocumentSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\s]+/gu, "-")
    .replace(/[^-\p{L}\p{N}_]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return slug || fallback;
}

function buildPhaseDocumentOutput(
  phase: "design" | "planning",
  sessionAlias: string,
  workspacePath?: string
): { absolutePath?: string; relativePath: string } {
  const directory = phase === "design" ? "docs/superpowers/specs" : "docs/superpowers/plans";
  const suffix = phase === "design" ? "design" : "plan";
  const relativePath = `${directory}/${currentDateStamp()}-${toDocumentSlug(sessionAlias, "team-delegate")}-${suffix}.md`;
  return {
    relativePath,
    absolutePath: workspacePath ? join(workspacePath, ...relativePath.split("/")) : undefined
  };
}

function buildDocumentOutputPromptLines(
  phase: "design" | "planning",
  sessionAlias: string,
  workspacePath: string
): string[] {
  const output = buildPhaseDocumentOutput(phase, sessionAlias, workspacePath);
  const label = phase === "design" ? "设计文档" : "计划文档";
  return [
    "文档输出要求：",
    `- 必须创建或更新 ${label} Markdown 文件：${output.relativePath}`,
    `- 绝对路径：${output.absolutePath}`,
    `- 必须把完整${label}正文写入上述文件，不允许只在对话里输出一段方案或计划文字。`,
    "- 最终回复只输出文件路径、简短摘要和状态行；不要把完整文档正文粘贴到对话里。"
  ];
}

function makeResult<T>(requestId: string, data: T): BridgeResult<T> {
  return {
    request_id: requestId,
    success: true,
    data
  };
}

function makeError<T>(requestId: string, error: BridgeError): BridgeResult<T> {
  return {
    request_id: requestId,
    success: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    }
  };
}

function normalizeUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const readNumber = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;

  return {
    inputTokens: readNumber(obj.inputTokens) ?? readNumber(obj.input_tokens),
    outputTokens: readNumber(obj.outputTokens) ?? readNumber(obj.output_tokens),
    thoughtTokens: readNumber(obj.thoughtTokens) ?? readNumber(obj.thought_tokens)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FEATURE_DESIGN_REQUIRED_SECTIONS = [
  "背景与目标",
  "非目标",
  "范围与术语",
  "架构与模块职责",
  "技术选型与约束",
  "API 契约",
  "数据模型",
  "主流程与状态机",
  "异常处理策略矩阵",
  "幂等与去重规则",
  "测试策略",
  "验收标准",
  "发布与回滚 Runbook",
  "SLO 与告警",
  "环境配置矩阵",
  "开发实施规范"
];

const FEATURE_PLANNING_REQUIRED_SECTIONS = [
  "项目与目标",
  "硬约束",
  "范围与非范围",
  "交付完成定义",
  "业务交付场景",
  "自测命令",
  "失败修复与复测机制",
  "技术设计与模块边界",
  "API、数据模型与配置",
  "开发任务拆分",
  "测试策略",
  "需求到验收映射",
  "最终交付清单"
];

const BUGFIX_DESIGN_REQUIRED_SECTIONS = [
  "问题摘要",
  "失败事实",
  "影响范围",
  "根因分析",
  "修复目标与非目标",
  "修复设计",
  "修改范围",
  "自动化验证目标",
  "交付测试目标",
  "风险与回退",
  "上下文恢复说明"
];

const BUGFIX_PLANNING_REQUIRED_SECTIONS = [
  "Bug 与设计来源",
  "设计目标覆盖表",
  "实施任务拆分",
  "TDD 与红灯测试计划",
  "自动化验证计划",
  "真实业务交付测试计划",
  "交付测试失败整改记录",
  "设计完成核对清单",
  "上下文恢复说明"
];

const TEAM_DELEGATE_SKILL_NAME = "team-delegate";
const TEAM_DELEGATE_SKILL_DOCS_DIR = join(homedir(), ".codex", "skills", TEAM_DELEGATE_SKILL_NAME, "docs");
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_SKILL_DOCS_DIR = join(PACKAGE_ROOT, "skills", TEAM_DELEGATE_SKILL_NAME, "docs");

interface SkillGuideDocument {
  path: string;
  relativePath: string;
  content: string;
}

function toSkillGuideRelativePath(fileName: string): string {
  return `docs/${fileName}`;
}

function toInstalledSkillGuidePath(fileName: string): string {
  return join(TEAM_DELEGATE_SKILL_DOCS_DIR, fileName);
}

function readSkillGuideDocument(fileName: string): SkillGuideDocument {
  const relativePath = toSkillGuideRelativePath(fileName);
  const candidatePaths = Array.from(
    new Set([toInstalledSkillGuidePath(fileName), join(PACKAGE_SKILL_DOCS_DIR, fileName)])
  );
  const failures: string[] = [];

  for (const candidatePath of candidatePaths) {
    try {
      const content = readFileSync(candidatePath, "utf8").trim();
      if (content.length === 0) {
        failures.push(`${candidatePath}: 文档为空`);
        continue;
      }
      return {
        path: candidatePath,
        relativePath,
        content
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidatePath}: ${message}`);
    }
  }

  throw new BridgeError(
    ErrorCodes.CONFIG_VALUE_INVALID,
    `无法读取 ${TEAM_DELEGATE_SKILL_NAME} 插件指南文档 ${relativePath}。已尝试: ${failures.join(" | ")}`,
    false
  );
}

function buildGuideDocumentPromptBlock(guide: SkillGuideDocument): string[] {
  return [
    "插件 skill 自带指南文档全文如下。该指南来自 team-delegate skill 自带 docs，不来自用户项目目录。",
    `指南文档：${guide.path}`,
    `指南相对路径（相对 ${TEAM_DELEGATE_SKILL_NAME} skill 根目录）：${guide.relativePath}`,
    "=== 指南全文开始 ===",
    guide.content,
    "=== 指南全文结束 ===",
    "你必须按照上方指南全文的要求编写，不允许只按章节名编写，不允许忽略指南中的完成标准、禁止写法、验证要求和交付测试要求。"
  ];
}

const DOCUMENT_PROFILES: Record<
  DevelopmentType,
  {
    developmentType: DevelopmentType;
    label: string;
    designGuideFile: string;
    planningGuideFile: string;
    designRequiredSections: string[];
    planningRequiredSections: string[];
  }
> = {
  feature: {
    developmentType: "feature",
    label: "新增功能",
    designGuideFile: "可交付开发设计文档编写指南-v0.1.md",
    planningGuideFile: "可交付开发计划编写指南-v0.1.md",
    designRequiredSections: FEATURE_DESIGN_REQUIRED_SECTIONS,
    planningRequiredSections: FEATURE_PLANNING_REQUIRED_SECTIONS
  },
  bugfix: {
    developmentType: "bugfix",
    label: "BUG 修改",
    designGuideFile: "可交付BUG修改设计文档编写指南-v0.1.md",
    planningGuideFile: "可交付BUG修改计划编写指南-v0.1.md",
    designRequiredSections: BUGFIX_DESIGN_REQUIRED_SECTIONS,
    planningRequiredSections: BUGFIX_PLANNING_REQUIRED_SECTIONS
  }
};

const DEFAULT_WORKFLOW_MODELS = [
  "llm-router-openai-compatible/kimi-for-roo",
  "llm-router-openai-responses/gpt-5.4-mini"
];
const DEFAULT_WORKFLOW_SYNC_WAIT_MS = 180_000;
const DEFAULT_WORKFLOW_POLL_INTERVAL_MS = 60_000;
const DEFAULT_WORKFLOW_POLL_INTERVAL_MIN_MS = 60_000;
const DEFAULT_WORKFLOW_POLL_INTERVAL_MAX_MS = 120_000;
const DEFAULT_WORKFLOW_SILENCE_DECISION_MS = 300_000;
const DEFAULT_USER_DECISION_TIMEOUT_DEFAULT_AFTER_MS = 60_000;
const MAX_CONSECUTIVE_TIMEOUT_DEFAULT_CONTINUES = 3;
const TASK_ACP_KEEPALIVE_CLEANUP_MS = 4 * 60 * 60 * 1000;
const WORKFLOW_FOLLOW_UP_GATE_CHECK_MS = 250;
const MAX_REMEDIATION_ROUNDS = 3;
const MODEL_PREFERENCE_FILENAME = "preferred-models.json";
const MAX_DETECTION_CONTEXT_CHARS = 60_000;
const STAGE_DETECTION_PARSE_WAIT_MS = 8_000;
const STAGE_DETECTION_PARSE_POLL_MS = 250;

export class BridgeService {
  private readonly store: SqliteStore;

  private readonly logger: Logger;

  private readonly metrics: MetricsRegistry;

  private readonly runtime: BridgeRuntimeOptions;

  private readonly processSupervisor: AcpProcessSupervisor;

  private sessionApi?: AcpSessionApi;

  private initialized = false;

  private readonly activeTurnByBridgeSession = new Map<string, string>();

  private readonly eventSeqByTurn = new Map<string, number>();

  private readonly workflowByKey = new Map<string, TaskWorkflowState>();

  private readonly pendingStartInputByKey = new Map<string, ExecuteTaskInput>();

  public constructor(runtime: BridgeRuntimeOptions, logger: Logger, metrics: MetricsRegistry) {
    this.runtime = runtime;
    this.logger = logger;
    this.metrics = metrics;
    this.store = new SqliteStore(join(runtime.stateDir, "delegate-store.db"));
    this.processSupervisor = new AcpProcessSupervisor(
      {
        binPath: runtime.opencodeBinPath,
        args: ["acp"]
      },
      logger
    );
  }

  public async init(): Promise<void> {
    await this.store.init();
  }

  public async shutdown(): Promise<void> {
    try {
      await this.processSupervisor.stop();
    } catch {
      // 关闭阶段允许忽略进程已退出等错误。
    }
    await this.store.close();
  }

  public async initSession(input: InitSessionInput): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    try {
      this.validateWorkspace(input.workspace_path);
      await this.ensureAcpReady(input.timeout_ms ?? 15_000);

      const strategy: SessionStrategy = input.session_strategy ?? "auto";
      const existing = await this.store.findSessionByAlias(input.workspace_path, input.session_alias);
      let acpSessionId = existing?.acpSessionId;
      let sessionMode: "new" | "loaded" | "resumed" = "new";
      let configOptions: Array<{ id: string; currentValue: string }> = [];

      if (existing && strategy !== "new") {
        try {
          if (strategy === "resume") {
            const loaded = await this.mustApi().resumeSession(
              existing.acpSessionId,
              input.workspace_path,
              input.timeout_ms ?? 15_000
            );
            acpSessionId = loaded.sessionId;
            configOptions = loaded.configOptions ?? [];
            sessionMode = "resumed";
          } else {
            const loaded = await this.mustApi().loadSession(
              existing.acpSessionId,
              input.workspace_path,
              this.runtime.mcpServers ?? [],
              input.timeout_ms ?? 15_000
            );
            acpSessionId = loaded.sessionId;
            configOptions = loaded.configOptions ?? [];
            sessionMode = "loaded";
          }
        } catch {
          if (strategy !== "auto") {
            throw new BridgeError(ErrorCodes.SESSION_NOT_READY, "会话恢复失败", true);
          }
        }
      }

      if (!acpSessionId || sessionMode === "new") {
        const created = await this.mustApi().newSession(
          input.workspace_path,
          this.runtime.mcpServers ?? [],
          input.timeout_ms ?? 15_000
        );
        acpSessionId = created.sessionId;
        configOptions = created.configOptions ?? [];
      }

      if (input.preferred_model) {
        try {
          const changed = await this.mustApi().setConfigOption(
            acpSessionId,
            "model",
            input.preferred_model,
            input.timeout_ms ?? 15_000
          );
          configOptions = changed.configOptions;
        } catch (error) {
          this.logger.warn("session.preferred_model.set_failed", {
            model: input.preferred_model,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const bridgeSessionId = existing?.bridgeSessionId ?? newBridgeSessionId();
      const record: DelegateSessionRecord = {
        bridgeSessionId,
        sessionAlias: input.session_alias,
        workspacePath: input.workspace_path,
        acpSessionId,
        currentModel: configOptions.find((item) => item.id === "model")?.currentValue,
        configOptions,
        processPid: this.processSupervisor.getPid(),
        status: "READY",
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now()
      };
      await this.store.saveSession(record);
      await this.audit(requestId, "session.init", "codex", "OK", { bridgeSessionId, sessionMode });
      this.metrics.inc("session_init_success");

      return makeResult(requestId, {
        bridge_session_id: bridgeSessionId,
        acp_session_id: acpSessionId,
        session_mode: sessionMode,
        current_model: record.currentModel,
        config_options: configOptions
      });
    } catch (error) {
      this.metrics.inc("session_init_failed");
      const bridgeError = this.normalizeError(error);
      await this.audit(requestId, "session.init", "codex", bridgeError.code, {
        message: bridgeError.message
      });
      return makeError(requestId, bridgeError);
    }
  }

  public async runTurn(input: RunTurnInput): Promise<BridgeResult<unknown>> {
    return this.executeTurn("run", input.bridge_session_id, input.idempotency_key, input.prompt_text, input.timeout_ms);
  }

  public async reworkTurn(input: ReworkTurnInput): Promise<BridgeResult<unknown>> {
    return this.executeTurn(
      "rework",
      input.bridge_session_id,
      input.idempotency_key,
      input.rework_prompt_text,
      input.timeout_ms
    );
  }

  public async setConfig(input: SetConfigInput): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    try {
      const session = await this.loadReadySession(input.bridge_session_id);
      const changed = await this.mustApi().setConfigOption(
        session.acpSessionId,
        input.config_id,
        input.value,
        input.timeout_ms ?? this.runtime.turnTimeoutMs
      );
      session.configOptions = changed.configOptions;
      session.currentModel = changed.configOptions.find((item) => item.id === "model")?.currentValue;
      session.updatedAt = now();
      await this.store.saveSession(session);
      await this.audit(requestId, "session.set-config", "codex", "OK", {
        bridgeSessionId: session.bridgeSessionId,
        configId: input.config_id
      });
      return makeResult(requestId, {
        config_options: changed.configOptions
      });
    } catch (error) {
      const bridgeError = this.normalizeError(error);
      await this.audit(requestId, "session.set-config", "codex", bridgeError.code, {
        message: bridgeError.message
      });
      return makeError(requestId, bridgeError);
    }
  }

  public async cancel(input: CancelInput): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    try {
      const session = await this.loadReadySession(input.bridge_session_id, true);
      if (!session.activeTurnId) {
        throw new BridgeError(ErrorCodes.NO_ACTIVE_TURN, "当前无可取消轮次", false);
      }

      await this.mustApi().cancel(session.acpSessionId);

      const settled = await this.waitForTurnToSettle(
        session.bridgeSessionId,
        session.activeTurnId,
        5_000
      );

      if (!settled) {
        this.logger.warn("turn.cancel.fallback_close_recreate", {
          bridgeSessionId: session.bridgeSessionId
        });
        await this.mustApi().close(session.acpSessionId, input.timeout_ms ?? 10_000);
        const recreated = await this.mustApi().newSession(
          session.workspacePath,
          this.runtime.mcpServers ?? [],
          input.timeout_ms ?? 15_000
        );
        session.acpSessionId = recreated.sessionId;
        session.configOptions = recreated.configOptions ?? [];
        session.currentModel = session.configOptions.find((item) => item.id === "model")?.currentValue;
      }
      const turns = await this.store.listTurns(session.bridgeSessionId);
      const turn = turns.find((item) => item.turnId === session.activeTurnId);
      if (turn) {
        turn.status = "CANCELLED";
        turn.endedAt = now();
        await this.store.saveTurn(turn);
      }
      session.activeTurnId = undefined;
      session.status = "READY";
      session.updatedAt = now();
      await this.store.saveSession(session);
      await this.audit(requestId, "turn.cancel", "codex", "OK", { bridgeSessionId: session.bridgeSessionId });
      return makeResult(requestId, { cancelled: true });
    } catch (error) {
      const bridgeError = this.normalizeError(error);
      await this.audit(requestId, "turn.cancel", "codex", bridgeError.code, {
        message: bridgeError.message
      });
      return makeError(requestId, bridgeError);
    }
  }

  public async close(input: CloseInput): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    try {
      const session = await this.loadReadySession(input.bridge_session_id, true);
      try {
        await this.mustApi().close(session.acpSessionId, input.timeout_ms ?? 10_000);
      } catch (error) {
        if (!input.force) {
          throw error;
        }
      }
      session.status = "CLOSED";
      session.activeTurnId = undefined;
      session.updatedAt = now();
      await this.store.saveSession(session);
      await this.audit(requestId, "session.close", "codex", "OK", { bridgeSessionId: session.bridgeSessionId });
      return makeResult(requestId, { closed: true });
    } catch (error) {
      const bridgeError = this.normalizeError(error, ErrorCodes.SESSION_CLOSE_FAILED);
      await this.audit(requestId, "session.close", "codex", bridgeError.code, {
        message: bridgeError.message
      });
      return makeError(requestId, bridgeError);
    }
  }

  public async executeTask(input: ExecuteTaskInput): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    const action: ExecuteTaskAction = input.action ?? "start";
    const timeoutMs = input.timeout_ms;
    let sessionAlias = input.session_alias?.trim() ?? input.task_id?.trim() ?? "";

    try {
      const identity = await this.resolveTaskIdentity(input, action);
      sessionAlias = identity.sessionAlias;
      const taskId = identity.taskId;
      const workflowKey = this.toWorkflowKey(input.workspace_path, sessionAlias);

      if (action === "start") {
        return await this.handleStartWithModelGate(requestId, input, sessionAlias, taskId, workflowKey);
      }

      if (action === "model_confirm") {
        return await this.handleModelConfirmAction(requestId, input, sessionAlias, taskId, workflowKey, timeoutMs);
      }

      if (action === "model_select") {
        return await this.handleModelSelectAction(requestId, input, sessionAlias, taskId, workflowKey, timeoutMs);
      }

      const workflow = await this.loadWorkflowState(input.workspace_path, sessionAlias);
      if (action === "status") {
        await this.ensureWorkflowRuntimeContext(workflow);
        await this.waitForWorkflowFollowUpDue(workflow);
        await this.trackWorkflowStatusPoll(workflow);
        const timeoutDefaultAutoContinued = this.tryAutoContinueByTimeoutDefault(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.status", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId,
          timeoutDefaultAutoContinued
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "continue_wait") {
        const decisionSource = this.resolveContinueWaitDecisionSource(input);
        this.assertContinueWaitAllowed(workflow, decisionSource);
        await this.ensureWorkflowRuntimeContext(workflow);
        if (workflow.stage !== "NEEDS_USER_DECISION") {
          await this.persistWorkflowState(workflow);
          await this.audit(requestId, "task.execute.continue-wait", "codex", "OK", {
            sessionAlias,
            bridgeSessionId: workflow.bridgeSessionId,
            decisionSource,
            runtimeDecisionRequired: true,
            workflowStageAfterRuntimeCheck: workflow.stage
          });
          return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
        }
        this.applyContinueWaitDecision(workflow, decisionSource);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.continue-wait", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId,
          pollCycle: workflow.currentPollCycle,
          decisionSource,
          consecutiveTimeoutDefaultContinueCount: workflow.consecutiveTimeoutDefaultContinueCount
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "handoff_to_main") {
        const result = await this.handoffWorkflowToMain(workflow, timeoutMs);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.handoff-to-main", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, result);
      }

      if (action === "delivery_test_pass") {
        const result = await this.handleDeliveryTestPass(workflow, input.feedback_text, timeoutMs);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.delivery-test-pass", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, result);
      }

      if (action === "delivery_test_fail") {
        const failureText = this.requireFeedback(input.feedback_text, action);
        await this.handleDeliveryTestFail(workflow, failureText);
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.delivery-test-fail", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId,
          remediationRound: workflow.remediationRound
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "remediation_approve") {
        const remediationPlanText = this.requireFeedback(input.feedback_text, action);
        await this.handleRemediationApprove(workflow, remediationPlanText);
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.remediation-approve", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId,
          remediationRound: workflow.remediationRound
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "restart_acp_session") {
        await this.handleRestartAcpSession(workflow);
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.restart-acp-session", "codex", "OK", {
          sessionAlias,
          taskId,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "cancel_follow_up") {
        const result = await this.handleCancelFollowUp(workflow, timeoutMs);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.cancel-follow-up", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, result);
      }

      if (action === "design_feedback") {
        this.assertWorkflowStage(workflow, ["WAITING_DESIGN_APPROVAL"], action);
        const feedback = this.requireFeedback(input.feedback_text, action);
        if (!(await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, false))) {
          await this.persistWorkflowState(workflow);
          return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
        }
        this.launchWorkflowPhase(workflow, "RUNNING_DESIGN", "design", async () => {
          await this.applyDesignFeedback(workflow, feedback);
        });
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.design-feedback", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "design_approve") {
        this.assertWorkflowStage(workflow, ["WAITING_DESIGN_APPROVAL"], action);
        if (!(await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, false))) {
          await this.persistWorkflowState(workflow);
          return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
        }
        this.launchWorkflowPhase(workflow, "RUNNING_PLANNING", "planning", async () => {
          await this.runPlanningPhase(workflow);
        });
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.design-approve", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      if (action === "planning_feedback") {
        this.assertWorkflowStage(workflow, ["WAITING_PLAN_APPROVAL"], action);
        const feedback = this.requireFeedback(input.feedback_text, action);
        if (!(await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, false))) {
          await this.persistWorkflowState(workflow);
          return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
        }
        this.launchWorkflowPhase(workflow, "RUNNING_PLANNING", "planning", async () => {
          await this.applyPlanningFeedback(workflow, feedback);
        });
        await this.waitForWorkflowShortSyncWindow(workflow);
        await this.persistWorkflowState(workflow);
        await this.audit(requestId, "task.execute.planning-feedback", "codex", "OK", {
          sessionAlias,
          bridgeSessionId: workflow.bridgeSessionId
        });
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }

      this.assertWorkflowStage(workflow, ["WAITING_PLAN_APPROVAL"], action);
      if (!(await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, false))) {
        await this.persistWorkflowState(workflow);
        return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
      }
      this.launchWorkflowPhase(workflow, "RUNNING_IMPLEMENTATION", "implementation", async () => {
        workflow.lastImplementationResult = await this.runImplementationPhase(workflow);
        this.enterDeliveryTestGate(workflow);
      });
      await this.waitForWorkflowShortSyncWindow(workflow);
      await this.persistWorkflowState(workflow);
      await this.audit(requestId, "task.execute.planning-approve", "codex", "OK", {
        sessionAlias,
        bridgeSessionId: workflow.bridgeSessionId,
        steps: workflow.steps.length
      });
      return makeResult(requestId, this.buildWorkflowStatusResponse(workflow));
    } catch (error) {
      const bridgeError = this.normalizeError(error);
      await this.audit(requestId, "task.execute", "codex", bridgeError.code, {
        message: bridgeError.message,
        sessionAlias,
        action
      });
      return makeError(requestId, bridgeError);
    }
  }

  private async resolveTaskIdentity(
    input: ExecuteTaskInput,
    action: ExecuteTaskAction
  ): Promise<{ sessionAlias: string; taskId: string }> {
    const alias = input.session_alias?.trim();
    if (alias) {
      return {
        sessionAlias: alias,
        taskId: input.task_id?.trim() || alias
      };
    }

    const taskId = input.task_id?.trim();
    if (taskId) {
      if (action === "start") {
        return {
          sessionAlias: taskId,
          taskId
        };
      }
      const workflow = await this.findWorkflowByTaskId(input.workspace_path, taskId);
      if (!workflow) {
        throw new BridgeError(ErrorCodes.WORKFLOW_NOT_FOUND, `未找到 task_id 对应的委派流程: ${taskId}`, false);
      }
      return {
        sessionAlias: workflow.sessionAlias,
        taskId: workflow.taskId
      };
    }
    if (action === "start") {
      const generated = `task-${Date.now()}`;
      return {
        sessionAlias: generated,
        taskId: generated
      };
    }
    throw new BridgeError(ErrorCodes.INVALID_REQUEST, `${action} 需要传入 session_alias`, false);
  }

  private resolveDesignPlanningExecutor(input: ExecuteTaskInput): DesignPlanningExecutor {
    if (input.design_planning_executor === "acp") {
      return "acp";
    }
    return "main";
  }

  private async handleStartWithModelGate(
    requestId: string,
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string,
    workflowKey: string
  ): Promise<BridgeResult<unknown>> {
    await this.cleanupExpiredOtherTaskWorkflows(input.workspace_path, taskId);
    const existingWorkflow = await this.restoreExistingWorkflowForStart(workflowKey);
    if (existingWorkflow) {
      await this.audit(requestId, "task.execute.start.restore-existing", "codex", "OK", {
        sessionAlias,
        bridgeSessionId: existingWorkflow.bridgeSessionId,
        stage: existingWorkflow.stage
      });
      return makeResult(requestId, this.buildWorkflowStatusResponse(existingWorkflow));
    }

    this.ensureWorkflowSlotAvailable(workflowKey);
    const startDecision = this.resolveStartPhaseDecision(input);
    const developmentDecision = this.resolveDevelopmentTypeDecision(input);
    if (startDecision.phase === "need_user_input" || developmentDecision.type === "need_user_input") {
      await this.audit(requestId, "task.execute.start.needs-user-input", "codex", "OK", {
        sessionAlias,
        missingContext: [...startDecision.missingContext, ...developmentDecision.missingContext]
      });
      return makeResult(
        requestId,
        this.buildNeedsUserInputResponse(sessionAlias, taskId, startDecision, developmentDecision)
      );
    }

    const designPlanningExecutor = this.resolveDesignPlanningExecutor(input);
    if (
      designPlanningExecutor === "main" &&
      (startDecision.phase === "design" || startDecision.phase === "planning")
    ) {
      await this.audit(requestId, "task.execute.start.needs-main-executor", "codex", "OK", {
        sessionAlias,
        detectedStartPhase: startDecision.phase
      });
      return makeResult(
        requestId,
        this.buildNeedsMainPhaseResponse(
          input.workspace_path,
          sessionAlias,
          taskId,
          startDecision.phase,
          input.requirement_text,
          startDecision.evidence,
          developmentDecision
        )
      );
    }

    await this.cachePendingStartInput(workflowKey, input, sessionAlias, taskId);
    const modelGate = await this.resolveModelGate(input.workspace_path);
    if (modelGate.savedModel && modelGate.savedModelAvailable) {
      await this.audit(requestId, "task.execute.start.needs-model-confirm", "codex", "OK", {
        sessionAlias,
        savedModel: modelGate.savedModel
      });
      return makeResult(
        requestId,
        this.buildNeedsModelConfirmResponse(
          sessionAlias,
          taskId,
          modelGate.savedModel,
          modelGate.availableModels,
          startDecision,
          developmentDecision
        )
      );
    }

    const reason = modelGate.savedModel
      ? `历史模型 ${modelGate.savedModel} 已不可用，需要重新选择模型。`
      : "未找到历史模型，请先选择要使用的模型。";
    await this.audit(requestId, "task.execute.start.needs-model-selection", "codex", "OK", {
      sessionAlias,
      reason
    });
    return makeResult(
      requestId,
      this.buildNeedsModelSelectionResponse(
        sessionAlias,
        taskId,
        modelGate.availableModels,
        reason,
        startDecision,
        developmentDecision,
        modelGate.savedModel
      )
    );
  }

  private async handleModelConfirmAction(
    requestId: string,
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string,
    workflowKey: string,
    timeoutMs: number | undefined
  ): Promise<BridgeResult<unknown>> {
    this.ensureWorkflowSlotAvailable(workflowKey);
    const choice = input.model_confirm_choice;
    if (!choice) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, "model_confirm 需要 model_confirm_choice", false);
    }
    const effectiveInput = await this.resolveEffectiveStartInput(workflowKey, input);
    const startDecision = this.resolveStartPhaseDecision(effectiveInput);
    const developmentDecision = this.resolveDevelopmentTypeDecision(effectiveInput);
    const modelGate = await this.resolveModelGate(input.workspace_path);
    if (choice === "select_new_model") {
      return makeResult(
        requestId,
        this.buildNeedsModelSelectionResponse(
          sessionAlias,
          taskId,
          modelGate.availableModels,
          "你选择了重新选择模型，请从可用模型中选择一个。",
          startDecision,
          developmentDecision,
          modelGate.savedModel
        )
      );
    }
    if (!modelGate.savedModel || !modelGate.savedModelAvailable) {
      const reason = modelGate.savedModel
        ? `历史模型 ${modelGate.savedModel} 已不可用，需要重新选择模型。`
        : "没有可用的历史模型，请先选择模型。";
      return makeResult(
        requestId,
        this.buildNeedsModelSelectionResponse(
          sessionAlias,
          taskId,
          modelGate.availableModels,
          reason,
          startDecision,
          developmentDecision,
          modelGate.savedModel
        )
      );
    }
    await this.saveWorkspacePreferredModel(effectiveInput.workspace_path, modelGate.savedModel);
    return this.startWorkflowAfterModelResolved(
      requestId,
      effectiveInput,
      sessionAlias,
      taskId,
      workflowKey,
      timeoutMs,
      modelGate.savedModel
    );
  }

  private async handleModelSelectAction(
    requestId: string,
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string,
    workflowKey: string,
    timeoutMs: number | undefined
  ): Promise<BridgeResult<unknown>> {
    this.ensureWorkflowSlotAvailable(workflowKey);
    const selectedModel = input.selected_model?.trim();
    if (!selectedModel) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, "model_select 需要 selected_model", false);
    }
    const effectiveInput = await this.resolveEffectiveStartInput(workflowKey, input);
    const startDecision = this.resolveStartPhaseDecision(effectiveInput);
    const developmentDecision = this.resolveDevelopmentTypeDecision(effectiveInput);
    const modelGate = await this.resolveModelGate(effectiveInput.workspace_path);
    if (!modelGate.availableModels.includes(selectedModel)) {
      return makeResult(
        requestId,
        this.buildNeedsModelSelectionResponse(
          sessionAlias,
          taskId,
          modelGate.availableModels,
          `模型 ${selectedModel} 不在当前可用模型列表中，请重新选择。`,
          startDecision,
          developmentDecision,
          modelGate.savedModel
        )
      );
    }
    await this.saveWorkspacePreferredModel(effectiveInput.workspace_path, selectedModel);
    return this.startWorkflowAfterModelResolved(
      requestId,
      effectiveInput,
      sessionAlias,
      taskId,
      workflowKey,
      timeoutMs,
      selectedModel
    );
  }

  private async startWorkflowAfterModelResolved(
    requestId: string,
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string,
    workflowKey: string,
    timeoutMs: number | undefined,
    selectedModel: string
  ): Promise<BridgeResult<unknown>> {
    const startDecision = this.resolveStartPhaseDecision(input);
    const developmentDecision = this.resolveDevelopmentTypeDecision(input);
    if (startDecision.phase === "need_user_input" || developmentDecision.type === "need_user_input") {
      await this.clearPendingStartInput(workflowKey);
      await this.audit(requestId, "task.execute.start.needs-user-input", "codex", "OK", {
        sessionAlias,
        missingContext: [...startDecision.missingContext, ...developmentDecision.missingContext],
        selectedModel
      });
      return makeResult(requestId, {
        ...this.buildNeedsUserInputResponse(sessionAlias, taskId, startDecision, developmentDecision),
        selected_model: selectedModel
      });
    }
    const designPlanningExecutor = this.resolveDesignPlanningExecutor(input);
    if (
      designPlanningExecutor === "main" &&
      (startDecision.phase === "design" || startDecision.phase === "planning")
    ) {
      await this.clearPendingStartInput(workflowKey);
      await this.audit(requestId, "task.execute.start.needs-main-executor", "codex", "OK", {
        sessionAlias,
        detectedStartPhase: startDecision.phase,
        selectedModel
      });
      return makeResult(requestId, {
        ...this.buildNeedsMainPhaseResponse(
          input.workspace_path,
          sessionAlias,
          taskId,
          startDecision.phase,
          input.requirement_text,
          startDecision.evidence,
          developmentDecision
        ),
        selected_model: selectedModel
      });
    }

    const workflowInput: ExecuteTaskInput = {
      ...input,
      preferred_model: selectedModel
    };
    const workflow = await this.startWorkflow(
      workflowInput,
      sessionAlias,
      taskId,
      timeoutMs,
      startDecision.phase,
      startDecision.evidence,
      developmentDecision.type,
      developmentDecision.evidence
    );
    this.workflowByKey.set(workflowKey, workflow);
    await this.clearPendingStartInput(workflowKey);
    await this.persistWorkflowState(workflow);
    this.launchWorkflowByEntryPhase(workflow);
    await this.waitForWorkflowShortSyncWindow(workflow);
    await this.persistWorkflowState(workflow);
    await this.audit(requestId, "task.execute.start", "codex", "OK", {
      sessionAlias,
      bridgeSessionId: workflow.bridgeSessionId,
      detectedStartPhase: startDecision.phase,
      developmentType: developmentDecision.type,
      selectedModel
    });
    const response = this.buildWorkflowStatusResponse(workflow);
    return makeResult(requestId, {
      ...response,
      selected_model: selectedModel
    });
  }

  private async resolveModelGate(workspacePath: string): Promise<{
    availableModels: string[];
    savedModel?: string;
    savedModelAvailable: boolean;
  }> {
    const availableModels = this.listConfiguredModelsFromOpencode();
    const savedModel = await this.readWorkspacePreferredModel(workspacePath);
    return {
      availableModels,
      savedModel,
      savedModelAvailable: savedModel ? availableModels.includes(savedModel) : false
    };
  }

  private async cachePendingStartInput(
    workflowKey: string,
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string
  ): Promise<void> {
    const pendingInput: ExecuteTaskInput = {
      ...input,
      session_alias: sessionAlias,
      task_id: taskId,
      action: "start"
    };
    this.pendingStartInputByKey.set(workflowKey, {
      ...pendingInput
    });
    try {
      await this.store.savePendingStart({
        workflowKey,
        workspacePath: input.workspace_path,
        sessionAlias,
        payload: pendingInput as unknown as Record<string, unknown>,
        createdAt: now(),
        updatedAt: now()
      });
    } catch (error) {
      this.pendingStartInputByKey.delete(workflowKey);
      throw new BridgeError(
        ErrorCodes.STORE_WRITE_FAILED,
        `保存模型确认上下文失败：${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
  }

  private async clearPendingStartInput(workflowKey: string): Promise<void> {
    this.pendingStartInputByKey.delete(workflowKey);
    try {
      await this.store.deletePendingStart(workflowKey);
    } catch (error) {
      this.logger.warn("workflow.pending_start.clear_failed", {
        workflowKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async resolveEffectiveStartInput(workflowKey: string, input: ExecuteTaskInput): Promise<ExecuteTaskInput> {
    let pending = this.pendingStartInputByKey.get(workflowKey);
    if (!pending) {
      try {
        const persisted = await this.store.findPendingStartByKey(workflowKey);
        const payload = persisted?.payload;
        if (payload && typeof payload === "object") {
          pending = payload as unknown as ExecuteTaskInput;
          this.pendingStartInputByKey.set(workflowKey, pending);
        }
      } catch (error) {
        throw new BridgeError(
          ErrorCodes.STORE_WRITE_FAILED,
          `读取模型确认上下文失败：${error instanceof Error ? error.message : String(error)}`,
          true
        );
      }
    }
    if (!pending) {
      return input;
    }
    return {
      ...pending,
      ...input,
      action: "start",
      session_alias: input.session_alias ?? pending.session_alias,
      task_id: input.task_id ?? pending.task_id
    };
  }

  private listConfiguredModelsFromOpencode(): string[] {
    let stdout = "";
    try {
      stdout = execFileSync(this.runtime.opencodeBinPath, ["models"], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (error) {
      throw new BridgeError(
        ErrorCodes.CONFIG_VALUE_INVALID,
        `无法读取 opencode 模型列表，请确认 \`${this.runtime.opencodeBinPath} models\` 可用: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true
      );
    }
    const models = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^[^/\s]+\/[^\s]+$/u.test(line));
    return Array.from(new Set(models));
  }

  private buildNeedsModelConfirmResponse(
    sessionAlias: string,
    taskId: string,
    savedModel: string,
    availableModels: string[],
    startDecision: StartPhaseDecision,
    developmentDecision: DevelopmentTypeDecision
  ): Record<string, unknown> {
    return {
      task_id: taskId,
      session_alias: sessionAlias,
      workflow_status: "NEEDS_MODEL_CONFIRM",
      current_stage: "NEEDS_MODEL_CONFIRM",
      next_action_required: ["model_confirm"],
      ...this.buildBusinessModelSelectionContext(startDecision, "confirm"),
      ...this.toDevelopmentDecisionPayload(developmentDecision),
      saved_model: savedModel,
      default_option: "1",
      user_options: [
        {
          option: "1",
          action: "model_confirm",
          model_confirm_choice: "use_saved_model",
          label: "继续使用历史模型（默认）",
          description: `继续使用 ${savedModel}`
        },
        {
          option: "2",
          action: "model_confirm",
          model_confirm_choice: "select_new_model",
          label: "改为重新选择",
          description: "查看当前可用模型并重新选择"
        }
      ],
      available_model_count: availableModels.length
    };
  }

  private buildNeedsModelSelectionResponse(
    sessionAlias: string,
    taskId: string,
    availableModels: string[],
    reason: string,
    startDecision: StartPhaseDecision,
    developmentDecision: DevelopmentTypeDecision,
    savedModel?: string
  ): Record<string, unknown> {
    return {
      task_id: taskId,
      session_alias: sessionAlias,
      workflow_status: "NEEDS_MODEL_SELECTION",
      current_stage: "NEEDS_MODEL_SELECTION",
      next_action_required: ["model_select"],
      ...this.buildBusinessModelSelectionContext(startDecision, "select"),
      ...this.toDevelopmentDecisionPayload(developmentDecision),
      reason,
      saved_model: savedModel,
      available_models: availableModels
    };
  }

  private buildBusinessModelSelectionContext(
    startDecision: StartPhaseDecision,
    mode: "confirm" | "select"
  ): Record<string, unknown> {
    const businessStage = this.toBusinessStage(startDecision.phase);
    if (startDecision.phase === "implementation") {
      const actionText =
        mode === "confirm"
          ? "请为本次计划实施选择执行模型：可以继续使用上次的执行模型，也可以重新选择。"
          : "请为本次计划实施选择执行模型。";
      return {
        business_stage: businessStage,
        business_reason: "当前已经有了方案和计划，按约定可以直接进入计划实施阶段。",
        next_business_action: "选择本次计划实施的执行模型",
        user_message: `当前已经有了方案和计划，按约定可以直接进入计划实施阶段。${actionText}`
      };
    }

    const actionText =
      mode === "confirm" ? "可以继续使用上次的执行模型，也可以重新选择。" : "请先选择执行模型。";
    return {
      business_stage: businessStage,
      business_reason: `你已明确选择让 ACP 执行${businessStage}。`,
      next_business_action: `选择本次${businessStage}的执行模型`,
      user_message: `你已明确选择让 ACP 执行${businessStage}，${actionText}`
    };
  }

  private getModelPreferenceFilePath(): string {
    return join(this.runtime.stateDir, MODEL_PREFERENCE_FILENAME);
  }

  private normalizeWorkspaceKey(workspacePath: string): string {
    const normalized = resolve(workspacePath).replace(/\\/g, "/");
    if (process.platform === "win32") {
      return normalized.toLowerCase();
    }
    return normalized;
  }

  private async loadPreferredModelStore(): Promise<ModelPreferenceStore> {
    try {
      const raw = await readFile(this.getModelPreferenceFilePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<ModelPreferenceStore>;
      if (parsed && typeof parsed === "object" && parsed.workspaces && typeof parsed.workspaces === "object") {
        return {
          version: 1,
          workspaces: parsed.workspaces as Record<string, { model: string; updated_at: string }>
        };
      }
    } catch {
      // 空文件或不存在时回退默认值
    }
    return {
      version: 1,
      workspaces: {}
    };
  }

  private async readWorkspacePreferredModel(workspacePath: string): Promise<string | undefined> {
    const store = await this.loadPreferredModelStore();
    const key = this.normalizeWorkspaceKey(workspacePath);
    const record = store.workspaces[key];
    const model = record?.model?.trim();
    return model && model.length > 0 ? model : undefined;
  }

  private async saveWorkspacePreferredModel(workspacePath: string, model: string): Promise<void> {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, "模型不能为空", false);
    }
    const store = await this.loadPreferredModelStore();
    const key = this.normalizeWorkspaceKey(workspacePath);
    store.workspaces[key] = {
      model: trimmedModel,
      updated_at: now()
    };
    await writeFile(this.getModelPreferenceFilePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  private resolveStartPhaseDecision(input: ExecuteTaskInput): StartPhaseDecision {
    const phase = input.start_phase;
    const missingContextFromInput =
      input.missing_context?.filter((item) => typeof item === "string" && item.trim().length > 0) ?? [];
    const evidenceFromInput =
      input.start_phase_evidence?.filter((item) => typeof item === "string" && item.trim().length > 0) ?? [];
    const reason = input.start_phase_reason?.trim();

    if (!phase) {
      return {
        phase: "need_user_input",
        evidence: ["主对话未提供 start_phase；按协议需要先在主对话判定阶段后再调用 start。"],
        missingContext: ["start_phase（design/planning/implementation/need_user_input）"]
      };
    }

    const evidence =
      evidenceFromInput.length > 0
        ? evidenceFromInput
        : [reason ? `主对话判定起始阶段: ${phase}；理由: ${reason}` : `主对话判定起始阶段: ${phase}`];
    if (phase === "need_user_input") {
      return {
        phase,
        evidence,
        missingContext:
          missingContextFromInput.length > 0
            ? missingContextFromInput
            : ["请补充缺失上下文后重试，并由主对话重新判定 start_phase。"]
      };
    }

    return {
      phase,
      evidence,
      missingContext: []
    };
  }

  private resolveDevelopmentTypeDecision(input: ExecuteTaskInput): DevelopmentTypeDecision {
    const developmentType = input.development_type;
    const missingContextFromInput =
      input.missing_context?.filter((item) => typeof item === "string" && item.trim().length > 0) ?? [];
    const evidenceFromInput =
      input.development_type_evidence?.filter((item) => typeof item === "string" && item.trim().length > 0) ?? [];
    const reason = input.development_type_reason?.trim();

    if (!developmentType) {
      return {
        type: "need_user_input",
        evidence: ["主对话未提供 development_type；按协议需要先判断开发类型后再调用 start。"],
        missingContext: ["development_type（feature/bugfix/need_user_input）"]
      };
    }

    if (developmentType === "need_user_input") {
      return {
        type: "need_user_input",
        evidence:
          evidenceFromInput.length > 0
            ? evidenceFromInput
            : ["主对话无法明确判断开发类型，需要用户补充这是新增功能还是 BUG 修改。"],
        missingContext:
          missingContextFromInput.length > 0
            ? missingContextFromInput
            : ["请明确这是新增功能还是 BUG 修改。"]
      };
    }

    return {
      type: developmentType,
      evidence:
        evidenceFromInput.length > 0
          ? evidenceFromInput
          : [
              reason
                ? `主对话判定开发类型: ${developmentType}；理由: ${reason}`
                : `主对话判定开发类型: ${developmentType}`
            ],
      missingContext: []
    };
  }

  private buildNeedsUserInputResponse(
    sessionAlias: string,
    taskId: string,
    startDecision: StartPhaseDecision,
    developmentDecision?: DevelopmentTypeDecision
  ): Record<string, unknown> {
    const missingContext = Array.from(
      new Set([...startDecision.missingContext, ...(developmentDecision?.missingContext ?? [])])
    );
    const developmentTypePayload = developmentDecision
      ? this.toDevelopmentDecisionPayload(developmentDecision)
      : {
          detected_development_type: null,
          development_type_evidence: [],
          document_profile: null
        };
    return {
      task_id: taskId,
      session_alias: sessionAlias,
      workflow_status: "NEEDS_USER_INPUT",
      current_stage: "NEEDS_USER_INPUT",
      next_action_required: ["provide_context_then_restart"],
      business_stage: "上下文补充",
      business_reason: "当前信息还不足以判断应进入哪个业务阶段，或无法判断这是新增功能还是 BUG 修改。",
      next_business_action:
        "请先选择是否进入 ian-think 需求挖掘；若不进入，请直接补充缺失上下文后重新判断业务阶段和开发类型",
      user_message:
        "当前信息还不足以进入下一步。你可以先进入 ian-think 做需求挖掘（适合一句话或模糊需求），也可以直接补充缺失的方案、计划、实施约定，或明确这是新增功能还是 BUG 修改。",
      detected_start_phase: null,
      detection_evidence: startDecision.evidence,
      ...developmentTypePayload,
      missing_context: missingContext
    };
  }

  private buildNeedsMainPhaseResponse(
    workspacePath: string,
    sessionAlias: string,
    taskId: string,
    phase: "design" | "planning",
    requirementText: string,
    detectionEvidence: string[],
    developmentDecision: DevelopmentTypeDecision
  ): Record<string, unknown> {
    const developmentPayload = this.toDevelopmentDecisionPayload(developmentDecision);
    const outputDocument = buildPhaseDocumentOutput(phase, sessionAlias, workspacePath);
    const planningSource = this.buildPlanningSourcePayload(workspacePath, sessionAlias, requirementText);
    if (phase === "design") {
      return {
        task_id: taskId,
        session_alias: sessionAlias,
        workflow_status: "NEEDS_MAIN_DESIGN",
        current_stage: "NEEDS_MAIN_DESIGN",
        business_stage: "方案制定",
        business_reason: "当前还没有完整方案，需要先完成方案制定。",
        next_business_action: `由主会话先完成“写方案前前置梳理（清单+逐节点流程+异常控制点+用户确认循环）”，确认后再制定方案并写入 ${outputDocument.relativePath}`,
        user_message: `当前还没有完整方案，需要先进入方案制定阶段。按约定方案制定由主会话执行，不需要选择 ACP 模型；但在写方案前，必须先基于代码完成前置梳理并让用户确认，确认后才能输出 Markdown 方案文件，路径为 ${outputDocument.relativePath}。`,
        required_output_document: {
          phase: "design",
          relative_path: outputDocument.relativePath,
          absolute_path: outputDocument.absolutePath,
          rule: "必须创建或更新该 Markdown 文件，不允许只在对话中输出方案文字"
        },
        detected_start_phase: "design",
        detection_evidence: detectionEvidence,
        ...developmentPayload,
        next_action_required: ["main_or_acp_selection"],
        default_option: "1",
        user_options: [
          {
            option: "1",
            label: "主会话执行（默认）",
            description: `由主会话先完成设计文档并写入 ${outputDocument.relativePath}，完成后再次调用 start 进入下一阶段`
          },
          {
            option: "2",
            label: "委派 ACP 执行",
            description: "重新调用 start，并传 design_planning_executor=acp"
          }
        ]
      };
    }

    return {
      task_id: taskId,
      session_alias: sessionAlias,
      workflow_status: "NEEDS_MAIN_PLANNING",
      current_stage: "NEEDS_MAIN_PLANNING",
      business_stage: "计划制定",
      business_reason: "当前已有方案，但还需要制定可执行计划。",
      next_business_action: `由主会话先读取或确认方案来源，再制定计划，并写入 ${outputDocument.relativePath}`,
      user_message: `当前已有方案，需要进入计划制定阶段。按约定计划制定由主会话执行，不需要选择 ACP 模型；计划必须对齐方案来源，输出必须是 Markdown 文档，路径为 ${outputDocument.relativePath}。`,
      planning_source: planningSource,
      required_output_document: {
        phase: "planning",
        relative_path: outputDocument.relativePath,
        absolute_path: outputDocument.absolutePath,
        rule: "必须创建或更新该 Markdown 文件，不允许只在对话中输出计划文字"
      },
      detected_start_phase: "planning",
      detection_evidence: detectionEvidence,
      ...developmentPayload,
      next_action_required: ["main_or_acp_selection"],
      default_option: "1",
      user_options: [
        {
          option: "1",
          label: "主会话执行（默认）",
          description: `由主会话先完成计划文档并写入 ${outputDocument.relativePath}，完成后再次调用 start 进入实现阶段`
        },
        {
          option: "2",
          label: "委派 ACP 执行",
          description: "重新调用 start，并传 design_planning_executor=acp"
        }
      ]
    };
  }

  private buildPlanningSourcePayload(
    workspacePath: string,
    sessionAlias: string,
    requirementText: string
  ): Record<string, unknown> {
    const designDocumentPaths = this.extractMarkdownPaths(requirementText, workspacePath);
    const expectedGeneratedDesignDocument = buildPhaseDocumentOutput("design", sessionAlias, workspacePath);
    if (designDocumentPaths.length > 0) {
      return {
        source_type: "design_document_path",
        design_document_paths: designDocumentPaths,
        rule:
          "计划必须先读取这些方案文档，并逐项对齐方案中的设计目标、业务流程、契约、状态机、数据模型、配置项、异常矩阵和验收标准。"
      };
    }

    return {
      source_type: "inline_design_from_requirement",
      expected_generated_design_document: {
        relative_path: expectedGeneratedDesignDocument.relativePath,
        absolute_path: expectedGeneratedDesignDocument.absolutePath
      },
      rule:
        "若方案由主会话刚生成，必须在重新 start 时把方案文件路径写入 requirement_text；若方案由用户直接提供，则计划必须以 requirement_text 中的方案正文为依据。若二者都没有，不得编写计划，必须要求补充方案来源。"
    };
  }

  private toBusinessStage(phase: WorkflowEntryPhase | "need_user_input"): string {
    if (phase === "design") {
      return "方案制定";
    }
    if (phase === "planning") {
      return "计划制定";
    }
    if (phase === "implementation") {
      return "计划实施";
    }
    return "上下文补充";
  }

  private toDevelopmentDecisionPayload(decision: DevelopmentTypeDecision): Record<string, unknown> {
    if (decision.type === "need_user_input") {
      return {
        detected_development_type: null,
        development_type_evidence: decision.evidence,
        document_profile: null
      };
    }
    return {
      detected_development_type: decision.type,
      development_type_evidence: decision.evidence,
      document_profile: this.toDocumentProfilePayload(decision.type)
    };
  }

  private toDocumentProfilePayload(developmentType: DevelopmentType): Record<string, unknown> {
    const profile = DOCUMENT_PROFILES[developmentType];
    return {
      development_type: profile.developmentType,
      label: profile.label,
      guide_source: "team-delegate skill docs",
      skill_name: TEAM_DELEGATE_SKILL_NAME,
      skill_docs_dir: TEAM_DELEGATE_SKILL_DOCS_DIR,
      design_guide: toInstalledSkillGuidePath(profile.designGuideFile),
      planning_guide: toInstalledSkillGuidePath(profile.planningGuideFile),
      design_guide_relative_path: toSkillGuideRelativePath(profile.designGuideFile),
      planning_guide_relative_path: toSkillGuideRelativePath(profile.planningGuideFile),
      design_required_sections: profile.designRequiredSections,
      planning_required_sections: profile.planningRequiredSections
    };
  }

  private toWorkflowKey(workspacePath: string, sessionAlias: string): string {
    return `${this.normalizeWorkflowWorkspacePath(workspacePath)}::${sessionAlias}`;
  }

  private normalizeWorkflowWorkspacePath(workspacePath: string): string {
    return this.normalizeWorkspaceKey(workspacePath);
  }

  private isSameWorkflowWorkspacePath(left: string, right: string): boolean {
    return this.normalizeWorkflowWorkspacePath(left) === this.normalizeWorkflowWorkspacePath(right);
  }

  private findWorkflowInMemoryByIdentity(
    workspacePath: string,
    sessionAlias: string
  ): { workflowKey: string; workflow: TaskWorkflowState } | undefined {
    for (const [workflowKey, workflow] of this.workflowByKey.entries()) {
      if (workflow.sessionAlias !== sessionAlias) {
        continue;
      }
      if (!this.isSameWorkflowWorkspacePath(workflow.workspacePath, workspacePath)) {
        continue;
      }
      return { workflowKey, workflow };
    }
    return undefined;
  }

  private async findPersistedWorkflowByIdentity(
    workspacePath: string,
    sessionAlias: string
  ): Promise<DelegateWorkflowRecord | undefined> {
    let records: DelegateWorkflowRecord[];
    try {
      records = await this.store.listWorkflows();
    } catch (error) {
      this.logger.warn("workflow.persisted_lookup_by_identity_failed", {
        workspacePath,
        sessionAlias,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
    return records.find((item) => {
      return item.sessionAlias === sessionAlias && this.isSameWorkflowWorkspacePath(item.workspacePath, workspacePath);
    });
  }

  private async migrateWorkflowKeyIfNeeded(
    workflow: TaskWorkflowState,
    previousWorkflowKey: string,
    expectedWorkflowKey: string
  ): Promise<void> {
    if (previousWorkflowKey === expectedWorkflowKey) {
      return;
    }
    try {
      await this.persistWorkflowState(workflow);
      await this.store.deleteWorkflow(previousWorkflowKey);
    } catch (error) {
      this.logger.warn("workflow.key_migration_failed", {
        previousWorkflowKey,
        expectedWorkflowKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async loadWorkflowState(workspacePath: string, sessionAlias: string): Promise<TaskWorkflowState> {
    const key = this.toWorkflowKey(workspacePath, sessionAlias);
    const state = this.workflowByKey.get(key);
    if (state) {
      return state;
    }

    const memoryMatched = this.findWorkflowInMemoryByIdentity(workspacePath, sessionAlias);
    if (memoryMatched) {
      if (memoryMatched.workflowKey !== key) {
        this.workflowByKey.delete(memoryMatched.workflowKey);
        await this.clearPendingStartInput(memoryMatched.workflowKey);
        this.workflowByKey.set(key, memoryMatched.workflow);
      }
      return memoryMatched.workflow;
    }

    let record = await this.findPersistedWorkflow(key);
    if (!record) {
      record = await this.findPersistedWorkflowByIdentity(workspacePath, sessionAlias);
    }
    if (record) {
      const restored = this.restoreWorkflowState(record);
      this.workflowByKey.set(key, restored);
      if (record.workflowKey !== key) {
        this.workflowByKey.delete(record.workflowKey);
        await this.clearPendingStartInput(record.workflowKey);
        await this.migrateWorkflowKeyIfNeeded(restored, record.workflowKey, key);
      }
      return restored;
    }

    throw new BridgeError(
      ErrorCodes.WORKFLOW_NOT_FOUND,
      "未找到进行中的委派流程，请先使用 action=start",
      false
    );
  }

  private async findPersistedWorkflow(workflowKey: string): Promise<DelegateWorkflowRecord | undefined> {
    try {
      return await this.store.findWorkflowByKey(workflowKey);
    } catch (error) {
      this.logger.warn("workflow.persisted_lookup_failed", {
        workflowKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async findWorkflowByTaskId(
    workspacePath: string,
    taskId: string
  ): Promise<TaskWorkflowState | undefined> {
    const normalizedWorkspacePath = this.normalizeWorkflowWorkspacePath(workspacePath);
    for (const [workflowKey, workflow] of this.workflowByKey.entries()) {
      if (this.normalizeWorkflowWorkspacePath(workflow.workspacePath) !== normalizedWorkspacePath || workflow.taskId !== taskId) {
        continue;
      }
      const expectedWorkflowKey = this.toWorkflowKey(workflow.workspacePath, workflow.sessionAlias);
      if (workflowKey !== expectedWorkflowKey) {
        this.workflowByKey.delete(workflowKey);
        await this.clearPendingStartInput(workflowKey);
        this.workflowByKey.set(expectedWorkflowKey, workflow);
      } else {
        this.workflowByKey.set(workflowKey, workflow);
      }
      return workflow;
    }

    let records: DelegateWorkflowRecord[];
    try {
      records = await this.store.listWorkflows();
    } catch {
      return undefined;
    }
    const record = records.find((item) => {
      if (this.normalizeWorkflowWorkspacePath(item.workspacePath) !== normalizedWorkspacePath) {
        return false;
      }
      const recordTaskId = this.readString(item.snapshot.taskId) ?? item.sessionAlias;
      return recordTaskId === taskId;
    });
    if (!record) {
      return undefined;
    }

    const restored = this.restoreWorkflowState(record);
    const expectedWorkflowKey = this.toWorkflowKey(restored.workspacePath, restored.sessionAlias);
    this.workflowByKey.set(expectedWorkflowKey, restored);
    if (record.workflowKey !== expectedWorkflowKey) {
      this.workflowByKey.delete(record.workflowKey);
      await this.clearPendingStartInput(record.workflowKey);
      await this.migrateWorkflowKeyIfNeeded(restored, record.workflowKey, expectedWorkflowKey);
    }
    return restored;
  }

  private async cleanupExpiredOtherTaskWorkflows(workspacePath: string, currentTaskId: string): Promise<void> {
    const normalizedWorkspacePath = this.normalizeWorkflowWorkspacePath(workspacePath);
    let records: DelegateWorkflowRecord[];
    try {
      records = await this.store.listWorkflows();
    } catch (error) {
      this.logger.warn("workflow.expired.lookup_failed", {
        currentTaskId,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    const expiredBeforeMs = Date.now() - TASK_ACP_KEEPALIVE_CLEANUP_MS;
    for (const record of records) {
      if (this.normalizeWorkflowWorkspacePath(record.workspacePath) !== normalizedWorkspacePath) {
        continue;
      }
      const recordTaskId = this.readString(record.snapshot.taskId) ?? record.sessionAlias;
      if (recordTaskId === currentTaskId) {
        continue;
      }
      const lastActiveAtMs = Date.parse(record.updatedAt) || Date.parse(record.createdAt);
      if (!Number.isFinite(lastActiveAtMs) || lastActiveAtMs > expiredBeforeMs) {
        continue;
      }

      if (this.sessionApi) {
        try {
          await this.close({
            bridge_session_id: record.bridgeSessionId,
            force: true,
            timeout_ms: 10_000
          });
        } catch (error) {
          this.logger.warn("workflow.expired.close_failed", {
            taskId: recordTaskId,
            bridgeSessionId: record.bridgeSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      await this.store.deleteWorkflow(record.workflowKey);
      const expectedWorkflowKey = this.toWorkflowKey(record.workspacePath, record.sessionAlias);
      this.workflowByKey.delete(record.workflowKey);
      await this.clearPendingStartInput(record.workflowKey);
      this.workflowByKey.delete(expectedWorkflowKey);
      await this.clearPendingStartInput(expectedWorkflowKey);
    }
  }

  private async persistWorkflowState(workflow: TaskWorkflowState): Promise<void> {
    const workflowKey = this.toWorkflowKey(workflow.workspacePath, workflow.sessionAlias);
    const timestamp = now();
    try {
      const existing = await this.store.findWorkflowByKey(workflowKey);
      await this.store.saveWorkflow({
        workflowKey,
        workspacePath: workflow.workspacePath,
        sessionAlias: workflow.sessionAlias,
        bridgeSessionId: workflow.bridgeSessionId,
        stage: workflow.stage,
        snapshot: this.toWorkflowSnapshot(workflow),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
    } catch (error) {
      this.logger.warn("workflow.persist_failed", {
        workflowKey,
        stage: workflow.stage,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private persistWorkflowStateSoon(workflow: TaskWorkflowState): void {
    void this.persistWorkflowState(workflow);
  }

  private toWorkflowSnapshot(workflow: TaskWorkflowState): Record<string, unknown> {
    return {
      workflowId: workflow.workflowId,
      taskId: workflow.taskId,
      sessionAlias: workflow.sessionAlias,
      workspacePath: workflow.workspacePath,
      bridgeSessionId: workflow.bridgeSessionId,
      activeModel: workflow.activeModel,
      activeAgentMode: workflow.activeAgentMode,
      fallbackModels: workflow.fallbackModels,
      requirementText: workflow.requirementText,
      detectedStartPhase: workflow.detectedStartPhase,
      detectionEvidence: workflow.detectionEvidence,
      developmentType: workflow.developmentType,
      developmentTypeEvidence: workflow.developmentTypeEvidence,
      acceptanceCriteria: workflow.acceptanceCriteria,
      maxReworkRounds: workflow.maxReworkRounds,
      autoClose: workflow.autoClose,
      timeoutMs: workflow.timeoutMs,
      syncWaitMs: workflow.syncWaitMs,
      stage: workflow.stage,
      activePhase: workflow.activePhase,
      activePhaseStartedAt: workflow.activePhaseStartedAt,
      lastCompletedAt: workflow.lastCompletedAt,
      lastError: workflow.lastError,
      completedPayload: workflow.completedPayload,
      deliveryTestPassed: workflow.deliveryTestPassed,
      deliveryTestResult: workflow.deliveryTestResult,
      deliveryTestFailures: workflow.deliveryTestFailures,
      remediationRound: workflow.remediationRound,
      pendingRemediationPlan: workflow.pendingRemediationPlan,
      lastImplementationResult: workflow.lastImplementationResult,
      handoffRequested: workflow.handoffRequested,
      pollIntervalMs: workflow.pollIntervalMs,
      pollIntervalMinMs: workflow.pollIntervalMinMs,
      pollIntervalMaxMs: workflow.pollIntervalMaxMs,
      silenceDecisionMs: workflow.silenceDecisionMs,
      currentPollCount: workflow.currentPollCount,
      currentPollCycle: workflow.currentPollCycle,
      consecutiveTimeoutDefaultContinueCount: workflow.consecutiveTimeoutDefaultContinueCount,
      lastCountedPollAtMs: workflow.lastCountedPollAtMs,
      nextPollDueAtMs: workflow.nextPollDueAtMs,
      lastProgressAtMs: workflow.lastProgressAtMs,
      lastProgressAt: workflow.lastProgressAt,
      userDecisionPromptedAtMs: workflow.userDecisionPromptedAtMs,
      userDecisionPromptedAt: workflow.userDecisionPromptedAt,
      userDecisionTimeoutAtMs: workflow.userDecisionTimeoutAtMs,
      userDecisionTimeoutAt: workflow.userDecisionTimeoutAt,
      lastTimeoutDefaultAutoContinueAtMs: workflow.lastTimeoutDefaultAutoContinueAtMs,
      lastTimeoutDefaultAutoContinueAt: workflow.lastTimeoutDefaultAutoContinueAt,
      progressCursorByTurn: workflow.progressCursorByTurn,
      lastProgressUpdate: workflow.lastProgressUpdate,
      phaseGates: workflow.phaseGates,
      steps: workflow.steps,
      idempotencySeq: workflow.idempotencySeq
    };
  }

  private restoreWorkflowState(record: DelegateWorkflowRecord): TaskWorkflowState {
    const snapshot = record.snapshot;
    const savedStage = this.readWorkflowStage(snapshot.stage) ?? this.readWorkflowStage(record.stage) ?? "FAILED";
    const restoredWithoutRunner = this.isRunningStage(savedStage);
    const stage = savedStage;

    return {
      workflowId: this.readString(snapshot.workflowId) ?? `${Date.now()}`,
      taskId: this.readString(snapshot.taskId) ?? record.sessionAlias,
      sessionAlias: record.sessionAlias,
      workspacePath: record.workspacePath,
      bridgeSessionId: record.bridgeSessionId,
      activeModel: this.readString(snapshot.activeModel),
      activeAgentMode: this.readAgentMode(snapshot.activeAgentMode),
      fallbackModels: this.readStringArray(snapshot.fallbackModels),
      requirementText: this.readString(snapshot.requirementText) ?? "",
      detectedStartPhase: this.readWorkflowEntryPhase(snapshot.detectedStartPhase) ?? "implementation",
      detectionEvidence: this.readStringArray(snapshot.detectionEvidence),
      developmentType: this.readDevelopmentType(snapshot.developmentType) ?? "feature",
      developmentTypeEvidence: this.readStringArray(snapshot.developmentTypeEvidence),
      acceptanceCriteria: this.readString(snapshot.acceptanceCriteria),
      maxReworkRounds: this.readNumber(snapshot.maxReworkRounds) ?? 2,
      autoClose: this.readBoolean(snapshot.autoClose) ?? true,
      timeoutMs: this.readNumber(snapshot.timeoutMs),
      syncWaitMs: this.readNumber(snapshot.syncWaitMs) ?? (this.runtime.workflowSyncWaitMs ?? DEFAULT_WORKFLOW_SYNC_WAIT_MS),
      stage,
      activePhase: this.readWorkflowPhase(snapshot.activePhase),
      activePhaseStartedAt: this.readString(snapshot.activePhaseStartedAt),
      lastCompletedAt: this.readString(snapshot.lastCompletedAt),
      restoredWithoutRunner,
      lastError: this.readError(snapshot.lastError),
      completedPayload: this.readRecord(snapshot.completedPayload),
      deliveryTestPassed: this.readBoolean(snapshot.deliveryTestPassed),
      deliveryTestResult: this.readString(snapshot.deliveryTestResult),
      deliveryTestFailures: this.readStringArray(snapshot.deliveryTestFailures),
      remediationRound: this.readNumber(snapshot.remediationRound) ?? 0,
      pendingRemediationPlan: this.readString(snapshot.pendingRemediationPlan),
      lastImplementationResult: this.readRecord(snapshot.lastImplementationResult),
      handoffRequested: this.readBoolean(snapshot.handoffRequested),
      pollIntervalMs: this.readNumber(snapshot.pollIntervalMs) ?? DEFAULT_WORKFLOW_POLL_INTERVAL_MS,
      pollIntervalMinMs: this.readNumber(snapshot.pollIntervalMinMs) ?? DEFAULT_WORKFLOW_POLL_INTERVAL_MIN_MS,
      pollIntervalMaxMs: this.readNumber(snapshot.pollIntervalMaxMs) ?? DEFAULT_WORKFLOW_POLL_INTERVAL_MAX_MS,
      silenceDecisionMs: this.readNumber(snapshot.silenceDecisionMs) ?? DEFAULT_WORKFLOW_SILENCE_DECISION_MS,
      currentPollCount: this.readNumber(snapshot.currentPollCount) ?? 0,
      currentPollCycle: this.readNumber(snapshot.currentPollCycle) ?? 0,
      consecutiveTimeoutDefaultContinueCount: this.readNumber(snapshot.consecutiveTimeoutDefaultContinueCount) ?? 0,
      lastCountedPollAtMs: this.readNumber(snapshot.lastCountedPollAtMs),
      nextPollDueAtMs: this.readNumber(snapshot.nextPollDueAtMs),
      lastProgressAtMs: this.readNumber(snapshot.lastProgressAtMs),
      lastProgressAt: this.readString(snapshot.lastProgressAt),
      userDecisionPromptedAtMs: this.readNumber(snapshot.userDecisionPromptedAtMs),
      userDecisionPromptedAt: this.readString(snapshot.userDecisionPromptedAt),
      userDecisionTimeoutAtMs: this.readNumber(snapshot.userDecisionTimeoutAtMs),
      userDecisionTimeoutAt: this.readString(snapshot.userDecisionTimeoutAt),
      lastTimeoutDefaultAutoContinueAtMs: this.readNumber(snapshot.lastTimeoutDefaultAutoContinueAtMs),
      lastTimeoutDefaultAutoContinueAt: this.readString(snapshot.lastTimeoutDefaultAutoContinueAt),
      progressCursorByTurn: this.readNumberRecord(snapshot.progressCursorByTurn),
      lastProgressUpdate: this.readProgressUpdate(snapshot.lastProgressUpdate),
      phaseGates: this.readPhaseGates(snapshot.phaseGates),
      steps: this.readWorkflowSteps(snapshot.steps),
      idempotencySeq: this.readNumber(snapshot.idempotencySeq) ?? 0
    };
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private readNumberRecord(value: unknown): Record<string, number> {
    const record = this.readRecord(value);
    if (!record) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    );
  }

  private readWorkflowStage(value: unknown): WorkflowStage | undefined {
    const stage = this.readString(value);
    const allowed: WorkflowStage[] = [
      "RUNNING_DESIGN",
      "WAITING_DESIGN_APPROVAL",
      "RUNNING_PLANNING",
      "WAITING_PLAN_APPROVAL",
      "RUNNING_IMPLEMENTATION",
      "NEEDS_DELIVERY_TEST",
      "DELIVERY_TEST_FAILED",
      "RUNNING_REMEDIATION",
      "NEEDS_ACP_SESSION_DECISION",
      "NEEDS_REMEDIATION_DECISION",
      "NEEDS_USER_DECISION",
      "TRANSFERRED_TO_MAIN",
      "CANCELLED",
      "COMPLETED",
      "FAILED"
    ];
    return stage && allowed.includes(stage as WorkflowStage) ? (stage as WorkflowStage) : undefined;
  }

  private readWorkflowPhase(value: unknown): WorkflowPhase | undefined {
    const phase = this.readString(value);
    return phase === "design" || phase === "planning" || phase === "implementation" || phase === "rework"
      ? phase
      : undefined;
  }

  private readWorkflowEntryPhase(value: unknown): WorkflowEntryPhase | undefined {
    const phase = this.readString(value);
    return phase === "design" || phase === "planning" || phase === "implementation" ? phase : undefined;
  }

  private readDevelopmentType(value: unknown): DevelopmentType | undefined {
    const developmentType = this.readString(value);
    return developmentType === "feature" || developmentType === "bugfix" ? developmentType : undefined;
  }

  private readAgentMode(value: unknown): "plan" | "build" | undefined {
    const mode = this.readString(value);
    return mode === "plan" || mode === "build" ? mode : undefined;
  }

  private readError(value: unknown): { code: string; message: string; retryable: boolean } | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }
    const code = this.readString(record.code);
    const message = this.readString(record.message);
    if (!code || !message) {
      return undefined;
    }
    return {
      code,
      message,
      retryable: this.readBoolean(record.retryable) ?? false
    };
  }

  private readProgressUpdate(value: unknown): WorkflowProgressUpdate | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }
    return {
      hasNewOutput: this.readBoolean(record.hasNewOutput) ?? false,
      text: this.readString(record.text) ?? "",
      eventCount: this.readNumber(record.eventCount) ?? 0,
      turnId: this.readString(record.turnId),
      latestEventSeq: this.readNumber(record.latestEventSeq),
      observedAt: this.readString(record.observedAt) ?? now()
    };
  }

  private readPhaseGates(value: unknown): TaskWorkflowState["phaseGates"] {
    const record = this.readRecord(value);
    if (!record) {
      return {};
    }
    return {
      design: this.readWorkflowGate(record.design),
      planning: this.readWorkflowGate(record.planning)
    };
  }

  private readWorkflowGate(value: unknown): WorkflowGateState | undefined {
    const record = this.readRecord(value);
    if (!record) {
      return undefined;
    }
    return {
      passed: this.readBoolean(record.passed) ?? false,
      attempts: this.readNumber(record.attempts) ?? 0,
      missingSections: this.readStringArray(record.missingSections)
    };
  }

  private readWorkflowSteps(value: unknown): WorkflowStep[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((item) => {
      const record = this.readRecord(item);
      const phase = this.readWorkflowPhase(record?.phase);
      if (!record || !phase) {
        return [];
      }
      const step: WorkflowStep = {
        phase,
        turn_id: this.readString(record.turn_id),
        stop_reason: this.readString(record.stop_reason),
        summary: this.readString(record.summary),
        success: this.readBoolean(record.success) ?? false,
        error: this.readError(record.error)
      };
      return [step];
    });
  }

  private workflowHasActiveRuntime(workflow: TaskWorkflowState): boolean {
    return Boolean(workflow.pendingTask || this.activeTurnByBridgeSession.get(workflow.bridgeSessionId));
  }

  private async rebindWorkflowActiveTurnFromStore(workflow: TaskWorkflowState): Promise<boolean> {
    const session = await this.store.findSessionById(workflow.bridgeSessionId);
    if (!session) {
      return false;
    }

    let turnId = session.activeTurnId;
    if (!turnId && session.status === "ACTIVE") {
      const turns = await this.store.listTurns(session.bridgeSessionId);
      const runningTurn = turns.filter((turn) => turn.status === "RUNNING").at(-1);
      if (runningTurn) {
        turnId = runningTurn.turnId;
        session.activeTurnId = turnId;
        session.updatedAt = now();
        await this.store.saveSession(session);
      }
    }

    if (!turnId) {
      return false;
    }

    this.activeTurnByBridgeSession.set(workflow.bridgeSessionId, turnId);
    if (!this.eventSeqByTurn.has(turnId)) {
      const events = await this.store.listEvents(turnId);
      const latestEventSeq = events[events.length - 1]?.eventSeq ?? 0;
      this.eventSeqByTurn.set(turnId, latestEventSeq);
    }
    return true;
  }

  private async probeWorkflowAcpEndpoint(workflow: TaskWorkflowState): Promise<{
    ok: true;
  } | {
    ok: false;
    error: { code: string; message: string; retryable: boolean };
  }> {
    try {
      await this.ensureAcpReady(workflow.timeoutMs ?? 15_000);
    } catch (error) {
      const bridgeError = this.normalizeError(error, ErrorCodes.ACP_PROCESS_UNAVAILABLE);
      return {
        ok: false,
        error: {
          code: bridgeError.code,
          message: bridgeError.message,
          retryable: bridgeError.retryable
        }
      };
    }

    const session = await this.store.findSessionById(workflow.bridgeSessionId);
    if (!session) {
      return {
        ok: false,
        error: {
          code: ErrorCodes.SESSION_NOT_FOUND,
          message: "未找到对应的 ACP 会话记录",
          retryable: false
        }
      };
    }

    const timeoutMs = workflow.timeoutMs ?? 15_000;
    try {
      const resumed = await this.mustApi().resumeSession(session.acpSessionId, workflow.workspacePath, timeoutMs);
      session.acpSessionId = resumed.sessionId;
      if (resumed.configOptions && resumed.configOptions.length > 0) {
        session.configOptions = resumed.configOptions;
        session.currentModel = resumed.configOptions.find((item) => item.id === "model")?.currentValue;
      }
      session.processPid = this.processSupervisor.getPid();
      session.updatedAt = now();
      await this.store.saveSession(session);
      return { ok: true };
    } catch {
      try {
        const loaded = await this.mustApi().loadSession(
          session.acpSessionId,
          workflow.workspacePath,
          this.runtime.mcpServers ?? [],
          timeoutMs
        );
        session.acpSessionId = loaded.sessionId;
        if (loaded.configOptions && loaded.configOptions.length > 0) {
          session.configOptions = loaded.configOptions;
          session.currentModel = loaded.configOptions.find((item) => item.id === "model")?.currentValue;
        }
        session.processPid = this.processSupervisor.getPid();
        session.updatedAt = now();
        await this.store.saveSession(session);
        return { ok: true };
      } catch (error) {
        const bridgeError = this.normalizeError(error, ErrorCodes.SESSION_NOT_READY);
        return {
          ok: false,
          error: {
            code: ErrorCodes.SESSION_NOT_READY,
            message: `ACP 执行端不可用或已结束: ${bridgeError.message}`,
            retryable: false
          }
        };
      }
    }
  }

  private markWorkflowNeedsAcpSessionDecision(
    workflow: TaskWorkflowState,
    error: { code: string; message: string; retryable: boolean }
  ): void {
    workflow.stage = "NEEDS_ACP_SESSION_DECISION";
    workflow.activePhase = undefined;
    workflow.activePhaseStartedAt = undefined;
    workflow.pendingTask = undefined;
    workflow.lastCompletedAt = now();
    workflow.lastError = error;
    workflow.lastProgressUpdate = {
      hasNewOutput: false,
      text: "检测到 ACP 执行端已结束或不可用，需选择主会话接手或终止流程。",
      eventCount: 0,
      observedAt: now()
    };
    this.clearUserDecisionWindow(workflow);
    this.activeTurnByBridgeSession.delete(workflow.bridgeSessionId);
  }

  private async ensureWorkflowRuntimeContext(workflow: TaskWorkflowState): Promise<void> {
    if (!this.isRunningStage(workflow.stage)) {
      return;
    }

    if (this.workflowHasActiveRuntime(workflow)) {
      workflow.restoredWithoutRunner = false;
      workflow.lastError = undefined;
      return;
    }

    const reboundFromStore = await this.rebindWorkflowActiveTurnFromStore(workflow);
    if (reboundFromStore) {
      workflow.restoredWithoutRunner = false;
      workflow.lastError = undefined;
      return;
    }

    const endpointProbe = await this.probeWorkflowAcpEndpoint(workflow);
    if (!endpointProbe.ok) {
      this.markWorkflowNeedsAcpSessionDecision(workflow, endpointProbe.error);
      return;
    }

    const reboundAfterProbe = await this.rebindWorkflowActiveTurnFromStore(workflow);
    workflow.restoredWithoutRunner = !reboundAfterProbe;
    if (reboundAfterProbe) {
      workflow.lastError = undefined;
    }
  }

  private async restoreExistingWorkflowForStart(workflowKey: string): Promise<TaskWorkflowState | undefined> {
    const existing = this.workflowByKey.get(workflowKey);
    if (existing) {
      return this.isTerminalStage(existing.stage) ? undefined : existing;
    }

    const record = await this.findPersistedWorkflow(workflowKey);
    if (!record) {
      return undefined;
    }

    const restored = this.restoreWorkflowState(record);
    if (this.isTerminalStage(restored.stage)) {
      return undefined;
    }
    this.workflowByKey.set(workflowKey, restored);
    return restored;
  }

  private isTerminalStage(stage: WorkflowStage): boolean {
    return (
      stage === "COMPLETED" ||
      stage === "FAILED" ||
      stage === "TRANSFERRED_TO_MAIN" ||
      stage === "CANCELLED"
    );
  }

  private assertWorkflowStage(
    workflow: TaskWorkflowState,
    allowedStages: WorkflowStage[],
    action: ExecuteTaskAction
  ): void {
    if (workflow.pendingTask) {
      throw new BridgeError(
        ErrorCodes.WORKFLOW_INVALID_TRANSITION,
        `当前阶段 ${workflow.stage} 仍在执行中，请先调用 status 查询进度`,
        false
      );
    }
    if (allowedStages.includes(workflow.stage)) {
      return;
    }
    throw new BridgeError(
      ErrorCodes.WORKFLOW_INVALID_TRANSITION,
      `当前阶段为 ${workflow.stage}，不允许执行 ${action}`,
      false
    );
  }

  private requireFeedback(feedbackText: string | undefined, action: ExecuteTaskAction): string {
    const feedback = feedbackText?.trim();
    if (!feedback) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, `${action} 需要 feedback_text`, false);
    }
    return feedback;
  }

  private ensureWorkflowSlotAvailable(workflowKey: string): void {
    const existing = this.workflowByKey.get(workflowKey);
    if (!existing) {
      return;
    }
    if (this.isTerminalStage(existing.stage)) {
      this.workflowByKey.delete(workflowKey);
      return;
    }
    throw new BridgeError(
      ErrorCodes.WORKFLOW_INVALID_TRANSITION,
      "该 session_alias 已存在进行中的委派流程，请先完成或更换 session_alias",
      false
    );
  }

  private launchWorkflowByEntryPhase(workflow: TaskWorkflowState): void {
    if (workflow.detectedStartPhase === "planning") {
      this.launchWorkflowPhase(workflow, "RUNNING_PLANNING", "planning", async () => {
        await this.runPlanningPhase(workflow);
      });
      return;
    }
    if (workflow.detectedStartPhase === "implementation") {
      this.launchWorkflowPhase(workflow, "RUNNING_IMPLEMENTATION", "implementation", async () => {
        workflow.lastImplementationResult = await this.runImplementationPhase(workflow);
        this.enterDeliveryTestGate(workflow);
      });
      return;
    }
    this.launchWorkflowPhase(workflow, "RUNNING_DESIGN", "design", async () => {
      await this.runDesignPhase(workflow, "run");
    });
  }

  private launchWorkflowPhase(
    workflow: TaskWorkflowState,
    runningStage: "RUNNING_DESIGN" | "RUNNING_PLANNING" | "RUNNING_IMPLEMENTATION" | "RUNNING_REMEDIATION",
    phase: WorkflowPhase,
    runner: () => Promise<void>
  ): void {
    if (workflow.pendingTask) {
      throw new BridgeError(ErrorCodes.WORKFLOW_INVALID_TRANSITION, "当前已有运行中的阶段任务", false);
    }
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    workflow.stage = runningStage;
    workflow.activePhase = phase;
    workflow.activePhaseStartedAt = startedAt;
    workflow.lastError = undefined;
    workflow.restoredWithoutRunner = false;
    workflow.handoffRequested = false;
    workflow.lastProgressAtMs = startedAtMs;
    workflow.lastProgressAt = startedAt;
    workflow.lastProgressUpdate = undefined;
    workflow.userDecisionPromptedAtMs = undefined;
    workflow.userDecisionPromptedAt = undefined;
    workflow.userDecisionTimeoutAtMs = undefined;
    workflow.userDecisionTimeoutAt = undefined;
    workflow.progressCursorByTurn = {};
    this.resetWorkflowPollCycle(workflow);
    this.persistWorkflowStateSoon(workflow);
    const task = (async () => {
      try {
        await runner();
      } catch (error) {
        if (workflow.handoffRequested) {
          workflow.stage = "TRANSFERRED_TO_MAIN";
          return;
        }
        const bridgeError = this.normalizeError(error);
        workflow.lastError = {
          code: bridgeError.code,
          message: bridgeError.message,
          retryable: bridgeError.retryable
        };
        workflow.stage = "FAILED";
      } finally {
        workflow.lastCompletedAt = now();
        workflow.activePhase = undefined;
        workflow.pendingTask = undefined;
        workflow.restoredWithoutRunner = false;
        this.persistWorkflowStateSoon(workflow);
      }
    })();
    workflow.pendingTask = task;
  }

  private async waitForWorkflowShortSyncWindow(workflow: TaskWorkflowState): Promise<void> {
    const maxWait = Math.max(0, workflow.syncWaitMs);
    if (maxWait === 0) {
      return;
    }
    const started = Date.now();
    const pollIntervalMs = 50;
    while (workflow.pendingTask && Date.now() - started < maxWait) {
      const elapsed = Date.now() - started;
      const remaining = Math.max(1, maxWait - elapsed);
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  private async waitForWorkflowFollowUpDue(workflow: TaskWorkflowState): Promise<void> {
    const dueAtMs = workflow.nextPollDueAtMs;
    if (dueAtMs === undefined || !this.workflowHasActiveRuntime(workflow) || !this.isFollowUpGatedStage(workflow.stage)) {
      return;
    }

    while (this.shouldWaitForWorkflowFollowUpDue(workflow, dueAtMs)) {
      const remainingMs = dueAtMs - Date.now();
      if (remainingMs <= 0) {
        return;
      }
      await sleep(Math.min(WORKFLOW_FOLLOW_UP_GATE_CHECK_MS, remainingMs));
    }
  }

  private shouldWaitForWorkflowFollowUpDue(workflow: TaskWorkflowState, dueAtMs: number): boolean {
    return this.workflowHasActiveRuntime(workflow) && this.isFollowUpGatedStage(workflow.stage) && Date.now() < dueAtMs;
  }

  public async detectWorkflowEntry(
    workspacePath: string,
    sessionAlias: string,
    requirementText: string,
    timeoutMs?: number
  ): Promise<WorkflowEntryDetection> {
    const evidence: string[] = [];
    const requirement = requirementText.trim();

    const fileContext = await this.loadContextFromReferencedDocs(workspacePath, requirement);
    if (fileContext.loadedPaths.length > 0) {
      evidence.push(`读取上下文文档: ${fileContext.loadedPaths.join(" | ")}`);
    }

    const historyContext = await this.loadHistoricalWorkflowContext(workspacePath, sessionAlias);
    if (historyContext.length > 0) {
      evidence.push("复用同 session_alias 的历史输出上下文");
    }

    const mergedRequirementText = this.mergeContextForPrompt(requirement, fileContext.content, historyContext);
    const modelDecision = await this.classifyWorkflowEntryViaModel({
      workspacePath,
      sessionAlias,
      requirementText: requirement,
      mergedContextText: mergedRequirementText,
      timeoutMs
    });
    if (modelDecision) {
      const reason = modelDecision.reason?.trim();
      const missingContext =
        modelDecision.phase === "need_user_input" && modelDecision.missingContext.length === 0
          ? ["请补充设计/计划上下文，或明确说明从哪个阶段开始。"]
          : modelDecision.missingContext;
      evidence.push(
        `模型判定起始阶段: ${modelDecision.phase}${reason ? `；理由: ${reason}` : ""}`
      );
      return {
        phase: modelDecision.phase,
        evidence,
        missingContext,
        mergedRequirementText
      };
    }

    evidence.push("模型判定未产出可解析结果，按规则返回 NEEDS_USER_INPUT");
    return {
      phase: "need_user_input",
      evidence,
      missingContext: ["请补充明确上下文后重试（设计稿、计划稿或明确指定从哪个阶段开始）。"],
      mergedRequirementText
    };
  }

  private async classifyWorkflowEntryViaModel(input: {
    workspacePath: string;
    sessionAlias: string;
    requirementText: string;
    mergedContextText: string;
    timeoutMs?: number;
  }): Promise<WorkflowEntryModelDecision | null> {
    try {
      const probeAlias = `${input.sessionAlias}-stage-probe`;
      const initResult = await this.initSession({
        workspace_path: input.workspacePath,
        session_alias: probeAlias,
        session_strategy: "auto",
        timeout_ms: input.timeoutMs
      });
      if (!initResult.success || !initResult.data) {
        return null;
      }

      const bridgeSessionId = (initResult.data as { bridge_session_id?: string }).bridge_session_id;
      if (!bridgeSessionId) {
        return null;
      }

      const turnResult = await this.executeTurn(
        "run",
        bridgeSessionId,
        `workflow-stage-detect-${Date.now()}`,
        this.buildWorkflowEntryJudgePrompt(input.requirementText, input.mergedContextText),
        input.timeoutMs
      );
      if (!turnResult.success || !turnResult.data) {
        return null;
      }

      const turnData = turnResult.data as { turn_id?: string; summary?: string };
      const parsedFromSummary = this.parseWorkflowEntryModelDecision(turnData.summary ?? "");
      if (parsedFromSummary) {
        return parsedFromSummary;
      }

      const waitUntil = Date.now() + STAGE_DETECTION_PARSE_WAIT_MS;
      while (true) {
        const parsedFromMessages = await this.collectAndParseWorkflowEntryModelDecision(
          turnData.turn_id,
          turnData.summary ?? ""
        );
        if (parsedFromMessages) {
          return parsedFromMessages;
        }
        if (Date.now() >= waitUntil) {
          break;
        }
        await sleep(STAGE_DETECTION_PARSE_POLL_MS);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async collectAndParseWorkflowEntryModelDecision(
    turnId: string | undefined,
    summary: string
  ): Promise<WorkflowEntryModelDecision | null> {
    const messageOnly = await this.collectTurnOutputRawText(turnId, summary, (eventType) =>
      eventType.includes("agent_message")
    );
    const parsedFromMessage = this.parseWorkflowEntryModelDecision(messageOnly);
    if (parsedFromMessage) {
      return parsedFromMessage;
    }
    const mergedText = await this.collectTurnOutputRawText(turnId, summary);
    return this.parseWorkflowEntryModelDecision(mergedText);
  }

  private parseWorkflowEntryModelDecision(text: string): WorkflowEntryModelDecision | null {
    const candidates = this.extractJsonObjects(text);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const parsed = this.parseWorkflowEntryDecisionCandidate(candidates[index]);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  private parseWorkflowEntryDecisionCandidate(candidate: string): WorkflowEntryModelDecision | null {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const phaseRaw = parsed.phase;
      const validPhases: Array<WorkflowEntryPhase | "need_user_input"> = [
        "design",
        "planning",
        "implementation",
        "need_user_input"
      ];
      if (typeof phaseRaw !== "string" || !validPhases.includes(phaseRaw as WorkflowEntryPhase)) {
        return null;
      }

      const missingRaw = parsed.missing_context;
      const missingContext = Array.isArray(missingRaw)
        ? missingRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;

      return {
        phase: phaseRaw as WorkflowEntryPhase | "need_user_input",
        missingContext,
        reason
      };
    } catch {
      return null;
    }
  }

  private extractJsonObjects(text: string): string[] {
    const candidates: string[] = [];
    const trimmed = text.trim();
    if (trimmed.startsWith("```")) {
      const stripped = trimmed.replace(/^```[a-zA-Z]*\s*/u, "").replace(/\s*```$/u, "").trim();
      if (stripped.startsWith("{") && stripped.endsWith("}")) {
        candidates.push(stripped);
      }
    }

    let start = -1;
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index];
      if (ch === "{") {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
      } else if (ch === "}") {
        if (depth <= 0) {
          continue;
        }
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          start = -1;
        }
      }
    }
    return candidates;
  }

  private async loadContextFromReferencedDocs(
    workspacePath: string,
    text: string
  ): Promise<{ content: string; loadedPaths: string[] }> {
    const filePaths = this.extractMarkdownPaths(text, workspacePath);
    const loadedPaths: string[] = [];
    const chunks: string[] = [];
    for (const filePath of filePaths.slice(0, 5)) {
      try {
        const content = await readFile(filePath, "utf8");
        loadedPaths.push(filePath);
        chunks.push(`### 文件: ${filePath}\n${content}`);
      } catch {
        // 忽略不可读路径，保留后续路径尝试。
      }
    }
    return {
      content: chunks.join("\n\n"),
      loadedPaths
    };
  }

  private loadContextFromReferencedDocsSync(
    workspacePath: string,
    text: string
  ): { content: string; loadedPaths: string[]; failedPaths: string[] } {
    const filePaths = this.extractMarkdownPaths(text, workspacePath);
    const loadedPaths: string[] = [];
    const failedPaths: string[] = [];
    const chunks: string[] = [];
    for (const filePath of filePaths.slice(0, 5)) {
      try {
        const content = readFileSync(filePath, "utf8");
        loadedPaths.push(filePath);
        chunks.push(`### 方案文件: ${filePath}\n${content}`);
      } catch {
        failedPaths.push(filePath);
      }
    }
    return {
      content: chunks.join("\n\n"),
      loadedPaths,
      failedPaths
    };
  }

  private extractMarkdownPaths(text: string, workspacePath: string): string[] {
    const candidates = new Set<string>();
    const absolutePattern =
      /[A-Za-z]:[\\/](?:[^\s"'`<>|,;:，。；：、）)]+[\\/])*[^\s"'`<>|,;:，。；：、）)]+\.m(?:d|arkdown)/gi;
    const relativePattern =
      /(?:\.{1,2}[\\/][^\s"'`<>|,;:，。；：、）)]+\.m(?:d|arkdown)|(?:[A-Za-z0-9_.-]+[\\/])+(?:[^\s"'`<>|,;:，。；：、）)]+\.m(?:d|arkdown)))/gi;
    const sanitize = (value: string): string => value.replace(/[),.;，。；：、）]+$/g, "");
    const absoluteSpans: Array<{ start: number; end: number }> = [];

    for (const match of text.matchAll(absolutePattern)) {
      if (match.index === undefined) {
        continue;
      }
      const candidate = sanitize(match[0]);
      candidates.add(resolve(candidate));
      absoluteSpans.push({
        start: match.index,
        end: match.index + match[0].length
      });
    }
    for (const match of text.matchAll(relativePattern)) {
      if (match.index === undefined) {
        continue;
      }
      const insideAbsolute = absoluteSpans.some(
        (span) => match.index! >= span.start && match.index! < span.end
      );
      if (insideAbsolute) {
        continue;
      }
      const candidate = sanitize(match[0]);
      if (/^https?:\/\//i.test(candidate)) {
        continue;
      }
      if (isAbsolute(candidate)) {
        candidates.add(resolve(candidate));
        continue;
      }
      candidates.add(resolve(workspacePath, candidate));
    }
    return Array.from(candidates);
  }

  private async loadHistoricalWorkflowContext(workspacePath: string, sessionAlias: string): Promise<string> {
    const existing = await this.store.findSessionByAlias(workspacePath, sessionAlias);
    if (!existing) {
      return "";
    }
    const turns = await this.store.listTurns(existing.bridgeSessionId);
    const completedTurns = turns.filter((turn) => turn.status === "COMPLETED").slice(-4);
    const chunks: string[] = [];
    for (const turn of completedTurns) {
      const output = await this.collectTurnOutputText(turn.turnId, "");
      if (output.trim().length > 0) {
        chunks.push(output);
      }
    }
    return chunks.join("\n\n");
  }

  private mergeContextForPrompt(requirement: string, fileContext: string, historyContext: string): string {
    const extras = [fileContext, historyContext].filter((item) => item.length > 0);
    if (extras.length === 0) {
      return requirement;
    }
    let merged = requirement;
    for (const extra of extras) {
      const block = `\n\n[上下文补充]\n${extra}`;
      if (merged.length + block.length <= MAX_DETECTION_CONTEXT_CHARS) {
        merged += block;
        continue;
      }
      const remaining = Math.max(0, MAX_DETECTION_CONTEXT_CHARS - merged.length - "\n\n[上下文补充]\n".length);
      if (remaining > 0) {
        merged += `\n\n[上下文补充]\n${extra.slice(0, remaining)}`;
      }
      break;
    }
    return merged;
  }

  private async trackWorkflowStatusPoll(workflow: TaskWorkflowState): Promise<void> {
    if (!this.isRunningStage(workflow.stage)) {
      workflow.lastProgressUpdate = undefined;
      return;
    }

    const nowMs = Date.now();
    const progress = await this.collectWorkflowProgressDelta(workflow);
    if (progress.hasNewOutput) {
      const observedAt = new Date(nowMs).toISOString();
      workflow.lastProgressAtMs = nowMs;
      workflow.lastProgressAt = observedAt;
      workflow.lastProgressUpdate = {
        ...progress,
        observedAt
      };
      workflow.currentPollCount = 0;
      workflow.consecutiveTimeoutDefaultContinueCount = 0;
      workflow.stage = this.resolveRunningStageByPhase(workflow.activePhase);
      this.clearUserDecisionWindow(workflow);
      this.scheduleNextWorkflowPoll(workflow, nowMs, true);
      return;
    }

    workflow.lastProgressUpdate = {
      ...progress,
      observedAt: new Date(nowMs).toISOString()
    };

    workflow.lastCountedPollAtMs = nowMs;
    workflow.currentPollCount += 1;
    const silenceStartedAtMs = workflow.lastProgressAtMs ?? nowMs;
    const silenceMs = nowMs - silenceStartedAtMs;
    if (silenceMs >= workflow.silenceDecisionMs) {
      workflow.stage = "NEEDS_USER_DECISION";
      this.ensureUserDecisionWindow(workflow, nowMs);
    } else if (workflow.stage !== "NEEDS_USER_DECISION") {
      this.clearUserDecisionWindow(workflow);
    }
    this.scheduleNextWorkflowPoll(workflow, nowMs, false);
  }

  private resetWorkflowPollCycle(workflow: TaskWorkflowState): void {
    workflow.currentPollCount = 0;
    workflow.lastCountedPollAtMs = undefined;
    workflow.currentPollCycle = Math.max(workflow.currentPollCycle || 0, 0) + 1;
    this.scheduleNextWorkflowPoll(workflow, Date.now(), false);
  }

  private scheduleNextWorkflowPoll(
    workflow: TaskWorkflowState,
    nowMs: number,
    hadProgress: boolean
  ): void {
    const delayMs = this.nextFlexiblePollDelayMs(workflow, hadProgress);
    workflow.pollIntervalMs = delayMs;
    workflow.nextPollDueAtMs = nowMs + delayMs;
  }

  private nextFlexiblePollDelayMs(workflow: TaskWorkflowState, hadProgress: boolean): number {
    const minMs = Math.max(1, workflow.pollIntervalMinMs);
    const maxMs = Math.max(minMs, workflow.pollIntervalMaxMs);
    const spanMs = maxMs - minMs;
    if (spanMs === 0) {
      return minMs;
    }

    const halfSpanMs = spanMs / 2;
    const randomOffsetMs = Math.floor(Math.random() * halfSpanMs);
    if (hadProgress) {
      return Math.min(maxMs, Math.floor(minMs + halfSpanMs + randomOffsetMs));
    }
    return Math.min(maxMs, Math.floor(minMs + randomOffsetMs));
  }

  private isRunningStage(stage: WorkflowStage): boolean {
    return (
      stage === "RUNNING_DESIGN" ||
      stage === "RUNNING_PLANNING" ||
      stage === "RUNNING_IMPLEMENTATION" ||
      stage === "RUNNING_REMEDIATION" ||
      stage === "NEEDS_USER_DECISION"
    );
  }

  private isFollowUpGatedStage(stage: WorkflowStage): boolean {
    return (
      stage === "RUNNING_DESIGN" ||
      stage === "RUNNING_PLANNING" ||
      stage === "RUNNING_IMPLEMENTATION" ||
      stage === "RUNNING_REMEDIATION"
    );
  }

  private resolveRunningStageByPhase(
    phase: WorkflowPhase | undefined
  ): "RUNNING_DESIGN" | "RUNNING_PLANNING" | "RUNNING_IMPLEMENTATION" | "RUNNING_REMEDIATION" {
    if (!phase) {
      throw new BridgeError(ErrorCodes.WORKFLOW_INVALID_TRANSITION, "当前没有可恢复等待的运行阶段", false);
    }
    if (phase === "design") {
      return "RUNNING_DESIGN";
    }
    if (phase === "planning") {
      return "RUNNING_PLANNING";
    }
    if (phase === "rework") {
      return "RUNNING_REMEDIATION";
    }
    return "RUNNING_IMPLEMENTATION";
  }

  private resolveContinueWaitDecisionSource(input: ExecuteTaskInput): ContinueWaitDecisionSource {
    return input.decision_source === "timeout_default" ? "timeout_default" : "user_selected";
  }

  private ensureUserDecisionWindow(workflow: TaskWorkflowState, nowMs: number = Date.now()): void {
    if (!this.canUseTimeoutDefaultContinue(workflow)) {
      workflow.userDecisionTimeoutAtMs = undefined;
      workflow.userDecisionTimeoutAt = undefined;
      return;
    }
    if (workflow.userDecisionPromptedAtMs === undefined) {
      workflow.userDecisionPromptedAtMs = nowMs;
      workflow.userDecisionPromptedAt = new Date(nowMs).toISOString();
    }
    if (workflow.userDecisionTimeoutAtMs === undefined) {
      const timeoutAtMs = workflow.userDecisionPromptedAtMs + DEFAULT_USER_DECISION_TIMEOUT_DEFAULT_AFTER_MS;
      workflow.userDecisionTimeoutAtMs = timeoutAtMs;
      workflow.userDecisionTimeoutAt = new Date(timeoutAtMs).toISOString();
    }
  }

  private clearUserDecisionWindow(workflow: TaskWorkflowState): void {
    workflow.userDecisionPromptedAtMs = undefined;
    workflow.userDecisionPromptedAt = undefined;
    workflow.userDecisionTimeoutAtMs = undefined;
    workflow.userDecisionTimeoutAt = undefined;
  }

  private applyContinueWaitDecision(
    workflow: TaskWorkflowState,
    decisionSource: ContinueWaitDecisionSource
  ): void {
    const continuedAtMs = Date.now();
    workflow.lastProgressAtMs = continuedAtMs;
    workflow.lastProgressAt = new Date(continuedAtMs).toISOString();
    workflow.lastProgressUpdate = undefined;
    if (decisionSource === "timeout_default") {
      workflow.consecutiveTimeoutDefaultContinueCount += 1;
      workflow.lastTimeoutDefaultAutoContinueAtMs = continuedAtMs;
      workflow.lastTimeoutDefaultAutoContinueAt = workflow.lastProgressAt;
    } else {
      workflow.consecutiveTimeoutDefaultContinueCount = 0;
    }
    this.clearUserDecisionWindow(workflow);
    this.resetWorkflowPollCycle(workflow);
    workflow.stage = this.resolveRunningStageByPhase(workflow.activePhase);
  }

  private tryAutoContinueByTimeoutDefault(workflow: TaskWorkflowState): boolean {
    if (!this.canUseTimeoutDefaultContinue(workflow)) {
      return false;
    }
    this.ensureUserDecisionWindow(workflow);
    const timeoutAtMs = workflow.userDecisionTimeoutAtMs;
    if (timeoutAtMs === undefined || Date.now() < timeoutAtMs) {
      return false;
    }
    this.assertContinueWaitAllowed(workflow, "timeout_default");
    this.applyContinueWaitDecision(workflow, "timeout_default");
    return true;
  }

  private canUseTimeoutDefaultContinue(workflow: TaskWorkflowState): boolean {
    return (
      workflow.stage === "NEEDS_USER_DECISION" &&
      workflow.consecutiveTimeoutDefaultContinueCount < MAX_CONSECUTIVE_TIMEOUT_DEFAULT_CONTINUES
    );
  }

  private assertContinueWaitAllowed(
    workflow: TaskWorkflowState,
    decisionSource: ContinueWaitDecisionSource
  ): void {
    if (workflow.stage !== "NEEDS_USER_DECISION") {
      throw new BridgeError(
        ErrorCodes.WORKFLOW_INVALID_TRANSITION,
        "当前无需 continue_wait，只有在 NEEDS_USER_DECISION 且任务仍在运行时才可继续等待",
        false
      );
    }
    if (decisionSource === "timeout_default" && !this.canUseTimeoutDefaultContinue(workflow)) {
      throw new BridgeError(
        ErrorCodes.WORKFLOW_INVALID_TRANSITION,
        "连续无人响应默认继续次数已达到上限，必须由用户明确选择后才能继续",
        false
      );
    }
  }

  private async handoffWorkflowToMain(
    workflow: TaskWorkflowState,
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    workflow.handoffRequested = true;
    if (workflow.pendingTask) {
      const cancelResult = await this.cancel({
        bridge_session_id: workflow.bridgeSessionId,
        timeout_ms: timeoutMs ?? workflow.timeoutMs
      });
      if (!cancelResult.success && cancelResult.error?.code !== ErrorCodes.NO_ACTIVE_TURN) {
        this.logger.warn("workflow.handoff.cancel_failed", {
          bridgeSessionId: workflow.bridgeSessionId,
          code: cancelResult.error?.code,
          message: cancelResult.error?.message
        });
      }
    }

    const closeResult = await this.close({
      bridge_session_id: workflow.bridgeSessionId,
      force: true,
      timeout_ms: timeoutMs ?? workflow.timeoutMs
    });
    if (!closeResult.success) {
      if (
        closeResult.error?.code === ErrorCodes.ACP_PROCESS_UNAVAILABLE ||
        closeResult.error?.code === ErrorCodes.SESSION_NOT_READY
      ) {
        this.logger.warn("workflow.handoff.close_unavailable", {
          bridgeSessionId: workflow.bridgeSessionId,
          code: closeResult.error.code,
          message: closeResult.error.message
        });
      } else {
      const error = closeResult.error ?? {
        code: ErrorCodes.SESSION_CLOSE_FAILED,
        message: "转交主会话时关闭 ACP 会话失败",
        retryable: true
      };
      throw new BridgeError(error.code as ErrorCode, error.message, error.retryable);
      }
    }

    workflow.stage = "TRANSFERRED_TO_MAIN";
    workflow.lastCompletedAt = now();
    workflow.pendingTask = undefined;
    workflow.activePhase = undefined;
    workflow.lastError = undefined;

    return {
      session_alias: workflow.sessionAlias,
      bridge_session_id: workflow.bridgeSessionId,
      workflow_status: "TRANSFERRED_TO_MAIN",
      current_stage: "TRANSFERRED_TO_MAIN",
      next_action_required: null,
      cancelled: true,
      closed: true
    };
  }

  private enterDeliveryTestGate(workflow: TaskWorkflowState): void {
    workflow.stage = "NEEDS_DELIVERY_TEST";
    workflow.activePhase = undefined;
    workflow.activePhaseStartedAt = undefined;
    workflow.lastCompletedAt = now();
  }

  private async handleDeliveryTestPass(
    workflow: TaskWorkflowState,
    feedbackText: string | undefined,
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    this.assertWorkflowStage(workflow, ["NEEDS_DELIVERY_TEST"], "delivery_test_pass");
    const closed = await this.closeWorkflowSessionIfNeeded(workflow, timeoutMs, "交付测试通过后关闭 ACP 会话失败");
    workflow.deliveryTestPassed = true;
    workflow.deliveryTestResult = feedbackText?.trim() || "真实业务交付测试通过";
    workflow.stage = "COMPLETED";
    workflow.lastCompletedAt = now();
    workflow.completedPayload = {
      ...this.buildWorkflowBasePayload(workflow),
      current_stage: "COMPLETED",
      workflow_status: "COMPLETED",
      business_stage: "交付完成",
      user_message: "真实业务交付测试已通过，本次任务可以判定完成。",
      next_business_action: null,
      next_action_required: null,
      workflow_completed: true,
      delivery_test_passed: true,
      delivery_test_result: workflow.deliveryTestResult,
      auto_closed: closed
    };
    return workflow.completedPayload;
  }

  private async handleDeliveryTestFail(workflow: TaskWorkflowState, failureText: string): Promise<void> {
    this.assertWorkflowStage(workflow, ["NEEDS_DELIVERY_TEST"], "delivery_test_fail");
    workflow.deliveryTestPassed = false;
    workflow.deliveryTestFailures.push(failureText);
    workflow.deliveryTestResult = failureText;
    workflow.pendingRemediationPlan = undefined;
    if (workflow.remediationRound >= MAX_REMEDIATION_ROUNDS) {
      workflow.stage = "NEEDS_REMEDIATION_DECISION";
      workflow.lastCompletedAt = now();
      return;
    }
    workflow.stage = "DELIVERY_TEST_FAILED";
    workflow.lastCompletedAt = now();
  }

  private async handleRemediationApprove(
    workflow: TaskWorkflowState,
    remediationPlanText: string
  ): Promise<void> {
    this.assertWorkflowStage(workflow, ["DELIVERY_TEST_FAILED"], "remediation_approve");
    if (workflow.remediationRound >= MAX_REMEDIATION_ROUNDS) {
      workflow.stage = "NEEDS_REMEDIATION_DECISION";
      return;
    }
    workflow.pendingRemediationPlan = remediationPlanText;
    const ready = await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, false);
    if (!ready) {
      return;
    }
    workflow.remediationRound += 1;
    this.launchWorkflowPhase(workflow, "RUNNING_REMEDIATION", "rework", async () => {
      await this.runRemediationImplementationPhase(workflow);
      this.enterDeliveryTestGate(workflow);
    });
  }

  private async handleRestartAcpSession(workflow: TaskWorkflowState): Promise<void> {
    this.assertWorkflowStage(workflow, ["NEEDS_ACP_SESSION_DECISION"], "restart_acp_session");
    if (!workflow.pendingRemediationPlan) {
      throw new BridgeError(
        ErrorCodes.WORKFLOW_INVALID_TRANSITION,
        "当前没有可交给新 ACP 会话继续执行的整改方案",
        false
      );
    }
    if (workflow.remediationRound >= MAX_REMEDIATION_ROUNDS) {
      workflow.stage = "NEEDS_REMEDIATION_DECISION";
      return;
    }
    const ready = await this.ensureWorkflowAcpSessionReadyOrDecision(workflow, true);
    if (!ready) {
      return;
    }
    workflow.remediationRound += 1;
    this.launchWorkflowPhase(workflow, "RUNNING_REMEDIATION", "rework", async () => {
      await this.runRemediationImplementationPhase(workflow);
      this.enterDeliveryTestGate(workflow);
    });
  }

  private async ensureWorkflowAcpSessionReadyOrDecision(
    workflow: TaskWorkflowState,
    allowNewSession: boolean
  ): Promise<boolean> {
    const result = await this.ensureWorkflowAcpSessionReady(workflow, allowNewSession);
    if (result.ok) {
      return true;
    }
    workflow.stage = "NEEDS_ACP_SESSION_DECISION";
    workflow.activePhase = undefined;
    workflow.activePhaseStartedAt = undefined;
    workflow.pendingTask = undefined;
    workflow.lastCompletedAt = now();
    workflow.lastError = result.error;
    return false;
  }

  private async ensureWorkflowAcpSessionReady(
    workflow: TaskWorkflowState,
    allowNewSession: boolean
  ): Promise<{ ok: true } | { ok: false; error: { code: string; message: string; retryable: boolean } }> {
    if (this.sessionApi && !allowNewSession) {
      return { ok: true };
    }

    const initResult = await this.initSession({
      workspace_path: workflow.workspacePath,
      session_alias: workflow.sessionAlias,
      session_strategy: allowNewSession ? "new" : "auto",
      preferred_model: workflow.activeModel,
      timeout_ms: workflow.timeoutMs
    });

    if (!initResult.success || !initResult.data) {
      return {
        ok: false,
        error: initResult.error ?? {
          code: ErrorCodes.SESSION_NOT_READY,
          message: "当前任务对应的 ACP 会话无法恢复",
          retryable: true
        }
      };
    }

    const data = initResult.data as {
      bridge_session_id?: string;
      current_model?: string;
    };
    if (data.bridge_session_id) {
      workflow.bridgeSessionId = data.bridge_session_id;
    }
    if (data.current_model) {
      workflow.activeModel = data.current_model;
    }
    workflow.lastError = undefined;
    return { ok: true };
  }

  private async handleCancelFollowUp(
    workflow: TaskWorkflowState,
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    this.assertWorkflowStage(workflow, ["NEEDS_REMEDIATION_DECISION", "NEEDS_ACP_SESSION_DECISION"], "cancel_follow_up");
    const closed = await this.closeWorkflowSessionIfNeeded(workflow, timeoutMs, "取消后续工作时关闭 ACP 会话失败");
    workflow.stage = "CANCELLED";
    workflow.lastCompletedAt = now();
    workflow.pendingTask = undefined;
    workflow.activePhase = undefined;
    return {
      ...this.buildWorkflowBasePayload(workflow),
      current_stage: "CANCELLED",
      workflow_status: "CANCELLED",
      business_stage: "后续工作已取消",
      user_message: "已取消后续工作。本次任务未通过真实业务交付测试，不能声明交付完成。",
      next_business_action: null,
      next_action_required: null,
      workflow_completed: false,
      delivery_test_passed: false,
      auto_closed: closed
    };
  }

  private async closeWorkflowSessionIfNeeded(
    workflow: TaskWorkflowState,
    timeoutMs: number | undefined,
    failureMessage: string
  ): Promise<boolean> {
    if (!workflow.autoClose) {
      return false;
    }
    const closeResult = await this.close({
      bridge_session_id: workflow.bridgeSessionId,
      force: true,
      timeout_ms: timeoutMs ?? workflow.timeoutMs
    });
    if (!closeResult.success) {
      const error = closeResult.error ?? {
        code: ErrorCodes.SESSION_CLOSE_FAILED,
        message: failureMessage,
        retryable: true
      };
      throw new BridgeError(error.code as ErrorCode, error.message, error.retryable);
    }
    return true;
  }

  private nextWorkflowIdempotencyKey(workflow: TaskWorkflowState, label: string): string {
    workflow.idempotencySeq += 1;
    return `workflow-${workflow.workflowId}-${label}-${workflow.idempotencySeq}`;
  }

  private buildWorkflowModelCandidates(preferredModel?: string): string[] {
    const first = preferredModel?.trim();
    if (first) {
      return [first];
    }
    return [DEFAULT_WORKFLOW_MODELS[0]];
  }

  private async selectInitialWorkflowModel(
    workflow: TaskWorkflowState,
    preferredModel?: string
  ): Promise<void> {
    const candidates = this.buildWorkflowModelCandidates(preferredModel);
    const errors: string[] = [];
    for (const model of candidates) {
      const setResult = await this.setConfig({
        bridge_session_id: workflow.bridgeSessionId,
        config_id: "model",
        value: model,
        timeout_ms: workflow.timeoutMs
      });
      if (setResult.success) {
        workflow.activeModel = model;
        workflow.fallbackModels = [];
        return;
      }
      errors.push(`${model}:${setResult.error?.code ?? ErrorCodes.CONFIG_VALUE_INVALID}`);
    }

    throw new BridgeError(
      ErrorCodes.CONFIG_VALUE_INVALID,
      `模型设置失败，候选模型均不可用: ${errors.join(", ")}`,
      true
    );
  }

  private async setWorkflowAgentMode(
    workflow: TaskWorkflowState,
    mode: "plan" | "build",
    strict = false
  ): Promise<void> {
    const setResult = await this.setConfig({
      bridge_session_id: workflow.bridgeSessionId,
      config_id: "mode",
      value: mode,
      timeout_ms: workflow.timeoutMs
    });
    if (setResult.success) {
      workflow.activeAgentMode = mode;
      return;
    }
    if (strict) {
      const error = setResult.error ?? {
        code: ErrorCodes.CONFIG_VALUE_INVALID,
        message: `切换会话模式失败: ${mode}`,
        retryable: true
      };
      throw new BridgeError(error.code as ErrorCode, error.message, error.retryable);
    }
  }

  private async executeWorkflowTurnWithModelFallback(
    workflow: TaskWorkflowState,
    phaseLabel: string,
    turnType: "run" | "rework",
    promptText: string
  ): Promise<BridgeResult<unknown>> {
    const attemptKey = this.nextWorkflowIdempotencyKey(workflow, phaseLabel);
    return this.executeTurn(
      turnType,
      workflow.bridgeSessionId,
      attemptKey,
      promptText,
      workflow.timeoutMs
    );
  }

  private async startWorkflow(
    input: ExecuteTaskInput,
    sessionAlias: string,
    taskId: string,
    timeoutMs: number | undefined,
    detectedStartPhase: WorkflowEntryPhase,
    detectionEvidence: string[],
    developmentType: DevelopmentType = "feature",
    developmentTypeEvidence: string[] = []
  ): Promise<TaskWorkflowState> {
    const workflowTurnTimeoutMs = this.resolveWorkflowTurnTimeoutMs(timeoutMs);
    const initResult = await this.initSession({
      workspace_path: input.workspace_path,
      session_alias: sessionAlias,
      session_strategy: "auto",
      preferred_model: input.preferred_model,
      timeout_ms: timeoutMs
    });

    if (!initResult.success || !initResult.data) {
      const initError = initResult.error ?? {
        code: ErrorCodes.SESSION_NOT_READY,
        message: "会话初始化失败",
        retryable: true
      };
      throw new BridgeError(initError.code as ErrorCode, initError.message, initError.retryable);
    }

    const initData = initResult.data as {
      bridge_session_id?: string;
    };
    const bridgeSessionId = initData.bridge_session_id;
    if (!bridgeSessionId) {
      throw new BridgeError(ErrorCodes.SESSION_NOT_READY, "会话初始化返回缺少 bridge_session_id", true);
    }

    const workflow: TaskWorkflowState = {
      workflowId: `${Date.now()}`,
      taskId,
      sessionAlias,
      workspacePath: input.workspace_path,
      bridgeSessionId,
      fallbackModels: [],
      requirementText: input.requirement_text,
      detectedStartPhase,
      detectionEvidence,
      developmentType,
      developmentTypeEvidence,
      acceptanceCriteria: input.acceptance_criteria,
      maxReworkRounds: input.max_rework_rounds ?? 2,
      autoClose: input.auto_close ?? true,
      timeoutMs: workflowTurnTimeoutMs,
      syncWaitMs: this.runtime.workflowSyncWaitMs ?? DEFAULT_WORKFLOW_SYNC_WAIT_MS,
      stage: "RUNNING_DESIGN",
      deliveryTestFailures: [],
      remediationRound: 0,
      phaseGates: {},
      steps: [],
      idempotencySeq: 0,
      pollIntervalMs: DEFAULT_WORKFLOW_POLL_INTERVAL_MS,
      pollIntervalMinMs: DEFAULT_WORKFLOW_POLL_INTERVAL_MIN_MS,
      pollIntervalMaxMs: DEFAULT_WORKFLOW_POLL_INTERVAL_MAX_MS,
      silenceDecisionMs: DEFAULT_WORKFLOW_SILENCE_DECISION_MS,
      currentPollCount: 0,
      currentPollCycle: 0,
      consecutiveTimeoutDefaultContinueCount: 0,
      userDecisionPromptedAtMs: undefined,
      userDecisionPromptedAt: undefined,
      userDecisionTimeoutAtMs: undefined,
      userDecisionTimeoutAt: undefined,
      lastTimeoutDefaultAutoContinueAtMs: undefined,
      lastTimeoutDefaultAutoContinueAt: undefined,
      progressCursorByTurn: {}
    };

    await this.selectInitialWorkflowModel(workflow, input.preferred_model);
    await this.setWorkflowAgentMode(workflow, "plan", true);
    return workflow;
  }

  private resolveWorkflowTurnTimeoutMs(requestedTimeoutMs: number | undefined): number {
    if (requestedTimeoutMs === undefined) {
      return this.runtime.turnTimeoutMs;
    }
    return Math.max(requestedTimeoutMs, this.runtime.turnTimeoutMs);
  }

  private async runDesignPhase(workflow: TaskWorkflowState, turnType: "run" | "rework"): Promise<void> {
    const designResult = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      "design",
      turnType,
      this.buildDesignPrompt(workflow)
    );
    workflow.steps.push(this.turnResultToStep("design", designResult));
    this.ensureTurnSuccess(designResult, "设计委派失败");

    const designGate = await this.enforceDocumentGate({
      phase: "design",
      workflowId: workflow.workflowId,
      bridgeSessionId: workflow.bridgeSessionId,
      initialResult: designResult,
      requiredSections: DOCUMENT_PROFILES[workflow.developmentType].designRequiredSections,
      outputDocumentPath: buildPhaseDocumentOutput("design", workflow.sessionAlias, workflow.workspacePath).absolutePath,
      errorCode: ErrorCodes.DESIGN_GATE_FAILED,
      maxRounds: workflow.maxReworkRounds,
      timeoutMs: workflow.timeoutMs,
      steps: workflow.steps,
      repairPromptBuilder: (missingSections, round) =>
        this.buildDesignRepairPrompt(workflow, round, missingSections)
    });

    workflow.phaseGates.design = {
      passed: designGate.passed,
      attempts: designGate.attempts,
      missingSections: designGate.missingSections
    };
    workflow.stage = "WAITING_DESIGN_APPROVAL";
  }

  private async applyDesignFeedback(workflow: TaskWorkflowState, feedback: string): Promise<void> {
    const result = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      "design-feedback",
      "rework",
      this.buildDesignFeedbackPrompt(workflow, feedback)
    );
    workflow.steps.push(this.turnResultToStep("design", result));
    this.ensureTurnSuccess(result, "设计修订委派失败");

    const designGate = await this.enforceDocumentGate({
      phase: "design",
      workflowId: workflow.workflowId,
      bridgeSessionId: workflow.bridgeSessionId,
      initialResult: result,
      requiredSections: DOCUMENT_PROFILES[workflow.developmentType].designRequiredSections,
      outputDocumentPath: buildPhaseDocumentOutput("design", workflow.sessionAlias, workflow.workspacePath).absolutePath,
      errorCode: ErrorCodes.DESIGN_GATE_FAILED,
      maxRounds: workflow.maxReworkRounds,
      timeoutMs: workflow.timeoutMs,
      steps: workflow.steps,
      repairPromptBuilder: (missingSections, round) =>
        this.buildDesignRepairPrompt(workflow, round, missingSections)
    });

    workflow.phaseGates.design = {
      passed: designGate.passed,
      attempts: designGate.attempts,
      missingSections: designGate.missingSections
    };
    workflow.stage = "WAITING_DESIGN_APPROVAL";
  }

  private async runPlanningPhase(workflow: TaskWorkflowState): Promise<void> {
    const planningResult = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      "planning",
      "rework",
      this.buildPlanningPrompt(workflow)
    );
    workflow.steps.push(this.turnResultToStep("planning", planningResult));
    this.ensureTurnSuccess(planningResult, "计划委派失败");

    const planningGate = await this.enforceDocumentGate({
      phase: "planning",
      workflowId: workflow.workflowId,
      bridgeSessionId: workflow.bridgeSessionId,
      initialResult: planningResult,
      requiredSections: DOCUMENT_PROFILES[workflow.developmentType].planningRequiredSections,
      outputDocumentPath: buildPhaseDocumentOutput("planning", workflow.sessionAlias, workflow.workspacePath).absolutePath,
      errorCode: ErrorCodes.PLANNING_GATE_FAILED,
      maxRounds: workflow.maxReworkRounds,
      timeoutMs: workflow.timeoutMs,
      steps: workflow.steps,
      repairPromptBuilder: (missingSections, round) =>
        this.buildPlanningRepairPrompt(workflow, round, missingSections)
    });

    workflow.phaseGates.planning = {
      passed: planningGate.passed,
      attempts: planningGate.attempts,
      missingSections: planningGate.missingSections
    };
    workflow.stage = "WAITING_PLAN_APPROVAL";
  }

  private async applyPlanningFeedback(workflow: TaskWorkflowState, feedback: string): Promise<void> {
    const result = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      "planning-feedback",
      "rework",
      this.buildPlanningFeedbackPrompt(workflow, feedback)
    );
    workflow.steps.push(this.turnResultToStep("planning", result));
    this.ensureTurnSuccess(result, "计划修订委派失败");

    const planningGate = await this.enforceDocumentGate({
      phase: "planning",
      workflowId: workflow.workflowId,
      bridgeSessionId: workflow.bridgeSessionId,
      initialResult: result,
      requiredSections: DOCUMENT_PROFILES[workflow.developmentType].planningRequiredSections,
      outputDocumentPath: buildPhaseDocumentOutput("planning", workflow.sessionAlias, workflow.workspacePath).absolutePath,
      errorCode: ErrorCodes.PLANNING_GATE_FAILED,
      maxRounds: workflow.maxReworkRounds,
      timeoutMs: workflow.timeoutMs,
      steps: workflow.steps,
      repairPromptBuilder: (missingSections, round) =>
        this.buildPlanningRepairPrompt(workflow, round, missingSections)
    });

    workflow.phaseGates.planning = {
      passed: planningGate.passed,
      attempts: planningGate.attempts,
      missingSections: planningGate.missingSections
    };
    workflow.stage = "WAITING_PLAN_APPROVAL";
  }

  private async runImplementationPhase(workflow: TaskWorkflowState): Promise<Record<string, unknown>> {
    await this.setWorkflowAgentMode(workflow, "build", true);
    const implementationResult = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      "implementation",
      "rework",
      this.buildImplementationPrompt(workflow.requirementText, workflow.acceptanceCriteria)
    );
    workflow.steps.push(this.turnResultToStep("implementation", implementationResult));
    this.ensureTurnSuccess(implementationResult, "开发委派失败");

    let completedByModelSignal = await this.hasDoneSignal(implementationResult);

    for (let round = 1; round <= workflow.maxReworkRounds && !completedByModelSignal; round += 1) {
      const reworkResult = await this.executeWorkflowTurnWithModelFallback(
        workflow,
        `rework-${round}`,
        "rework",
        this.buildImplementationReworkPrompt(round, workflow.acceptanceCriteria)
      );
      workflow.steps.push(this.turnResultToStep("rework", reworkResult));
      this.ensureTurnSuccess(reworkResult, `第 ${round} 轮整改委派失败`);
      completedByModelSignal = await this.hasDoneSignal(reworkResult);
    }

    return {
      implementation_completed: completedByModelSignal,
      phase_gates: this.toPhaseGatesPayload(workflow),
      steps: workflow.steps
    };
  }

  private async runRemediationImplementationPhase(workflow: TaskWorkflowState): Promise<void> {
    await this.setWorkflowAgentMode(workflow, "build", true);
    const result = await this.executeWorkflowTurnWithModelFallback(
      workflow,
      `remediation-implementation-${workflow.remediationRound}`,
      "rework",
      this.buildRemediationImplementationPrompt(workflow)
    );
    workflow.steps.push(this.turnResultToStep("rework", result));
    this.ensureTurnSuccess(result, `第 ${workflow.remediationRound} 次整改实施失败`);
  }

  private buildWorkflowBasePayload(workflow: TaskWorkflowState): Record<string, unknown> {
    const nextFollowUpAt =
      workflow.nextPollDueAtMs !== undefined ? new Date(workflow.nextPollDueAtMs).toISOString() : undefined;
    const followUpPolicy = {
      interval_seconds: Math.floor(workflow.pollIntervalMs / 1000),
      interval_min_seconds: Math.floor(workflow.pollIntervalMinMs / 1000),
      interval_max_seconds: Math.floor(workflow.pollIntervalMaxMs / 1000),
      no_progress_decision_seconds: Math.floor(workflow.silenceDecisionMs / 1000),
      next_follow_up_at: nextFollowUpAt,
      guidance:
        "实施阶段必须满足 1-2 分钟持续跟进节奏；未到下一次持续跟进时间前，不向用户输出暂无进展。"
    };
    const base = {
      task_id: workflow.taskId,
      session_alias: workflow.sessionAlias,
      bridge_session_id: workflow.bridgeSessionId,
      detected_start_phase: workflow.detectedStartPhase,
      detection_evidence: workflow.detectionEvidence,
      detected_development_type: workflow.developmentType,
      development_type_evidence: workflow.developmentTypeEvidence,
      document_profile: this.toDocumentProfilePayload(workflow.developmentType),
      current_model: workflow.activeModel,
      current_agent_mode: workflow.activeAgentMode,
      workflow_status: workflow.stage,
      active_phase: workflow.activePhase ?? null,
      active_phase_started_at: workflow.activePhaseStartedAt,
      last_completed_at: workflow.lastCompletedAt,
      workflow_error: workflow.lastError,
      delivery_test_passed: workflow.deliveryTestPassed ?? false,
      delivery_test_result: workflow.deliveryTestResult,
      delivery_test_failures: workflow.deliveryTestFailures,
      remediation_round: workflow.remediationRound,
      max_remediation_rounds: MAX_REMEDIATION_ROUNDS,
      pending_remediation_plan: workflow.pendingRemediationPlan,
      last_implementation_result: workflow.lastImplementationResult,
      poll_policy: {
        interval_seconds: Math.floor(workflow.pollIntervalMs / 1000),
        interval_min_seconds: Math.floor(workflow.pollIntervalMinMs / 1000),
        interval_max_seconds: Math.floor(workflow.pollIntervalMaxMs / 1000),
        silence_timeout_seconds: Math.floor(workflow.silenceDecisionMs / 1000),
        decision_basis: "silence_timeout",
        current_poll_count: workflow.currentPollCount,
        current_poll_cycle: workflow.currentPollCycle,
        consecutive_timeout_defaults: workflow.consecutiveTimeoutDefaultContinueCount,
        last_timeout_default_auto_continue_at: workflow.lastTimeoutDefaultAutoContinueAt,
        next_poll_due_at: nextFollowUpAt
      },
      follow_up_policy: followUpPolicy,
      user_decision_policy: this.buildUserDecisionPolicy(workflow),
      progress_update: this.toProgressUpdatePayload(workflow),
      phase_gates: this.toPhaseGatesPayload(workflow),
      steps: workflow.steps
    };
    return base;
  }

  private buildUserDecisionPolicy(workflow: TaskWorkflowState): Record<string, unknown> {
    const allowTimeoutDefault = this.canUseTimeoutDefaultContinue(workflow);
    const waitingForDecision = workflow.stage === "NEEDS_USER_DECISION";
    if (waitingForDecision && allowTimeoutDefault) {
      this.ensureUserDecisionWindow(workflow);
    }
    const timeoutDeadlineAt =
      waitingForDecision && allowTimeoutDefault
        ? workflow.userDecisionTimeoutAt ?? new Date(workflow.userDecisionTimeoutAtMs ?? Date.now()).toISOString()
        : null;
    const timeoutRemainingSeconds =
      waitingForDecision && allowTimeoutDefault && workflow.userDecisionTimeoutAtMs !== undefined
        ? Math.max(0, Math.ceil((workflow.userDecisionTimeoutAtMs - Date.now()) / 1000))
        : null;
    return {
      decision_prompt_required: waitingForDecision,
      allow_timeout_default: allowTimeoutDefault,
      default_action: allowTimeoutDefault ? "continue_wait" : null,
      timeout_default_after_seconds: Math.floor(DEFAULT_USER_DECISION_TIMEOUT_DEFAULT_AFTER_MS / 1000),
      timeout_default_deadline_at: timeoutDeadlineAt,
      timeout_default_remaining_seconds: timeoutRemainingSeconds,
      decision_prompted_at: workflow.userDecisionPromptedAt ?? null,
      consecutive_timeout_defaults: workflow.consecutiveTimeoutDefaultContinueCount,
      consecutive_timeout_default_limit: MAX_CONSECUTIVE_TIMEOUT_DEFAULT_CONTINUES,
      requires_explicit_user_decision: waitingForDecision && !allowTimeoutDefault,
      timeout_default_decision_source: "timeout_default",
      user_selected_decision_source: "user_selected",
      last_timeout_default_auto_continue_at: workflow.lastTimeoutDefaultAutoContinueAt ?? null,
      guidance:
        "每次无进展决策都必须先提示用户并停住等待选择；允许默认继续时，由后续跟进周期在超时后触发 timeout_default 继续等待。用户明确选择或 ACP 返回新进展会清空连续无人响应计数。"
    };
  }

  private buildWorkflowStatusResponse(workflow: TaskWorkflowState): Record<string, unknown> {
    const base = this.buildWorkflowBasePayload(workflow);

    if (workflow.stage === "RUNNING_DESIGN") {
      return {
        ...base,
        current_stage: "DESIGN_RUNNING",
        next_action_required: ["status"]
      };
    }
    if (workflow.stage === "WAITING_DESIGN_APPROVAL") {
      return {
        ...base,
        current_stage: "DESIGN_REVIEW",
        next_action_required: ["design_feedback", "design_approve"]
      };
    }
    if (workflow.stage === "RUNNING_PLANNING") {
      return {
        ...base,
        current_stage: "PLANNING_RUNNING",
        next_action_required: ["status"]
      };
    }
    if (workflow.stage === "WAITING_PLAN_APPROVAL") {
      return {
        ...base,
        current_stage: "PLANNING_REVIEW",
        next_action_required: ["planning_feedback", "planning_approve"]
      };
    }
    if (workflow.stage === "RUNNING_IMPLEMENTATION") {
      return {
        ...base,
        current_stage: "IMPLEMENTATION_RUNNING",
        next_action_required: ["status"]
      };
    }
    if (workflow.stage === "NEEDS_DELIVERY_TEST") {
      return {
        ...base,
        current_stage: "DELIVERY_TEST_REQUIRED",
        workflow_status: "NEEDS_DELIVERY_TEST",
        business_stage: "等待交付测试",
        user_message: "计划实施已经完成，但还不能判定交付完成。现在必须从真实业务入口执行交付测试。",
        next_business_action: "执行真实业务交付测试，并反馈通过或失败",
        next_action_required: ["delivery_test_pass", "delivery_test_fail"]
      };
    }
    if (workflow.stage === "DELIVERY_TEST_FAILED") {
      return {
        ...base,
        current_stage: "REMEDIATION_REVIEW",
        workflow_status: "DELIVERY_TEST_FAILED",
        business_stage: "整改方案确认",
        user_message:
          "交付测试失败，当前不能声明完成。主会话必须根据失败材料生成整改方案和整改计划，展示给用户确认；确认后调用 remediation_approve，并把完整整改方案和整改计划放入 feedback_text。",
        next_business_action: "主会话生成整改方案和整改计划，用户确认后交给 ACP 执行整改",
        next_action_required: ["remediation_approve", "handoff_to_main"],
        required_main_action: {
          action: "write_remediation_plan",
          source: "main_session",
          input: "delivery_test_failures",
          output: "feedback_text for remediation_approve",
          rule: "整改方案和整改计划由主会话生成；ACP 只在用户确认后执行整改实施"
        }
      };
    }
    if (workflow.stage === "RUNNING_REMEDIATION") {
      return {
        ...base,
        current_stage: "REMEDIATION_RUNNING",
        workflow_status: "RUNNING_REMEDIATION",
        business_stage: "整改实施",
        user_message: "已进入整改实施阶段，我会按 1-2 分钟节奏持续跟进整改进展。",
        next_action_required: ["status"]
      };
    }
    if (workflow.stage === "NEEDS_ACP_SESSION_DECISION") {
      return {
        ...base,
        current_stage: "NEEDS_ACP_SESSION_DECISION",
        workflow_status: "NEEDS_ACP_SESSION_DECISION",
        business_stage: "执行会话恢复决策",
        user_message:
          "检测到 ACP 执行端已结束或不可用。现在必须由用户决定：主会话接手继续，或终止当前流程。",
        next_business_action: "等待用户选择主会话接手，或终止当前流程",
        next_action_required: ["handoff_to_main", "cancel_follow_up"],
        user_options: [
          {
            action: "handoff_to_main",
            description: "主会话接手：停止依赖原 ACP 会话，由主会话继续处理当前任务"
          },
          {
            action: "cancel_follow_up",
            description: "终止流程：结束当前任务，不再继续后续实施与跟进"
          }
        ]
      };
    }
    if (workflow.stage === "NEEDS_REMEDIATION_DECISION") {
      return {
        ...base,
        current_stage: "NEEDS_REMEDIATION_DECISION",
        workflow_status: "NEEDS_REMEDIATION_DECISION",
        business_stage: "整改决策",
        user_message:
          "已经完成 3 次整改，交付测试仍未通过。后续不能继续由 ACP 自动整改，请选择主会话接手整改，或取消后续工作。",
        next_action_required: ["handoff_to_main", "cancel_follow_up"],
        user_options: [
          {
            action: "handoff_to_main",
            description: "主会话接手整改：停止 ACP 自动整改，由主会话负责后续处理"
          },
          {
            action: "cancel_follow_up",
            description: "取消后续工作：关闭 ACP 会话，本次任务不声明交付完成"
          }
        ]
      };
    }
    if (workflow.stage === "NEEDS_USER_DECISION") {
      const userDecisionPolicy = this.buildUserDecisionPolicy(workflow);
      const allowTimeoutDefault = userDecisionPolicy.allow_timeout_default === true;
      return {
        ...base,
        current_stage: "NEEDS_USER_DECISION",
        business_stage: "等待用户决策",
        user_message: allowTimeoutDefault
          ? "当前超过约定时间仍无新进展。现在需要你选择继续等待或主会话接手。我会先停住等待你的选择；若 60 秒内没有收到选择，系统会在后续跟进周期按默认规则继续等待。"
          : "当前已经连续 3 次无人响应后默认继续等待。现在必须由用户明确选择继续等待或主会话接手；主会话不得再使用超时默认继续。",
        next_business_action: allowTimeoutDefault
          ? "先停住等待用户选择；若超时仍无选择，后续 status 跟进会自动按 decision_source=timeout_default 继续等待"
          : "停住并等待用户明确选择；禁止继续使用超时默认动作",
        next_action_required: ["continue_wait", "handoff_to_main"],
        user_options: [
          {
            action: "continue_wait",
            decision_source: "user_selected",
            description: "继续等待：用户明确选择继续，清空连续无人响应默认继续计数"
          },
          {
            action: "handoff_to_main",
            description: "主会话接手：停止 ACP 执行，由主会话继续处理"
          }
        ],
        timeout_default_option: allowTimeoutDefault
          ? {
              action: "continue_wait",
              decision_source: "timeout_default",
              after_seconds: Math.floor(DEFAULT_USER_DECISION_TIMEOUT_DEFAULT_AFTER_MS / 1000),
              deadline_at: (userDecisionPolicy.timeout_default_deadline_at as string | null | undefined) ?? null,
              description: "如果超时仍无用户选择，插件会在后续跟进周期自动按该动作继续等待"
            }
          : null
      };
    }
    if (workflow.stage === "TRANSFERRED_TO_MAIN") {
      return {
        ...base,
        current_stage: "TRANSFERRED_TO_MAIN",
        workflow_status: "TRANSFERRED_TO_MAIN",
        next_action_required: null
      };
    }
    if (workflow.stage === "CANCELLED") {
      return {
        ...base,
        current_stage: "CANCELLED",
        workflow_status: "CANCELLED",
        business_stage: "后续工作已取消",
        user_message: "已取消后续工作。本次任务未通过真实业务交付测试，不能声明交付完成。",
        workflow_completed: false,
        next_action_required: null
      };
    }
    if (workflow.stage === "COMPLETED") {
      return workflow.completedPayload ?? {
        ...base,
        current_stage: "COMPLETED",
        workflow_status: "COMPLETED",
        next_action_required: null
      };
    }
    return {
      ...base,
      current_stage: "FAILED",
      next_action_required: ["status"]
    };
  }

  private toProgressUpdatePayload(workflow: TaskWorkflowState): Record<string, unknown> {
    const nowMs = Date.now();
    const silenceStartedAtMs = workflow.lastProgressAtMs ?? nowMs;
    const update = workflow.lastProgressUpdate;
    return {
      has_new_output: update?.hasNewOutput ?? false,
      text: update?.text ?? "",
      event_count: update?.eventCount ?? 0,
      turn_id: update?.turnId,
      latest_event_seq: update?.latestEventSeq,
      observed_at: update?.observedAt,
      last_progress_at: workflow.lastProgressAt,
      silence_seconds: Math.floor(Math.max(0, nowMs - silenceStartedAtMs) / 1000)
    };
  }

  private toPhaseGatesPayload(workflow: TaskWorkflowState): Record<string, unknown> {
    const design = workflow.phaseGates.design;
    const planning = workflow.phaseGates.planning;
    return {
      design: design
        ? {
            passed: design.passed,
            attempts: design.attempts,
            missing_sections: design.missingSections
          }
        : undefined,
      planning: planning
        ? {
            passed: planning.passed,
            attempts: planning.attempts,
            missing_sections: planning.missingSections
          }
        : undefined
    };
  }

  private async executeTurn(
    turnType: "run" | "rework",
    bridgeSessionId: string,
    idempotencyKey: string,
    promptText: string,
    timeoutMs?: number
  ): Promise<BridgeResult<unknown>> {
    const requestId = newRequestId();
    const startedAtMs = Date.now();
    let session: DelegateSessionRecord | undefined;
    let turnRecord: DelegateTurnRecord | undefined;
    try {
      session = await this.loadReadySession(bridgeSessionId);
      if (session.activeTurnId) {
        throw new BridgeError(ErrorCodes.TURN_ALREADY_RUNNING, "同会话已有运行中轮次", false);
      }

      const promptSha256 = hashPrompt(promptText);
      const idempotent = await this.store.findTurnByIdempotency(session.bridgeSessionId, idempotencyKey);
      if (idempotent) {
        if (idempotent.promptSha256 !== promptSha256) {
          throw new BridgeError(ErrorCodes.IDEMPOTENCY_CONFLICT, "幂等键冲突且请求体不一致", false);
        }
        if (idempotent.status === "RUNNING") {
          throw new BridgeError(ErrorCodes.TURN_ALREADY_RUNNING, "幂等键对应轮次仍在运行中", false);
        }
        if (idempotent.status === "FAILED") {
          throw new BridgeError(
            ErrorCodes.PROMPT_EXEC_FAILED,
            "幂等键对应轮次已失败，请使用新的 idempotency_key 重试",
            false
          );
        }
        return makeResult(requestId, {
          turn_id: idempotent.turnId,
          stop_reason: idempotent.stopReason,
          usage: idempotent.usage,
          summary: "命中幂等缓存结果"
        });
      }

      const turnId = newTurnId();
      turnRecord = {
        turnId,
        bridgeSessionId: session.bridgeSessionId,
        turnSeq: await this.store.nextTurnSeq(session.bridgeSessionId),
        turnType,
        idempotencyKey,
        promptSha256,
        promptText,
        status: "RUNNING",
        startedAt: now()
      };
      await this.store.saveTurn(turnRecord);

      session.status = "ACTIVE";
      session.activeTurnId = turnId;
      session.updatedAt = now();
      await this.store.saveSession(session);
      this.activeTurnByBridgeSession.set(session.bridgeSessionId, turnId);
      this.eventSeqByTurn.set(turnId, 0);

      const promptResult = await this.mustApi().prompt(
        session.acpSessionId,
        promptText,
        timeoutMs ?? this.runtime.turnTimeoutMs
      );

      turnRecord.status = "COMPLETED";
      turnRecord.stopReason = promptResult.stopReason ?? "end_turn";
      turnRecord.usage = normalizeUsage(promptResult.usage);
      turnRecord.endedAt = now();
      await this.store.saveTurn(turnRecord);

      session.status = "READY";
      session.lastErrorCode = undefined;
      session.activeTurnId = undefined;
      session.updatedAt = now();
      await this.store.saveSession(session);
      this.activeTurnByBridgeSession.delete(session.bridgeSessionId);
      this.eventSeqByTurn.delete(turnId);

      const latencyMs = Date.now() - startedAtMs;
      this.metrics.observe("turn_duration_ms", latencyMs);
      this.metrics.inc("turn_success");

      await this.audit(requestId, `turn.${turnType}`, "codex", "OK", {
        bridgeSessionId: session.bridgeSessionId,
        turnId
      });

      return makeResult(requestId, {
        turn_id: turnId,
        stop_reason: turnRecord.stopReason,
        usage: turnRecord.usage,
        summary: promptResult.summary ?? ""
      });
    } catch (error) {
      this.metrics.inc("turn_failed");
      const bridgeError = this.normalizeError(error);

      if (turnRecord) {
        turnRecord.status = "FAILED";
        turnRecord.endedAt = now();
        try {
          await this.store.saveTurn(turnRecord);
        } catch (persistError) {
          this.logger.warn("turn.persist_failed", {
            turnId: turnRecord.turnId,
            message: persistError instanceof Error ? persistError.message : String(persistError)
          });
        }
      }

      if (session) {
        session.status = "READY";
        session.lastErrorCode = bridgeError.code;
        if (!turnRecord || session.activeTurnId === turnRecord.turnId) {
          session.activeTurnId = undefined;
        }
        session.updatedAt = now();
        try {
          await this.store.saveSession(session);
        } catch (persistError) {
          this.logger.warn("session.persist_failed", {
            bridgeSessionId: session.bridgeSessionId,
            message: persistError instanceof Error ? persistError.message : String(persistError)
          });
        }
        this.activeTurnByBridgeSession.delete(session.bridgeSessionId);
      }
      if (turnRecord) {
        this.eventSeqByTurn.delete(turnRecord.turnId);
      }

      await this.audit(requestId, `turn.${turnType}`, "codex", bridgeError.code, {
        message: bridgeError.message
      });
      return makeError(requestId, bridgeError);
    }
  }

  private ensureTurnSuccess(result: BridgeResult<unknown>, fallbackMessage: string): void {
    if (result.success) {
      return;
    }
    const err = result.error ?? {
      code: ErrorCodes.PROMPT_EXEC_FAILED,
      message: fallbackMessage,
      retryable: true
    };
    throw new BridgeError(err.code as ErrorCode, err.message, err.retryable);
  }

  private turnResultToStep(
    phase: "design" | "planning" | "implementation" | "rework",
    result: BridgeResult<unknown>
  ): {
    phase: "design" | "planning" | "implementation" | "rework";
    turn_id?: string;
    stop_reason?: string;
    summary?: string;
    success: boolean;
    error?: { code: string; message: string; retryable: boolean };
  } {
    if (!result.success) {
      return {
        phase,
        success: false,
        error: result.error
      };
    }
    const data = (result.data ?? {}) as {
      turn_id?: string;
      stop_reason?: string;
      summary?: string;
    };
    return {
      phase,
      turn_id: data.turn_id,
      stop_reason: data.stop_reason,
      summary: data.summary,
      success: true
    };
  }

  private buildWorkflowEntryJudgePrompt(requirementText: string, mergedContextText: string): string {
    return [
      "你是委派流程入口判定器，只做阶段判定，不做实现。",
      "请根据需求与上下文，判定当前任务应从哪个阶段开始：",
      "- design: 尚未具备可评审设计稿，需要先做设计。",
      "- planning: 设计已具备，但实施计划未具备，需要先做计划。",
      "- implementation: 设计与计划都已具备，可直接进入实现。",
      "- need_user_input: 信息不足，必须向用户索要关键上下文。",
      "",
      "判定规则：",
      "1) 不使用“置信度/阈值”表达；只给出单一明确结论。",
      "2) 若上下文模棱两可、冲突或不足以明确阶段，必须返回 need_user_input，禁止猜测阶段。",
      "3) 若结论为 need_user_input，必须在 missing_context 中列出最少必需项。",
      "4) 判定为 planning 的前提是已经能看到方案正文，或能看到可读取的方案文档路径；不能只因为用户说“做计划”就跳过方案来源。",
      "5) 如果方案是主会话刚生成的文件，planning 必须基于该方案文件路径；如果方案是用户直接提供的正文，planning 必须基于该正文。",
      "6) 仅输出 JSON，不要输出任何额外文本。",
      "7) JSON schema:",
      '{"phase":"design|planning|implementation|need_user_input","missing_context":["..."],"reason":"..."}',
      "",
      "需求：",
      requirementText,
      "",
      "上下文：",
      mergedContextText
    ].join("\n");
  }

  private buildDesignPrompt(workflow: TaskWorkflowState): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.designGuideFile);
    return [
      "你是团队中的架构设计负责人。",
      `当前开发类型是${profile.label}。`,
      "当前阶段是 Design。插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容编写。",
      ...buildGuideDocumentPromptBlock(guide),
      ...buildDocumentOutputPromptLines("design", workflow.sessionAlias, workflow.workspacePath),
      "请输出一份可执行规范文档，必须按以下章节顺序给出，并使用 markdown 二级标题：",
      ...profile.designRequiredSections.map((section) => `## ${section}`),
      "",
      "规则：",
      "1) 全文中文。",
      "2) 每个关键要求必须可验证。",
      "3) 每个关键流程必须有失败回退路径。",
      "4) 不得省略上述任一章节。",
      "5) 指南全文已经在本提示词中提供，必须把设计文档落盘到指定路径。",
      "6) 禁止读取用户项目目录下的 docs 或 docs/superpowers 作为本阶段指南。",
      "",
      "需求如下：",
      workflow.requirementText,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: DESIGN_READY"
    ].join("\n");
  }

  private buildPlanningSourcePromptLines(workflow: TaskWorkflowState): string[] {
    const fileContext = this.loadContextFromReferencedDocsSync(workflow.workspacePath, workflow.requirementText);
    const lines = [
      "方案对齐要求：",
      "- 计划必须根据已经确认的方案展开，不能凭空新增、删除或改写方案承诺。",
      "- 计划文档必须写明“方案来源”，并逐项对齐方案中的设计目标、业务流程、UI/交互契约、API 契约、状态机、数据模型、配置项、权限规则、异常处理矩阵和验收标准。"
    ];

    if (fileContext.loadedPaths.length > 0) {
      lines.push(
        `- 方案来源类型：方案文档路径。已读取：${fileContext.loadedPaths.join(" | ")}`,
        "- 必须以以下方案文档全文作为计划输入：",
        fileContext.content
      );
      if (fileContext.failedPaths.length > 0) {
        lines.push(`- 以下方案路径读取失败，不能忽略：${fileContext.failedPaths.join(" | ")}`);
      }
      return lines;
    }

    if (fileContext.failedPaths.length > 0) {
      lines.push(
        `- 方案来源类型：方案文档路径，但读取失败：${fileContext.failedPaths.join(" | ")}`,
        "- 不得凭空写计划；必须要求补充可读取的方案文档路径或方案正文。"
      );
      return lines;
    }

    lines.push(
      "- 方案来源类型：用户在 requirement_text 中提供的方案正文。",
      "- 必须以 requirement_text 中的方案内容为计划依据；如果 requirement_text 实际没有方案内容，不得编写计划，必须要求补充方案来源。",
      "- 若方案是主会话刚生成的文档，主会话重新 start 时必须把方案文件路径写入 requirement_text。"
    );
    return lines;
  }

  private buildPlanningPrompt(workflow: TaskWorkflowState): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.planningGuideFile);
    return [
      "你是团队中的实施计划负责人。",
      `当前开发类型是${profile.label}。`,
      "当前阶段是 Planning。插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容编写。",
      ...buildGuideDocumentPromptBlock(guide),
      ...this.buildPlanningSourcePromptLines(workflow),
      ...buildDocumentOutputPromptLines("planning", workflow.sessionAlias, workflow.workspacePath),
      "请输出一份完整计划，必须按以下章节顺序给出，并使用 markdown 二级标题：",
      ...profile.planningRequiredSections.map((section) => `## ${section}`),
      "",
      "规则：",
      "1) 全文中文。",
      "2) 必须包含业务场景、Task 拆分和验证命令。",
      "3) 必须定义失败修复与复测闭环。",
      "4) 不得省略上述任一章节。",
      "5) 指南全文已经在本提示词中提供，必须把计划文档落盘到指定路径。",
      "6) 禁止读取用户项目目录下的 docs 或 docs/superpowers 作为本阶段指南。",
      "",
      "需求如下：",
      workflow.requirementText,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: PLAN_READY"
    ].join("\n");
  }

  private buildDesignRepairPrompt(
    workflow: TaskWorkflowState,
    round: number,
    missingSections: string[]
  ): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.designGuideFile);
    return [
      `Design 门禁未通过，正在执行第 ${round} 轮补全。`,
      `当前开发类型是${profile.label}，插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容补全文档。`,
      ...buildGuideDocumentPromptBlock(guide),
      ...buildDocumentOutputPromptLines("design", workflow.sessionAlias, workflow.workspacePath),
      "请仅补齐缺失章节并把完整设计文档写回指定文件，章节顺序保持不变。",
      `缺失章节：${missingSections.join("、")}`,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: DESIGN_READY"
    ].join("\n");
  }

  private buildDesignFeedbackPrompt(
    workflow: TaskWorkflowState,
    feedback: string
  ): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.designGuideFile);
    return [
      "用户对 Design 阶段提出了反馈，请在保留结构化章节的前提下完成修订，并把完整文档写回指定文件。",
      `当前开发类型是${profile.label}，插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容修订文档。`,
      ...buildGuideDocumentPromptBlock(guide),
      ...buildDocumentOutputPromptLines("design", workflow.sessionAlias, workflow.workspacePath),
      "指南全文已经在本提示词中提供，必须把修订后的设计文档落盘到指定路径。",
      `用户反馈：${feedback}`,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: DESIGN_READY"
    ].join("\n");
  }

  private buildPlanningRepairPrompt(
    workflow: TaskWorkflowState,
    round: number,
    missingSections: string[]
  ): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.planningGuideFile);
    return [
      `Planning 门禁未通过，正在执行第 ${round} 轮补全。`,
      `当前开发类型是${profile.label}，插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容补全计划。`,
      ...buildGuideDocumentPromptBlock(guide),
      ...this.buildPlanningSourcePromptLines(workflow),
      ...buildDocumentOutputPromptLines("planning", workflow.sessionAlias, workflow.workspacePath),
      "请仅补齐缺失章节并把完整计划文档写回指定文件，章节顺序保持不变。",
      `缺失章节：${missingSections.join("、")}`,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: PLAN_READY"
    ].join("\n");
  }

  private buildPlanningFeedbackPrompt(
    workflow: TaskWorkflowState,
    feedback: string
  ): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    const profile = DOCUMENT_PROFILES[workflow.developmentType];
    const guide = readSkillGuideDocument(profile.planningGuideFile);
    return [
      "用户对 Planning 阶段提出了反馈，请在保留结构化章节的前提下完成修订，并把完整计划写回指定文件。",
      `当前开发类型是${profile.label}，插件已经把必须遵循的指南全文放入本提示词，你必须严格按照指南内容修订计划。`,
      ...buildGuideDocumentPromptBlock(guide),
      ...this.buildPlanningSourcePromptLines(workflow),
      ...buildDocumentOutputPromptLines("planning", workflow.sessionAlias, workflow.workspacePath),
      "指南全文已经在本提示词中提供，必须把修订后的计划文档落盘到指定路径。",
      `用户反馈：${feedback}`,
      "",
      `验收标准：${acceptance}`,
      "最后一行请输出：STATUS: PLAN_READY"
    ].join("\n");
  }

  private buildImplementationPrompt(requirementText: string, acceptanceCriteria?: string): string {
    const acceptance = acceptanceCriteria?.trim() ? acceptanceCriteria.trim() : "无额外验收标准";
    return [
      "你是团队中的开发执行负责人。",
      "请严格基于同会话内已完成的 Design 文档与 Planning 文档执行实现。",
      "输出内容必须包含：",
      "1) 已完成事项",
      "2) 关键实现说明",
      "3) 自测结果与剩余风险",
      "",
      "需求如下：",
      requirementText,
      "",
      `验收标准：${acceptance}`,
      "若已达到可交付状态，最后一行输出：STATUS: DONE",
      "若仍需整改，最后一行输出：STATUS: REWORK_NEEDED"
    ].join("\n");
  }

  private buildImplementationReworkPrompt(round: number, acceptanceCriteria?: string): string {
    const acceptance = acceptanceCriteria?.trim() ? acceptanceCriteria.trim() : "无额外验收标准";
    return [
      `你正在执行第 ${round} 轮实现整改。`,
      "请针对上一轮不足做修正，并输出：",
      "1) 本轮修正点",
      "2) 修正后的验证结果",
      "3) 是否达到可交付状态",
      "",
      `验收标准：${acceptance}`,
      "若已达到可交付状态，最后一行输出：STATUS: DONE",
      "否则最后一行输出：STATUS: REWORK_NEEDED"
    ].join("\n");
  }

  private buildRemediationImplementationPrompt(workflow: TaskWorkflowState): string {
    const acceptance = workflow.acceptanceCriteria?.trim() ? workflow.acceptanceCriteria.trim() : "无额外验收标准";
    return [
      `你正在执行第 ${workflow.remediationRound}/${MAX_REMEDIATION_ROUNDS} 次交付整改。`,
      "以下整改方案和整改计划由主会话根据真实交付测试失败材料生成，并已经过用户确认。你只负责按该方案执行修改，不要重新制定方案，不要扩大范围。",
      "输出内容必须包含：",
      "1) 本次整改完成事项",
      "2) 关键修改说明",
      "3) 自测结果与剩余风险",
      "4) 需要主会话重新执行的同一条业务交付测试",
      "",
      `验收标准：${acceptance}`,
      "",
      "整改方案和计划：",
      workflow.pendingRemediationPlan ?? "未记录整改方案和计划；当前不能执行整改。",
      "",
      "用户确认：已确认按上述整改方案和整改计划执行。",
      "",
      "最后一行请输出：STATUS: DONE"
    ].join("\n");
  }

  private async hasDoneSignal(result: BridgeResult<unknown>): Promise<boolean> {
    if (!result.success || !result.data) {
      return false;
    }
    const data = result.data as { turn_id?: string; summary?: string };
    const mergedText = await this.collectTurnOutputText(data.turn_id, data.summary ?? "");
    const upper = mergedText.toUpperCase();
    const compactUpper = upper.replace(/\s+/gu, "");
    return upper.includes("STATUS:DONE") || upper.includes("STATUS: DONE") || compactUpper.includes("STATUS:DONE");
  }

  private async enforceDocumentGate(input: {
    phase: "design" | "planning";
    workflowId: string;
    bridgeSessionId: string;
    initialResult: BridgeResult<unknown>;
    requiredSections: string[];
    outputDocumentPath?: string;
    errorCode: ErrorCode;
    maxRounds: number;
    timeoutMs?: number;
    steps: Array<{
      phase: "design" | "planning" | "implementation" | "rework";
      turn_id?: string;
      stop_reason?: string;
      summary?: string;
      success: boolean;
      error?: { code: string; message: string; retryable: boolean };
    }>;
    repairPromptBuilder: (missingSections: string[], round: number) => string;
  }): Promise<{ passed: boolean; attempts: number; missingSections: string[] }> {
    let attempts = 1;
    let currentResult = input.initialResult;

    while (attempts <= Math.max(input.maxRounds, 0) + 1) {
      this.ensureTurnSuccess(currentResult, `${input.phase} 阶段执行失败`);
      const evaluation = await this.evaluateRequiredSections(
        currentResult,
        input.requiredSections,
        input.outputDocumentPath
      );
      if (evaluation.passed) {
        return {
          passed: true,
          attempts,
          missingSections: []
        };
      }

      if (attempts > input.maxRounds) {
        throw new BridgeError(
          input.errorCode,
          `${input.phase} 文档门禁未通过，缺失章节：${evaluation.missingSections.join("、")}`,
          false
        );
      }

      const repairResult = await this.executeTurn(
        "rework",
        input.bridgeSessionId,
        `workflow-${input.workflowId}-${input.phase}-gate-${attempts}`,
        input.repairPromptBuilder(evaluation.missingSections, attempts),
        input.timeoutMs
      );
      input.steps.push(this.turnResultToStep(input.phase, repairResult));
      currentResult = repairResult;
      attempts += 1;
    }

    return {
      passed: false,
      attempts,
      missingSections: []
    };
  }

  private async evaluateRequiredSections(
    result: BridgeResult<unknown>,
    requiredSections: string[],
    outputDocumentPath?: string
  ): Promise<{ passed: boolean; missingSections: string[] }> {
    if (!result.success || !result.data) {
      return {
        passed: false,
        missingSections: [...requiredSections]
      };
    }
    const data = result.data as { turn_id?: string; summary?: string };
    const chunks = [await this.collectTurnOutputText(data.turn_id, data.summary ?? "")];
    let outputDocumentReadable = true;
    if (outputDocumentPath) {
      try {
        const documentText = readFileSync(outputDocumentPath, "utf8");
        if (documentText.trim().length > 0) {
          chunks.push(documentText);
        } else {
          outputDocumentReadable = false;
        }
      } catch {
        outputDocumentReadable = false;
      }
    }
    const mergedText = chunks.join("\n\n");
    const normalized = this.normalizeForMatch(mergedText);
    const missingSections = requiredSections.filter(
      (section) => !normalized.includes(this.normalizeForMatch(section))
    );
    if (missingSections.length === 0) {
      missingSections.push(...this.evaluateDocumentContentQuality(mergedText));
    }
    if (outputDocumentPath && !outputDocumentReadable) {
      missingSections.unshift("输出文档文件");
    }
    return {
      passed: missingSections.length === 0,
      missingSections
    };
  }

  private normalizeForMatch(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，。；：:、\-_/\\|()[\]{}"'`]/g, "");
  }

  private evaluateDocumentContentQuality(documentText: string): string[] {
    const issues: string[] = [];

    const apiSection = this.extractSecondLevelSection(documentText, [
      "api、数据模型与配置",
      "api,数据模型与配置",
      "api 数据模型与配置"
    ]);
    if (apiSection) {
      const missingApiFields = this.findMissingApiContractFields(apiSection);
      if (missingApiFields.length > 0) {
        issues.push(`API、数据模型与配置章节缺少字段：${missingApiFields.join("、")}`);
      }
    }

    const taskSection = this.extractSecondLevelSection(documentText, ["开发任务拆分", "实施任务拆分"]);
    if (taskSection) {
      issues.push(...this.findTaskSectionIssues(taskSection));
    }

    return issues;
  }

  private extractSecondLevelSection(documentText: string, sectionNames: string[]): string | undefined {
    const lines = documentText.replace(/\r\n/g, "\n").split("\n");
    const normalizedTargets = sectionNames.map((name) => this.normalizeForMatch(name));
    const headings: Array<{ index: number; normalizedHeading: string }> = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trimStart().startsWith("## ")) {
        continue;
      }
      headings.push({
        index,
        normalizedHeading: this.normalizeForMatch(line)
      });
    }

    const hit = headings.find((heading) =>
      normalizedTargets.some((target) => heading.normalizedHeading.includes(target))
    );
    if (!hit) {
      return undefined;
    }

    const nextHeading = headings.find((heading) => heading.index > hit.index);
    const endIndex = nextHeading ? nextHeading.index : lines.length;
    return lines.slice(hit.index, endIndex).join("\n");
  }

  private findMissingApiContractFields(sectionText: string): string[] {
    const normalized = this.normalizeForMatch(sectionText);
    const rules: Array<{ label: string; tokens: string[] }> = [
      { label: "请求方法", tokens: ["请求方法", "method"] },
      { label: "路径", tokens: ["路径", "path"] },
      { label: "入参", tokens: ["入参", "请求参数", "request"] },
      { label: "出参", tokens: ["出参", "响应参数", "response"] },
      { label: "错误码", tokens: ["错误码", "errorcode", "错误处理"] },
      { label: "幂等规则", tokens: ["幂等", "idempotent"] },
      { label: "权限/鉴权", tokens: ["权限", "鉴权", "auth"] },
      { label: "数据表或实体", tokens: ["数据表", "实体", "模型"] },
      { label: "环境变量", tokens: ["环境变量", "env"] }
    ];

    return rules
      .filter((rule) =>
        !rule.tokens.some((token) => normalized.includes(this.normalizeForMatch(token)))
      )
      .map((rule) => rule.label);
  }

  private findTaskSectionIssues(sectionText: string): string[] {
    const lines = sectionText.replace(/\r\n/g, "\n").split("\n");
    const taskHeadingIndexes: number[] = [];
    const taskHeadingRegex = /^\s*###\s*Task\s*\d+\s*[:：]/i;
    for (let index = 0; index < lines.length; index += 1) {
      if (taskHeadingRegex.test(lines[index] ?? "")) {
        taskHeadingIndexes.push(index);
      }
    }

    if (taskHeadingIndexes.length === 0) {
      return ["开发任务拆分章节缺少 Task 明细（至少一个 `### Task XX`）"];
    }

    const issues: string[] = [];
    for (let taskIndex = 0; taskIndex < taskHeadingIndexes.length; taskIndex += 1) {
      const start = taskHeadingIndexes[taskIndex] ?? 0;
      const end = taskHeadingIndexes[taskIndex + 1] ?? lines.length;
      const blockText = lines.slice(start, end).join("\n");
      const normalized = this.normalizeForMatch(blockText);
      const title = (lines[start] ?? `Task#${taskIndex + 1}`).trim();

      const rules: Array<{ label: string; tokens: string[] }> = [
        { label: "目标", tokens: ["目标"] },
        { label: "文件范围", tokens: ["文件", "涉及文件", "修改文件", "新增文件"] },
        { label: "实施步骤", tokens: ["实施步骤", "步骤"] },
        { label: "验证命令", tokens: ["验证命令", "验证"] },
        { label: "完成标准", tokens: ["完成标准", "验收标准", "完成定义"] },
        { label: "对应交付场景", tokens: ["对应业务交付场景", "对应交付场景"] }
      ];

      const missing = rules
        .filter((rule) =>
          !rule.tokens.some((token) => normalized.includes(this.normalizeForMatch(token)))
        )
        .map((rule) => rule.label);

      if (missing.length > 0) {
        issues.push(`${title} 缺少：${missing.join("、")}`);
      }
    }

    return issues;
  }

  private async collectTurnOutputText(turnId: string | undefined, summary: string): Promise<string> {
    const chunks: string[] = [];
    if (summary.trim().length > 0) {
      chunks.push(summary);
    }
    if (!turnId) {
      return chunks.join("\n");
    }
    const events = await this.store.listEvents(turnId);
    for (const event of events) {
      this.extractTextChunks(event.payload, chunks);
    }
    return chunks.join("\n");
  }

  private async collectWorkflowProgressDelta(workflow: TaskWorkflowState): Promise<WorkflowProgressDelta> {
    const turnId = this.activeTurnByBridgeSession.get(workflow.bridgeSessionId);
    if (!turnId) {
      return {
        hasNewOutput: false,
        text: "",
        eventCount: 0
      };
    }

    const events = await this.store.listEvents(turnId);
    const lastReportedSeq = workflow.progressCursorByTurn[turnId] ?? 0;
    const newEvents = events.filter((event) => event.eventSeq > lastReportedSeq);
    if (newEvents.length === 0) {
      return {
        hasNewOutput: false,
        text: "",
        eventCount: 0,
        turnId,
        latestEventSeq: lastReportedSeq
      };
    }

    const chunks: string[] = [];
    for (const event of newEvents) {
      this.extractTextChunks(event.payload, chunks);
    }

    const latestEventSeq = newEvents[newEvents.length - 1]?.eventSeq ?? lastReportedSeq;
    workflow.progressCursorByTurn[turnId] = latestEventSeq;
    return {
      hasNewOutput: true,
      text: this.compactProgressText(chunks.join("\n")),
      eventCount: newEvents.length,
      turnId,
      latestEventSeq
    };
  }

  private compactProgressText(text: string): string {
    const compacted = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    const maxChars = 2_000;
    if (compacted.length <= maxChars) {
      return compacted;
    }
    return `${compacted.slice(0, maxChars)}\n[已截断，仅用于进展摘要]`;
  }

  private async collectTurnOutputRawText(
    turnId: string | undefined,
    summary: string,
    eventTypeFilter?: (eventType: string) => boolean
  ): Promise<string> {
    const chunks: string[] = [];
    if (summary.trim().length > 0) {
      chunks.push(summary);
    }
    if (!turnId) {
      return chunks.join("");
    }
    const events = await this.store.listEvents(turnId);
    for (const event of events) {
      if (eventTypeFilter && !eventTypeFilter(event.eventType)) {
        continue;
      }
      this.extractTextChunks(event.payload, chunks);
    }
    return chunks.join("");
  }

  private extractTextChunks(value: unknown, chunks: string[]): void {
    if (typeof value === "string") {
      chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.extractTextChunks(item, chunks);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const asObject = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(asObject)) {
      if (typeof item === "string") {
        const lowerKey = key.toLowerCase();
        if (lowerKey === "text" || lowerKey === "summary") {
          chunks.push(item);
        }
      } else {
        this.extractTextChunks(item, chunks);
      }
    }
  }

  private async ensureAcpReady(timeoutMs: number): Promise<void> {
    if (this.initialized) {
      return;
    }

    const process = this.processSupervisor.ensureRunning();
    const transport = new NdjsonTransport(process.stdout, process.stdin, this.logger);
    const rpc = new JsonRpcClient(transport, this.logger);
    const api = new AcpSessionApi(rpc, this.logger);
    api.onSessionUpdate(async (eventType, payload) => {
      await this.persistEventFromUpdate(eventType, payload);
    });
    api.start();
    await api.initialize(timeoutMs);
    this.sessionApi = api;
    this.initialized = true;
  }

  private mustApi(): AcpSessionApi {
    if (!this.sessionApi) {
      throw new BridgeError(ErrorCodes.ACP_PROCESS_UNAVAILABLE, "ACP 客户端未初始化", true);
    }
    return this.sessionApi;
  }

  private async persistEventFromUpdate(eventType: string, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const asObject = payload as Record<string, unknown>;
    const bridgeSessionId =
      typeof asObject.bridgeSessionId === "string" ? asObject.bridgeSessionId : undefined;

    if (!bridgeSessionId) {
      if (this.activeTurnByBridgeSession.size !== 1) {
        return;
      }
    }

    const targetBridgeSessionId =
      bridgeSessionId ?? Array.from(this.activeTurnByBridgeSession.keys())[0]!;
    const turnId = this.activeTurnByBridgeSession.get(targetBridgeSessionId);
    if (!turnId) {
      return;
    }

    const eventSeq = (this.eventSeqByTurn.get(turnId) ?? 0) + 1;
    this.eventSeqByTurn.set(turnId, eventSeq);

    await this.store.appendEvent({
      eventId: newEventId(),
      turnId,
      eventSeq,
      eventType,
      payload,
      createdAt: now()
    });
  }

  private async loadReadySession(
    bridgeSessionId: string,
    includeActive = false
  ): Promise<DelegateSessionRecord> {
    const session = await this.store.findSessionById(bridgeSessionId);
    if (!session) {
      throw new BridgeError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在", false);
    }
    if (!includeActive && session.status !== "READY") {
      throw new BridgeError(ErrorCodes.SESSION_NOT_READY, "会话不可用或已关闭", false);
    }
    return session;
  }

  private validateWorkspace(workspacePath: string): void {
    if (!workspacePath) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, "workspace_path 不能为空", false);
    }
    if (!this.runtime.allowedWorkspaces || this.runtime.allowedWorkspaces.length === 0) {
      return;
    }

    const allowed = this.runtime.allowedWorkspaces.some((item) =>
      workspacePath.toLowerCase().startsWith(item.toLowerCase())
    );
    if (!allowed) {
      throw new BridgeError(ErrorCodes.INVALID_REQUEST, "workspace_path 不在白名单", false);
    }
  }

  private normalizeError(error: unknown, code: ErrorCode = ErrorCodes.PROMPT_EXEC_FAILED): BridgeError {
    if (error instanceof BridgeError) {
      return error;
    }
    return new BridgeError(
      code,
      error instanceof Error ? error.message : String(error),
      true
    );
  }

  private async audit(
    requestId: string,
    action: string,
    actor: string,
    resultCode: string,
    detail?: unknown
  ): Promise<void> {
    const record: DelegateAuditRecord = {
      auditId: newRequestId(),
      requestId,
      action,
      actor,
      resultCode,
      detail,
      createdAt: now()
    };
    await this.store.appendAudit(record);
  }

  private async waitForTurnToSettle(
    bridgeSessionId: string,
    activeTurnId: string | undefined,
    timeoutMs: number
  ): Promise<boolean> {
    if (!activeTurnId) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const session = await this.store.findSessionById(bridgeSessionId);
      if (!session || session.activeTurnId !== activeTurnId) {
        return true;
      }
      await sleep(200);
    }
    return false;
  }
}
