import type { Readable, Writable } from "node:stream";
import type { Logger } from "../observability/logger.js";
import { BridgeError } from "../shared/errors.js";
import { ErrorCodes } from "../shared/error-codes.js";

type MessageHandler = (message: unknown) => void;

export class NdjsonTransport {
  private readonly input: Readable;

  private readonly output: Writable;

  private readonly logger: Logger;

  private onMessage?: MessageHandler;

  private buffer = "";

  public constructor(input: Readable, output: Writable, logger: Logger) {
    this.input = input;
    this.output = output;
    this.logger = logger;
  }

  public start(onMessage: MessageHandler): void {
    this.onMessage = onMessage;
    this.input.on("data", (chunk: Buffer | string) => {
      this.consumeChunk(chunk.toString("utf8"));
    });
  }

  public async send(message: unknown): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    const isOk = this.output.write(line, "utf8");
    if (isOk) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.output.once("drain", () => resolve());
    });
  }

  private consumeChunk(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const newLineIndex = this.buffer.indexOf("\n");
      if (newLineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newLineIndex).trim();
      this.buffer = this.buffer.slice(newLineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as unknown;
        this.onMessage?.(parsed);
      } catch (error) {
        this.logger.error("acp.transport.bad_frame", {
          line,
          error: error instanceof Error ? error.message : String(error)
        });
        throw new BridgeError(ErrorCodes.ACP_PROTOCOL_ERROR, "收到非法 JSON 协议帧", true);
      }
    }
  }
}
