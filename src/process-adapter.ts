import { spawn } from "node:child_process";
import type { OperationAdapter, SimulationRequest } from "./model.ts";

export type ProcessAdapterOptions = {
  command: string;
  args?: string[];
  operation: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export function createProcessAdapter(options: ProcessAdapterOptions): OperationAdapter {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;

  if (!options.command) throw new Error("Process adapter command cannot be empty");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Process adapter timeout must be positive");

  return {
    name: `process:${options.command}`,
    execute(request) {
      return executeProcess(
        options.command,
        options.args ?? [],
        {
          protocol: "crdd-ir/adapter-v0.1",
          operation: options.operation,
          request,
        },
        timeoutMs,
        maxOutputBytes,
      );
    },
  };
}

async function executeProcess(
  command: string,
  args: string[],
  input: unknown,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`process timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.on("error", (error) => finish(() => reject(new Error(`failed to start process: ${error.message}`))));
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish(() => reject(new Error(`process output exceeded ${maxOutputBytes} bytes`)));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (code) => {
      finish(() => {
        const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(`process exited with code ${code}${errorOutput ? `: ${errorOutput}` : ""}`));
          return;
        }
        const output = Buffer.concat(stdout).toString("utf8").trim();
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error(`process returned invalid JSON${output ? `: ${output.slice(0, 200)}` : ""}`));
        }
      });
    });

    child.stdin.end(`${JSON.stringify(input)}\n`, "utf8");
  });
}
