import { describe, expect, it, vi } from "vitest";
import { BridgeService } from "../../src/session/bridge-service.js";
import { createLogger } from "../../src/observability/logger.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";

function createService(): BridgeService {
  const service = new BridgeService(
    {
      opencodeBinPath: "opencode",
      stateDir: "D:/tmp/acp-detect-test",
      turnTimeoutMs: 30_000
    },
    createLogger("ERROR"),
    new MetricsRegistry()
  );
  const hacked = service as unknown as Record<string, unknown>;
  hacked.loadContextFromReferencedDocs = vi.fn(async () => ({ content: "", loadedPaths: [] }));
  hacked.loadHistoricalWorkflowContext = vi.fn(async () => "");
  hacked.classifyWorkflowEntryViaModel = vi.fn(async () => null);
  return service;
}

describe("bridge workflow start phase detection", () => {
  it("should return need_user_input when model does not return parseable decision", async () => {
    const service = createService();
    const hacked = service as unknown as {
      detectWorkflowEntry: (workspacePath: string, sessionAlias: string, requirementText: string) => Promise<{
        phase: string;
        evidence: string[];
        missingContext: string[];
      }>;
    };
    const result = await hacked.detectWorkflowEntry("D:/repo", "alias-1", "实现一个功能");
    expect(result.phase).toBe("need_user_input");
    expect(result.missingContext.length).toBeGreaterThan(0);
    expect(result.evidence.some((item) => item.includes("模型判定未产出可解析结果"))).toBe(true);
  });

  it("should prefer model decision when model returns planning", async () => {
    const service = createService();
    const hacked = service as unknown as {
      classifyWorkflowEntryViaModel: ReturnType<typeof vi.fn>;
      detectWorkflowEntry: (
        workspacePath: string,
        sessionAlias: string,
        requirementText: string
      ) => Promise<{
        phase: string;
        evidence: string[];
      }>;
    };
    hacked.classifyWorkflowEntryViaModel = vi.fn(async () => ({
      phase: "planning",
      missingContext: [],
      reason: "已有设计稿，计划缺失"
    }));
    const result = await hacked.detectWorkflowEntry("D:/repo", "alias-2", "请继续任务");
    expect(result.phase).toBe("planning");
    expect(result.evidence.some((item) => item.includes("模型判定起始阶段"))).toBe(true);
  });

  it("should prefer model decision when model returns implementation", async () => {
    const service = createService();
    const hacked = service as unknown as {
      classifyWorkflowEntryViaModel: ReturnType<typeof vi.fn>;
      detectWorkflowEntry: (
        workspacePath: string,
        sessionAlias: string,
        requirementText: string
      ) => Promise<{
        phase: string;
      }>;
    };
    hacked.classifyWorkflowEntryViaModel = vi.fn(async () => ({
      phase: "implementation",
      missingContext: [],
      reason: "设计与计划齐全"
    }));
    const result = await hacked.detectWorkflowEntry("D:/repo", "alias-3", "请继续任务");
    expect(result.phase).toBe("implementation");
  });

  it("should prefer model decision when model returns design", async () => {
    const service = createService();
    const hacked = service as unknown as {
      classifyWorkflowEntryViaModel: ReturnType<typeof vi.fn>;
      detectWorkflowEntry: (
        workspacePath: string,
        sessionAlias: string,
        requirementText: string
      ) => Promise<{
        phase: string;
      }>;
    };
    hacked.classifyWorkflowEntryViaModel = vi.fn(async () => ({
      phase: "design",
      missingContext: [],
      reason: "缺少可评审设计稿"
    }));
    const result = await hacked.detectWorkflowEntry("D:/repo", "alias-4", "请继续任务");
    expect(result.phase).toBe("design");
  });

  it("should return model-required context when model says need_user_input", async () => {
    const service = createService();
    const hacked = service as unknown as {
      classifyWorkflowEntryViaModel: ReturnType<typeof vi.fn>;
      detectWorkflowEntry: (
        workspacePath: string,
        sessionAlias: string,
        requirementText: string
      ) => Promise<{
        phase: string;
        missingContext: string[];
      }>;
    };
    hacked.classifyWorkflowEntryViaModel = vi.fn(async () => ({
      phase: "need_user_input",
      missingContext: ["design_doc", "plan_doc"],
      reason: "未提供可用文档"
    }));
    const result = await hacked.detectWorkflowEntry("D:/repo", "alias-5", "请实现功能");
    expect(result.phase).toBe("need_user_input");
    expect(result.missingContext).toEqual(["design_doc", "plan_doc"]);
  });

  it("should ignore messageId noise when extracting text chunks", async () => {
    const service = createService();
    const hacked = service as unknown as {
      extractTextChunks: (value: unknown, chunks: string[]) => void;
      parseWorkflowEntryModelDecision: (text: string) => { phase?: string } | null;
    };

    const chunks: string[] = [];
    hacked.extractTextChunks(
      {
        messageId: "msg_abc123",
        update: {
          content: {
            type: "text",
            text: '{"phase":"design","missing_context":[],"reason":"ok"}'
          }
        }
      },
      chunks
    );

    expect(chunks).toEqual(['{"phase":"design","missing_context":[],"reason":"ok"}']);
    const parsed = hacked.parseWorkflowEntryModelDecision(chunks.join(""));
    expect(parsed?.phase).toBe("design");
  });
});
