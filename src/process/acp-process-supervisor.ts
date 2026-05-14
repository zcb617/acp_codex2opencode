import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { BridgeError } from "../shared/errors.js";
import { ErrorCodes } from "../shared/error-codes.js";
import type { Logger } from "../observability/logger.js";

export interface AcpProcessOptions {
  binPath: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class AcpProcessSupervisor {
  private readonly options: AcpProcessOptions;

  private readonly logger: Logger;

  private processHandle?: ChildProcessWithoutNullStreams;

  public constructor(options: AcpProcessOptions, logger: Logger) {
    this.options = options;
    this.logger = logger;
  }

  public ensureRunning(): ChildProcessWithoutNullStreams {
    if (this.processHandle && !this.processHandle.killed) {
      return this.processHandle;
    }

    const args = this.options.args ?? ["acp"];
    const child = spawn(this.options.binPath, args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: "pipe"
    });

    child.once("error", (error) => {
      this.logger.error("acp.process.error", { error: error.message });
    });

    child.once("exit", (code, signal) => {
      this.logger.warn("acp.process.exit", { code, signal });
      this.processHandle = undefined;
    });

    this.processHandle = child;
    this.logger.info("acp.process.started", { pid: child.pid, command: this.options.binPath, args });
    return child;
  }

  public getPid(): number | undefined {
    return this.processHandle?.pid;
  }

  public async stop(): Promise<void> {
    if (!this.processHandle) {
      return;
    }

    const target = this.processHandle;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new BridgeError(
            ErrorCodes.ACP_PROCESS_UNAVAILABLE,
            "停止 ACP 进程超时",
            true
          )
        );
      }, 5000);

      target.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      target.kill();
    });

    this.processHandle = undefined;
  }
}
