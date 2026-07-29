import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { getTargetAdapter } from "../src/target-registry.ts";

const querySource = "test/fixtures/contracts/read-contract.md";
const asyncSource = "test/fixtures/contracts/background-contract.md";

test("generates executable TypeScript query DTOs and validators", async () => {
  const compilation = await compileMarkdown(querySource);
  const [generated] = getTargetAdapter("typescript").generate({
    compilation,
    operationIndex: 0,
  });
  assert.equal(generated.name, "QueryRecord.generated.ts");
  assert.match(generated.content, /export interface QueryRecordHandler/);
  assert.match(generated.content, /Readonly<QueryRecordState>/);

  const directory = await mkdtemp(join(tmpdir(), "crdd-typescript-"));
  const path = join(directory, generated.name);
  await writeFile(path, generated.content, "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`);

  assert.equal(module.validateQueryRecordInput({ id: "record-1" }), true);
  assert.equal(module.validateQueryRecordInput({ id: "" }), false);
  assert.equal(module.validateQueryRecordState({
    records: {
      first: { id: "record-1", labels: ["one", "two"] },
    },
  }), true);
  assert.equal(module.validateQueryRecordOutput(null), true);
  assert.equal(module.validateQueryRecordOutput({
    id: "record-1",
    metadata: { owner: "team", optional: null },
  }), true);
  assert.equal(module.validateQueryRecordOutput({
    id: "record-1",
    metadata: { owner: 1 },
  }), false);
});

test("generates async handler and discriminated event contracts", async () => {
  const compilation = await compileMarkdown(asyncSource);
  const [generated] = getTargetAdapter("typescript").generate({
    compilation,
    operationIndex: 0,
  });
  assert.match(generated.content, /export type SubmitTaskEvent/);
  assert.match(generated.content, /readonly type: "TaskCompleted"/);
  assert.match(generated.content, /"idempotency": "required"/);
  assert.match(generated.content, /"mode": "async"/);
});

test("TypeScript target supports deterministic flat batches", async () => {
  const compilation = await compileMarkdown(querySource);
  const target = getTargetAdapter("typescript");
  const first = target.generate({ compilation, operationIndex: 0 });
  const second = target.generate({ compilation, operationIndex: 0 });
  assert.deepEqual(first, second);
  assert.equal(target.supportsFlatBatch, true);
});
