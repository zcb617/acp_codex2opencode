import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";
import type {
  DelegateAuditRecord,
  DelegateEventRecord,
  DelegateSessionRecord,
  DelegateTurnRecord,
  DelegateWorkflowRecord
} from "../shared/types.js";

type Db = Database<sqlite3.Database, sqlite3.Statement>;

interface SessionRow {
  bridge_session_id: string;
  session_alias: string;
  workspace_path: string;
  acp_session_id: string;
  current_model: string | null;
  config_options_json: string;
  process_pid: number | null;
  status: string;
  last_error_code: string | null;
  active_turn_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  turn_id: string;
  bridge_session_id: string;
  turn_seq: number;
  turn_type: string;
  idempotency_key: string;
  prompt_sha256: string;
  prompt_text: string;
  status: string;
  stop_reason: string | null;
  usage_json: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface EventRow {
  event_id: string;
  turn_id: string;
  event_seq: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface WorkflowRow {
  workflow_key: string;
  workspace_path: string;
  session_alias: string;
  bridge_session_id: string;
  stage: string;
  snapshot_json: string;
  created_at: string;
  updated_at: string;
}

interface PendingStartRow {
  workflow_key: string;
  workspace_path: string;
  session_alias: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export class SqliteStore {
  private readonly filePath: string;

  private db?: Db;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const db = await open({
      filename: this.filePath,
      driver: sqlite3.Database
    });
    this.db = db;
    await db.exec("PRAGMA foreign_keys = ON;");
    await this.ensureSchema(db);
  }

  public async close(): Promise<void> {
    if (!this.db) {
      return;
    }
    await this.db.close();
    this.db = undefined;
  }

  public async findSessionByAlias(
    workspacePath: string,
    sessionAlias: string
  ): Promise<DelegateSessionRecord | undefined> {
    const row = await this.mustDb().get<SessionRow>(
      `SELECT * FROM delegate_sessions
       WHERE workspace_path = ? AND session_alias = ?
       LIMIT 1`,
      [workspacePath, sessionAlias]
    );
    return row ? this.mapSessionRow(row) : undefined;
  }

  public async findSessionById(bridgeSessionId: string): Promise<DelegateSessionRecord | undefined> {
    const row = await this.mustDb().get<SessionRow>(
      `SELECT * FROM delegate_sessions
       WHERE bridge_session_id = ?
       LIMIT 1`,
      [bridgeSessionId]
    );
    return row ? this.mapSessionRow(row) : undefined;
  }

  public async saveSession(record: DelegateSessionRecord): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_sessions (
          bridge_session_id, session_alias, workspace_path, acp_session_id, current_model,
          config_options_json, process_pid, status, last_error_code, active_turn_id,
          created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bridge_session_id) DO UPDATE SET
          session_alias = excluded.session_alias,
          workspace_path = excluded.workspace_path,
          acp_session_id = excluded.acp_session_id,
          current_model = excluded.current_model,
          config_options_json = excluded.config_options_json,
          process_pid = excluded.process_pid,
          status = excluded.status,
          last_error_code = excluded.last_error_code,
          active_turn_id = excluded.active_turn_id,
          updated_at = excluded.updated_at`,
      [
        record.bridgeSessionId,
        record.sessionAlias,
        record.workspacePath,
        record.acpSessionId,
        record.currentModel ?? null,
        JSON.stringify(record.configOptions ?? []),
        record.processPid ?? null,
        record.status,
        record.lastErrorCode ?? null,
        record.activeTurnId ?? null,
        record.createdAt,
        record.updatedAt
      ]
    );
  }

  public async findTurnByIdempotency(
    bridgeSessionId: string,
    idempotencyKey: string
  ): Promise<DelegateTurnRecord | undefined> {
    const row = await this.mustDb().get<TurnRow>(
      `SELECT * FROM delegate_turns
       WHERE bridge_session_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [bridgeSessionId, idempotencyKey]
    );
    return row ? this.mapTurnRow(row) : undefined;
  }

  public async nextTurnSeq(bridgeSessionId: string): Promise<number> {
    const row = await this.mustDb().get<{ max_seq: number | null }>(
      `SELECT MAX(turn_seq) AS max_seq
       FROM delegate_turns
       WHERE bridge_session_id = ?`,
      [bridgeSessionId]
    );
    return (row?.max_seq ?? 0) + 1;
  }

  public async saveTurn(record: DelegateTurnRecord): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_turns (
          turn_id, bridge_session_id, turn_seq, turn_type, idempotency_key,
          prompt_sha256, prompt_text, status, stop_reason, usage_json, started_at, ended_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(turn_id) DO UPDATE SET
          bridge_session_id = excluded.bridge_session_id,
          turn_seq = excluded.turn_seq,
          turn_type = excluded.turn_type,
          idempotency_key = excluded.idempotency_key,
          prompt_sha256 = excluded.prompt_sha256,
          prompt_text = excluded.prompt_text,
          status = excluded.status,
          stop_reason = excluded.stop_reason,
          usage_json = excluded.usage_json,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at`,
      [
        record.turnId,
        record.bridgeSessionId,
        record.turnSeq,
        record.turnType,
        record.idempotencyKey,
        record.promptSha256,
        record.promptText,
        record.status,
        record.stopReason ?? null,
        record.usage ? JSON.stringify(record.usage) : null,
        record.startedAt ?? null,
        record.endedAt ?? null
      ]
    );
  }

  public async listTurns(bridgeSessionId: string): Promise<DelegateTurnRecord[]> {
    const rows = await this.mustDb().all<TurnRow[]>(
      `SELECT * FROM delegate_turns
       WHERE bridge_session_id = ?
       ORDER BY turn_seq ASC`,
      [bridgeSessionId]
    );
    return rows.map((row) => this.mapTurnRow(row));
  }

  public async appendEvent(record: DelegateEventRecord): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_events (
          event_id, turn_id, event_seq, event_type, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.eventId,
        record.turnId,
        record.eventSeq,
        record.eventType,
        JSON.stringify(record.payload),
        record.createdAt
      ]
    );
  }

  public async listEvents(turnId: string): Promise<DelegateEventRecord[]> {
    const rows = await this.mustDb().all<EventRow[]>(
      `SELECT * FROM delegate_events
       WHERE turn_id = ?
       ORDER BY event_seq ASC`,
      [turnId]
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      turnId: row.turn_id,
      eventSeq: row.event_seq,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at
    }));
  }

  public async saveWorkflow(record: DelegateWorkflowRecord): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_workflows (
          workflow_key, workspace_path, session_alias, bridge_session_id, stage,
          snapshot_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_key) DO UPDATE SET
          workspace_path = excluded.workspace_path,
          session_alias = excluded.session_alias,
          bridge_session_id = excluded.bridge_session_id,
          stage = excluded.stage,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at`,
      [
        record.workflowKey,
        record.workspacePath,
        record.sessionAlias,
        record.bridgeSessionId,
        record.stage,
        JSON.stringify(record.snapshot),
        record.createdAt,
        record.updatedAt
      ]
    );
  }

  public async findWorkflowByKey(workflowKey: string): Promise<DelegateWorkflowRecord | undefined> {
    const row = await this.mustDb().get<WorkflowRow>(
      `SELECT * FROM delegate_workflows
       WHERE workflow_key = ?
       LIMIT 1`,
      [workflowKey]
    );
    return row ? this.mapWorkflowRow(row) : undefined;
  }

  public async listWorkflows(): Promise<DelegateWorkflowRecord[]> {
    const rows = await this.mustDb().all<WorkflowRow[]>(
      `SELECT * FROM delegate_workflows
       ORDER BY updated_at ASC`
    );
    return rows.map((row) => this.mapWorkflowRow(row));
  }

  public async deleteWorkflow(workflowKey: string): Promise<void> {
    await this.mustDb().run(`DELETE FROM delegate_workflows WHERE workflow_key = ?`, [workflowKey]);
  }

  public async savePendingStart(record: {
    workflowKey: string;
    workspacePath: string;
    sessionAlias: string;
    payload: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_pending_starts (
          workflow_key, workspace_path, session_alias, payload_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_key) DO UPDATE SET
          workspace_path = excluded.workspace_path,
          session_alias = excluded.session_alias,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at`,
      [
        record.workflowKey,
        record.workspacePath,
        record.sessionAlias,
        JSON.stringify(record.payload),
        record.createdAt,
        record.updatedAt
      ]
    );
  }

  public async findPendingStartByKey(workflowKey: string): Promise<
    | {
        workflowKey: string;
        workspacePath: string;
        sessionAlias: string;
        payload: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
      }
    | undefined
  > {
    const row = await this.mustDb().get<PendingStartRow>(
      `SELECT * FROM delegate_pending_starts
       WHERE workflow_key = ?
       LIMIT 1`,
      [workflowKey]
    );
    if (!row) {
      return undefined;
    }
    return {
      workflowKey: row.workflow_key,
      workspacePath: row.workspace_path,
      sessionAlias: row.session_alias,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public async deletePendingStart(workflowKey: string): Promise<void> {
    await this.mustDb().run(`DELETE FROM delegate_pending_starts WHERE workflow_key = ?`, [workflowKey]);
  }

  public async appendAudit(record: DelegateAuditRecord): Promise<void> {
    await this.mustDb().run(
      `INSERT INTO delegate_audit_logs (
          audit_id, request_id, action, actor, result_code, detail_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.auditId,
        record.requestId,
        record.action,
        record.actor,
        record.resultCode,
        record.detail ? JSON.stringify(record.detail) : null,
        record.createdAt
      ]
    );
  }

  private mustDb(): Db {
    if (!this.db) {
      throw new Error("SqliteStore not initialized");
    }
    return this.db;
  }

  private mapSessionRow(row: SessionRow): DelegateSessionRecord {
    return {
      bridgeSessionId: row.bridge_session_id,
      sessionAlias: row.session_alias,
      workspacePath: row.workspace_path,
      acpSessionId: row.acp_session_id,
      currentModel: row.current_model ?? undefined,
      configOptions: JSON.parse(row.config_options_json),
      processPid: row.process_pid ?? undefined,
      status: row.status as DelegateSessionRecord["status"],
      lastErrorCode: row.last_error_code ?? undefined,
      activeTurnId: row.active_turn_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapTurnRow(row: TurnRow): DelegateTurnRecord {
    return {
      turnId: row.turn_id,
      bridgeSessionId: row.bridge_session_id,
      turnSeq: row.turn_seq,
      turnType: row.turn_type as DelegateTurnRecord["turnType"],
      idempotencyKey: row.idempotency_key,
      promptSha256: row.prompt_sha256,
      promptText: row.prompt_text,
      status: row.status as DelegateTurnRecord["status"],
      stopReason: row.stop_reason ?? undefined,
      usage: row.usage_json ? JSON.parse(row.usage_json) : undefined,
      startedAt: row.started_at ?? undefined,
      endedAt: row.ended_at ?? undefined
    };
  }

  private mapWorkflowRow(row: WorkflowRow): DelegateWorkflowRecord {
    return {
      workflowKey: row.workflow_key,
      workspacePath: row.workspace_path,
      sessionAlias: row.session_alias,
      bridgeSessionId: row.bridge_session_id,
      stage: row.stage,
      snapshot: JSON.parse(row.snapshot_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private async ensureSchema(db: Db): Promise<void> {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const rootDir = join(moduleDir, "..", "..");
    const schemaCandidates = [
      join(moduleDir, "migrations", "001_init.sql"),
      join(rootDir, "src", "store", "migrations", "001_init.sql"),
      join(process.cwd(), "src", "store", "migrations", "001_init.sql")
    ];

    let sql: string | undefined;
    for (const schemaPath of schemaCandidates) {
      try {
        sql = await readFile(schemaPath, "utf8");
        break;
      } catch {
        // Try next candidate path.
      }
    }

    if (!sql) {
      throw new Error(
        `Missing required migration file 001_init.sql. Tried: ${schemaCandidates.join(", ")}`
      );
    }
    await db.exec(sql);
  }
}
