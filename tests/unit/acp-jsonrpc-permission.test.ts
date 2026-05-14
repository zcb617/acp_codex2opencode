import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/observability/logger.js";
import { NdjsonTransport } from "../../src/acp-client/ndjson-transport.js";
import { JsonRpcClient } from "../../src/acp-client/jsonrpc-client.js";
import { AcpSessionApi } from "../../src/acp-client/session-api.js";

function waitForMessage(stream: PassThrough, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for json message"));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx < 0) {
        return;
      }
      const line = buffer.slice(0, idx).trim();
      cleanup();
      resolve(JSON.parse(line) as Record<string, unknown>);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
    };

    stream.on("data", onData);
    stream.on("error", onError);
  });
}

describe("acp jsonrpc request handling", () => {
  it("should keep request/response flow for outbound rpc requests", async () => {
    const incoming = new PassThrough();
    const outgoing = new PassThrough();

    const transport = new NdjsonTransport(incoming, outgoing, createLogger("ERROR"));
    const rpc = new JsonRpcClient(transport, createLogger("ERROR"));
    rpc.start();

    const promise = rpc.request<{ ok: boolean }>("session/new", { cwd: "D:/repo" }, 2000);
    const outbound = await waitForMessage(outgoing);

    expect(outbound.method).toBe("session/new");
    expect(typeof outbound.id).toBe("number");

    incoming.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        result: { ok: true }
      })}\n`
    );

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("should auto approve session/request_permission via AcpSessionApi", async () => {
    const incoming = new PassThrough();
    const outgoing = new PassThrough();

    const transport = new NdjsonTransport(incoming, outgoing, createLogger("ERROR"));
    const rpc = new JsonRpcClient(transport, createLogger("ERROR"));
    const api = new AcpSessionApi(rpc, createLogger("ERROR"));
    api.start();

    const responsePromise = waitForMessage(outgoing);
    incoming.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "session/request_permission",
        params: {
          sessionId: "sess_1",
          toolCall: {
            toolCallId: "call_1"
          },
          options: [
            {
              optionId: "reject-once",
              kind: "reject_once"
            },
            {
              optionId: "allow-once",
              kind: "allow_once"
            }
          ]
        }
      })}\n`
    );

    const response = await responsePromise;
    expect(response.id).toBe(7);
    expect(response.error).toBeUndefined();

    const result = response.result as {
      outcome: { outcome: string; optionId?: string };
    };
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("allow-once");
  });
});
