import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import correctAdapter from "../examples/apply-record/adapters/correct.adapter.ts";
import noCapacityAdapter from "../examples/apply-record/adapters/broken-no-capacity.adapter.ts";
import noMinimumAdapter from "../examples/apply-record/adapters/broken-no-minimum.adapter.ts";
import partialEffectAdapter from "../examples/apply-record/adapters/broken-partial-effect.adapter.ts";
import wrongErrorAdapter from "../examples/apply-record/adapters/broken-wrong-error.adapter.ts";
import { validateIr } from "../src/ir.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { createProcessAdapter } from "../src/process-adapter.ts";
import { simulate } from "../src/simulator.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { runTestManifest } from "../src/test-runner.ts";
import { generateUnreal } from "../src/unreal.ts";
import type { CrddIr } from "../src/model.ts";

const ir = JSON.parse(
  await readFile(new URL("../examples/apply-record/apply-record.ir.json", import.meta.url), "utf8"),
) as CrddIr;

function request(length: number, amount: number, remaining: number) {
  return {
    input: { length, amount },
    state: { capacity: { remaining }, records: [] },
  };
}

test("ApplyRecord IR is valid", () => {
  assert.deepEqual(validateIr(ir), []);
});

test("accepts the exact 0.300m boundary and applies both effects", () => {
  const result = simulate(ir, request(0.3, 12_000, 50_000));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state, {
    capacity: { remaining: 38_000 },
    records: [{ length: 0.3, amount: 12_000 }],
  });
});

test("rejects 0.299m without changing state", () => {
  const initial = request(0.299, 12_000, 50_000);
  const result = simulate(ir, initial);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "RECORD_TOO_SMALL");
  assert.deepEqual(result.state, initial.state);
  assert.deepEqual(initial.state, { capacity: { remaining: 50_000 }, records: [] });
});

test("rejects a one-unit capacity shortage without changing state", () => {
  const initial = request(1, 12_000, 11_999);
  const result = simulate(ir, initial);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "INSUFFICIENT_CAPACITY");
  assert.deepEqual(result.state, initial.state);
});

test("derives boundary and rollback cases from contracts", () => {
  const manifest = generateTestManifest(ir);
  assert.ok(manifest.cases.some((entry) => entry.id === "minimum-record-length-below-boundary"));
  assert.ok(manifest.cases.some((entry) => entry.id === "sufficient-capacity-insufficient"));
  assert.ok(manifest.cases.some((entry) => entry.expect.stateUnchanged === true));
  const belowBoundary = manifest.cases.find((entry) => entry.id === "minimum-record-length-below-boundary");
  assert.equal(belowBoundary?.arrange.input.length, 0.299);
});

test("runs every generated contract case", async () => {
  const report = await runTestManifest(ir, generateTestManifest(ir));
  assert.equal(report.total, 5);
  assert.equal(report.passed, 5);
  assert.equal(report.failed, 0);
});

test("reports a contract mismatch instead of hiding it", async () => {
  const manifest = generateTestManifest(ir);
  manifest.cases[0].expect.ok = false;
  manifest.cases[0].expect.error = "RECORD_TOO_SMALL";
  const report = await runTestManifest(ir, manifest);
  assert.equal(report.failed, 1);
  assert.match(report.results[0].message, /expected ok=false/);
});

test("accepts an independent adapter that conforms to the contract", async () => {
  const report = await runTestManifest(ir, generateTestManifest(ir), correctAdapter);
  assert.equal(report.passed, 5);
  assert.equal(report.failed, 0);
});

test("accepts a language-neutral process adapter", async () => {
  const adapter = createProcessAdapter({
    command: process.execPath,
    args: [fileURLToPath(new URL("../examples/apply-record/adapters/process-correct.ts", import.meta.url))],
    operation: "ApplyRecord",
  });
  const report = await runTestManifest(ir, generateTestManifest(ir), adapter);
  assert.equal(report.passed, 5);
  assert.equal(report.failed, 0);
});

test("rejects invalid JSON from a process adapter", async () => {
  const adapter = createProcessAdapter({
    command: process.execPath,
    args: ["-e", "process.stdout.write('not-json')"],
    operation: "ApplyRecord",
  });
  await assert.rejects(() => adapter.execute(request(1, 100, 1000)), /invalid JSON/);
});

test("terminates a process adapter that exceeds its timeout", async () => {
  const adapter = createProcessAdapter({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    operation: "ApplyRecord",
    timeoutMs: 20,
  });
  await assert.rejects(() => adapter.execute(request(1, 100, 1000)), /timed out/);
});

test("generates a portable conformance bundle with reference outcomes", () => {
  const bundle = generateConformanceBundle(ir, generateTestManifest(ir));
  assert.equal(bundle.protocol, "crdd-ir/conformance-v0.1");
  assert.equal(bundle.cases.length, 5);
  assert.ok(bundle.cases.some((entry) => entry.expected.ok === false));
  assert.ok(bundle.cases.some((entry) => entry.expected.ok === true));
});

for (const [defect, adapter, expectedMessage] of [
  ["missing minimum validation", noMinimumAdapter, /expected ok=false/],
  ["missing capacity validation", noCapacityAdapter, /expected ok=false/],
  ["partial state effect", partialEffectAdapter, /final state differs/],
  ["wrong error code", wrongErrorAdapter, /expected error=RECORD_TOO_SMALL/],
] as const) {
  test(`detects adapter defect: ${defect}`, async () => {
    const report = await runTestManifest(ir, generateTestManifest(ir), adapter);
    assert.ok(report.failed > 0);
    assert.ok(report.results.some((result) => expectedMessage.test(result.message)));
  });
}

test("Unreal implementation carries contracts, effects, and CRDD trace IDs", () => {
  const generated = generateUnreal(ir);
  const combined = generated.map((file) => file.content).join("\n");
  assert.match(combined, /CRDD-TRACE: REQ-RECORD-001/);
  assert.match(combined, /RECORD_TOO_SMALL/);
  assert.match(combined, /Input\.LengthUnit >= 0\.3/);
  assert.match(combined, /Result\.State\.Records\.Add/);
  assert.match(combined, /Result\.State\.CapacityRemainingCredit - Input\.AmountCredit/);
  assert.equal(generated.length, 5);
  assert.ok(generated.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("generated Unreal include is independent of the output directory name", () => {
  const source = generateUnreal(ir).find((file) => file.name.endsWith(".cpp"))!.content;
  assert.match(source, /#include "ApplyRecord\.generated\.h"/);
  assert.doesNotMatch(source, /#include "Generated\//);
});

test("generates Unreal code for a second operation without ApplyRecord names", () => {
  const accumulateValue: CrddIr = {
    irVersion: "0.1",
    operation: {
      id: "AccumulateValue",
      kind: "command",
      traces: ["REQ-AGGREGATE-001"],
      input: {
        count: { type: "number" },
        amount: { type: "number", unit: "credit" },
      },
      state: {
        capacity: { type: "number", unit: "credit" },
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              count: { type: "number" },
              amount: { type: "number", unit: "credit" },
            },
          },
        },
      },
      requires: [
        {
          id: "sufficient-capacity",
          expression: "state.capacity >= input.amount",
          error: "INSUFFICIENT_CAPACITY",
        },
      ],
      effects: [
        {
          target: "state.values",
          action: "append",
          value: { count: "$input.count", amount: "$input.amount" },
        },
        {
          target: "state.capacity",
          action: "assign",
          expression: "state.capacity - input.amount",
        },
      ],
      errors: [{ code: "INSUFFICIENT_CAPACITY", traces: ["REQ-AGGREGATE-001"] }],
      transaction: { atomic: true, rollbackOnFailure: true },
    },
  };

  const generated = generateUnreal(accumulateValue);
  const combined = generated.map((file) => file.content).join("\n");
  assert.deepEqual(
    generated.map((file) => file.name),
    [
      "AccumulateValue.generated.h",
      "AccumulateValue.generated.cpp",
      "AccumulateValue.bridge.generated.h",
      "AccumulateValue.bridge.generated.cpp",
      "AccumulateValue.bridge.generated.spec.cpp",
    ],
  );
  assert.match(combined, /FCrddAccumulateValueOperation/);
  assert.match(combined, /TArray<FCrddAccumulateValueValuesItem>/);
  assert.match(combined, /Result\.State\.Values\.Add\(\{Input\.Count, Input\.AmountCredit\}\)/);
  assert.doesNotMatch(combined, /ApplyRecord/);
});

test("generates a product bridge with atomic snapshot ownership", () => {
  const generated = generateUnreal(ir);
  const header = generated.find((file) => file.name === "ApplyRecord.bridge.generated.h")!.content;
  const source = generated.find((file) => file.name === "ApplyRecord.bridge.generated.cpp")!.content;
  const fixture = generated.find(
    (file) => file.name === "ApplyRecord.bridge.generated.spec.cpp",
  )!.content;

  assert.match(header, /class ICrddApplyRecordProductAdapter/);
  assert.match(header, /virtual bool CommitSnapshot/);
  assert.match(header, /uint64 ExpectedRevision/);
  assert.match(source, /if \(!ContractResult\.bSucceeded\)/);
  assert.match(source, /Candidate\.Revision = OriginalSnapshot\.Revision \+ 1/);
  assert.ok(source.indexOf("if (!ContractResult.bSucceeded)") < source.indexOf("CommitSnapshot("));
  assert.match(source, /BRIDGE_REVISION_OVERFLOW/);
  assert.match(fixture, /Request failure does not commit/);
  assert.match(fixture, /Loaded revision is preserved/);
});

test("reports a requirement that references an undeclared error", () => {
  const invalid = structuredClone(ir);
  invalid.operation.requires[0].error = "UNKNOWN";
  assert.ok(
    validateIr(invalid).some(
      (diagnostic) => diagnostic.path.endsWith(".error") && diagnostic.message.includes("undeclared"),
    ),
  );
});

test("rejects undefined expression references", () => {
  const invalid = structuredClone(ir);
  invalid.operation.requires[0].expression = "input.width >= 0.3";
  assert.ok(
    validateIr(invalid).some((diagnostic) => diagnostic.message.includes('undefined field "input.width"')),
  );
});

test("rejects comparisons between incompatible units", () => {
  const invalid = structuredClone(ir);
  invalid.operation.input.amount.unit = "other";
  assert.ok(
    validateIr(invalid).some((diagnostic) => diagnostic.message.includes("incompatible units")),
  );
});

test("rejects append effects on non-array state", () => {
  const invalid = structuredClone(ir);
  invalid.operation.effects[0].target = "state.capacity.remaining";
  assert.ok(
    validateIr(invalid).some((diagnostic) => diagnostic.message.includes("append requires an array target")),
  );
});

test("requires an explicit item schema for array state", () => {
  const invalid = structuredClone(ir) as unknown as {
    operation: { state: Record<string, Record<string, unknown>> };
  };
  delete invalid.operation.state.records.items;
  assert.ok(
    validateIr(invalid).some(
      (diagnostic) => diagnostic.path.endsWith(".records.items") && diagnostic.message.includes("object item schema"),
    ),
  );
});

test("rejects append values that do not match the array item schema", () => {
  const invalid = structuredClone(ir);
  if (invalid.operation.state.records.type !== "array") return;
  invalid.operation.state.records.items.properties.amount.unit = "other";
  assert.ok(
    validateIr(invalid).some(
      (diagnostic) => diagnostic.path.endsWith(".value.amount") && diagnostic.message.includes('expected "other"'),
    ),
  );
});

test("requires atomic rollback for state-changing operations", () => {
  const invalid = structuredClone(ir);
  invalid.operation.transaction.atomic = false;
  invalid.operation.transaction.rollbackOnFailure = false;
  const diagnostics = validateIr(invalid);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.path.endsWith(".atomic")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.path.endsWith(".rollbackOnFailure")));
});
