CREATE TABLE IF NOT EXISTS delegate_sessions (
  bridge_session_id TEXT PRIMARY KEY,
  session_alias TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  acp_session_id TEXT NOT NULL,
  current_model TEXT,
  config_options_json TEXT NOT NULL,
  process_pid INTEGER,
  status TEXT NOT NULL,
  last_error_code TEXT,
  active_turn_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_path, session_alias)
);

CREATE TABLE IF NOT EXISTS delegate_turns (
  turn_id TEXT PRIMARY KEY,
  bridge_session_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL,
  turn_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL,
  stop_reason TEXT,
  usage_json TEXT,
  started_at TEXT,
  ended_at TEXT,
  UNIQUE (bridge_session_id, idempotency_key),
  FOREIGN KEY (bridge_session_id) REFERENCES delegate_sessions (bridge_session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delegate_turns_session_seq
ON delegate_turns (bridge_session_id, turn_seq);

CREATE TABLE IF NOT EXISTS delegate_events (
  event_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (turn_id, event_seq),
  FOREIGN KEY (turn_id) REFERENCES delegate_turns (turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delegate_events_turn_seq
ON delegate_events (turn_id, event_seq);

CREATE TABLE IF NOT EXISTS delegate_workflows (
  workflow_key TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  session_alias TEXT NOT NULL,
  bridge_session_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_path, session_alias)
);

CREATE INDEX IF NOT EXISTS idx_delegate_workflows_session
ON delegate_workflows (bridge_session_id);

CREATE TABLE IF NOT EXISTS delegate_pending_starts (
  workflow_key TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  session_alias TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_path, session_alias)
);

CREATE INDEX IF NOT EXISTS idx_delegate_pending_starts_identity
ON delegate_pending_starts (workspace_path, session_alias);

CREATE TABLE IF NOT EXISTS delegate_audit_logs (
  audit_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  result_code TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delegate_audit_request
ON delegate_audit_logs (request_id);
