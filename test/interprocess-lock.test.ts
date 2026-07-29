import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withInterprocessLock } from "../src/interprocess-lock.ts";

test("serializes concurrent work for the same normalized output scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "crdd-lock-"));
  const scope = join(root, "Generated");
  const events: string[] = [];
  const first = withInterprocessLock(scope, async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 80));
    events.push("first:end");
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = withInterprocessLock(scope, async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("reports lock owner and timeout without stealing a live lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "crdd-lock-"));
  const scope = join(root, "Generated");
  await writeFile(`${scope}.crdd-lock`, JSON.stringify({
    protocol: "crdd-ir/lock-v0.1",
    id: "live",
    pid: process.pid,
    startedAt: new Date(0).toISOString(),
    scope,
    command: ["test-owner"],
  }));
  await assert.rejects(
    withInterprocessLock(scope, async () => undefined, { timeoutMs: 20, staleAfterMs: 1 }),
    /CRDD_LOCK_TIMEOUT.*pid=/,
  );
  assert.match(await readFile(`${scope}.crdd-lock`, "utf8"), /"id":"live"/);
});

test("recovers an expired lock owned by a dead process", async () => {
  const root = await mkdtemp(join(tmpdir(), "crdd-lock-"));
  const scope = join(root, "Generated");
  const lockPath = `${scope}.crdd-lock`;
  await writeFile(lockPath, JSON.stringify({
    protocol: "crdd-ir/lock-v0.1",
    id: "stale",
    pid: 2147483647,
    startedAt: new Date(0).toISOString(),
    scope,
    command: ["dead-owner"],
  }));
  let entered = false;
  await withInterprocessLock(scope, async () => {
    entered = true;
    assert.doesNotMatch(await readFile(lockPath, "utf8"), /"id":"stale"/);
  }, { timeoutMs: 100, staleAfterMs: 1 });
  assert.equal(entered, true);
  await assert.rejects(access(lockPath), /ENOENT/);
});
