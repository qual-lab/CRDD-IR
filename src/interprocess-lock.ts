import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LockOwner = {
  protocol: "crdd-ir/lock-v0.1";
  id: string;
  pid: number;
  startedAt: string;
  scope: string;
  command: string[];
};

export async function withInterprocessLock<T>(
  scope: string,
  action: () => Promise<T>,
  options: { timeoutMs?: number; staleAfterMs?: number } = {},
): Promise<T> {
  const normalizedScope = resolve(scope);
  const lockPath = `${normalizedScope}.crdd-lock`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const staleAfterMs = options.staleAfterMs ?? 10 * 60_000;
  const started = Date.now();
  const owner: LockOwner = {
    protocol: "crdd-ir/lock-v0.1",
    id: randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    scope: normalizedScope.replaceAll("\\", "/"),
    command: process.argv.slice(1),
  };
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readOwner(lockPath);
      if (canRecover(existing, staleAfterMs)) {
        await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        });
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        const identity = existing
          ? `pid=${existing.pid}, startedAt=${existing.startedAt}, command=${existing.command.join(" ")}`
          : "owner metadata unavailable";
        throw new Error(
          `CRDD_LOCK_TIMEOUT: scope "${normalizedScope}" is locked (${identity})`,
        );
      }
      await delay(50);
    }
  }

  try {
    return await action();
  } finally {
    const current = await readOwner(lockPath);
    if (current?.id === owner.id) {
      await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export function lockIdentity(scope: string): string {
  return createHash("sha256").update(resolve(scope).toLowerCase()).digest("hex");
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as LockOwner;
    return value.protocol === "crdd-ir/lock-v0.1" ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function canRecover(owner: LockOwner | undefined, staleAfterMs: number): boolean {
  if (!owner) return false;
  const age = Date.now() - Date.parse(owner.startedAt);
  return age >= staleAfterMs && !isProcessAlive(owner.pid);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
