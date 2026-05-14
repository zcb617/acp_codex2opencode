export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

const orderedLevels: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

function safeExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) {
    return {};
  }

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (key.toLowerCase().includes("key") || key.toLowerCase().includes("token")) {
      clone[key] = "[REDACTED]";
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

export function createLogger(level: LogLevel = "INFO"): Logger {
  function write(logLevel: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (orderedLevels[logLevel] < orderedLevels[level]) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level: logLevel,
      message,
      ...safeExtra(extra)
    };

    // MCP 插件运行时标准输出会被宿主捕获，结构化日志便于审计。
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (message, extra) => {
      write("DEBUG", message, extra);
    },
    info: (message, extra) => {
      write("INFO", message, extra);
    },
    warn: (message, extra) => {
      write("WARN", message, extra);
    },
    error: (message, extra) => {
      write("ERROR", message, extra);
    }
  };
}
