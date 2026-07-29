import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { validateIr } from "../src/ir.ts";
import { getTargetAdapter } from "../src/target-registry.ts";

const queryOperation = fileURLToPath(new URL(
  "./fixtures/contracts/read-contract.md",
  import.meta.url,
));
const asyncOperation = fileURLToPath(new URL(
  "./fixtures/contracts/background-contract.md",
  import.meta.url,
));

test("compiles a read-only query with nullable recursive output", async () => {
  const { ir } = await compileMarkdown(queryOperation);
  assert.equal(ir.operation.kind, "query");
  assert.equal(ir.operation.transaction, undefined);
  assert.deepEqual(ir.operation.effects, []);
  assert.equal(ir.operation.output?.type, "object");
  assert.deepEqual(validateIr(ir).filter((item) => item.severity === "error"), []);
});

test("compiles an async command with delivery and idempotency contracts", async () => {
  const { ir } = await compileMarkdown(asyncOperation);
  assert.deepEqual(ir.operation.execution, {
    mode: "async",
    cancelable: true,
    timeoutMs: 30000,
    idempotency: "required",
  });
  assert.equal(ir.operation.emits?.[0].type, "TaskCompleted");
  assert.equal(ir.operation.emits?.[0].payload?.type, "union");
});

test("rejects state effects on queries", async () => {
  const ir = structuredClone((await compileMarkdown(queryOperation)).ir);
  ir.operation.effects.push({
    target: "state.resources",
    action: "assign",
    expression: "state.resources",
  });
  assert.ok(validateIr(ir).some((item) =>
    item.path === "$.operation.effects" && item.message.includes("query")));
});

test("compiles an explicit state-changing command", async () => {
  const command = await compileMarkdown(fileURLToPath(new URL(
    "../examples/apply-record/contract.md",
    import.meta.url,
  )));
  assert.equal(command.ir.operation.kind, "command");
  assert.ok(command.ir.operation.transaction?.atomic);
});

test("state-transition targets fail closed for unsupported query semantics", async () => {
  const compilation = await compileMarkdown(queryOperation);
  assert.throws(
    () => getTargetAdapter("unity").generate({ compilation, operationIndex: 0 }),
    /does not yet project query output semantics/,
  );
});
