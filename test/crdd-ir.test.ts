import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import correctAdapter from "../examples/create-entity/adapters/correct.adapter.ts";
import noBudgetAdapter from "../examples/create-entity/adapters/broken-no-budget.adapter.ts";
import noMinimumAdapter from "../examples/create-entity/adapters/broken-no-minimum.adapter.ts";
import partialEffectAdapter from "../examples/create-entity/adapters/broken-partial-effect.adapter.ts";
import wrongErrorAdapter from "../examples/create-entity/adapters/broken-wrong-error.adapter.ts";
import { validateIr } from "../src/ir.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { createProcessAdapter } from "../src/process-adapter.ts";
import { simulate } from "../src/simulator.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { runTestManifest } from "../src/test-runner.ts";
import { generateUnreal } from "../src/unreal.ts";
import type { CrddIr } from "../src/model.ts";

const ir = JSON.parse(
  await readFile(new URL("../examples/create-entity/create-entity.ir.json", import.meta.url), "utf8"),
) as CrddIr;

function request(length: number, cost: number, remaining: number) {
  return {
    input: { length, cost },
    state: { budget: { remaining }, entities: [] },
  };
}

test("CreateEntity IR is valid", () => {
  assert.deepEqual(validateIr(ir), []);
});

test("accepts the exact 0.300m boundary and applies both effects", () => {
  const result = simulate(ir, request(0.3, 12_000, 50_000));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state, {
    budget: { remaining: 38_000 },
    entities: [{ length: 0.3, cost: 12_000 }],
  });
});

test("rejects 0.299m without changing state", () => {
  const initial = request(0.299, 12_000, 50_000);
  const result = simulate(ir, initial);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "ENTITY_TOO_SHORT");
  assert.deepEqual(result.state, initial.state);
  assert.deepEqual(initial.state, { budget: { remaining: 50_000 }, entities: [] });
});

test("rejects a one-yen budget shortage without changing state", () => {
  const initial = request(1, 12_000, 11_999);
  const result = simulate(ir, initial);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "INSUFFICIENT_BUDGET");
  assert.deepEqual(result.state, initial.state);
});

test("derives boundary and rollback cases from contracts", () => {
  const manifest = generateTestManifest(ir);
  assert.ok(manifest.cases.some((entry) => entry.id === "minimum-entity-length-below-boundary"));
  assert.ok(manifest.cases.some((entry) => entry.id === "sufficient-budget-insufficient"));
  assert.ok(manifest.cases.some((entry) => entry.expect.stateUnchanged === true));
  const belowBoundary = manifest.cases.find((entry) => entry.id === "minimum-entity-length-below-boundary");
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
  manifest.cases[0].expect.error = "ENTITY_TOO_SHORT";
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
    args: [fileURLToPath(new URL("../examples/create-entity/adapters/process-correct.ts", import.meta.url))],
    operation: "CreateEntity",
  });
  const report = await runTestManifest(ir, generateTestManifest(ir), adapter);
  assert.equal(report.passed, 5);
  assert.equal(report.failed, 0);
});

test("rejects invalid JSON from a process adapter", async () => {
  const adapter = createProcessAdapter({
    command: process.execPath,
    args: ["-e", "process.stdout.write('not-json')"],
    operation: "CreateEntity",
  });
  await assert.rejects(() => adapter.execute(request(1, 100, 1000)), /invalid JSON/);
});

test("terminates a process adapter that exceeds its timeout", async () => {
  const adapter = createProcessAdapter({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    operation: "CreateEntity",
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
  ["missing budget validation", noBudgetAdapter, /expected ok=false/],
  ["partial state effect", partialEffectAdapter, /final state differs/],
  ["wrong error code", wrongErrorAdapter, /expected error=ENTITY_TOO_SHORT/],
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
  assert.match(combined, /CRDD-TRACE: REQ-ENTITY-001/);
  assert.match(combined, /ENTITY_TOO_SHORT/);
  assert.match(combined, /Input\.LengthMeters >= 0\.3/);
  assert.match(combined, /Result\.State\.Entities\.Add/);
  assert.match(combined, /Result\.State\.BudgetRemainingJPY - Input\.CostJPY/);
  assert.equal(generated.length, 2);
  assert.ok(generated.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("generates Unreal code for a second operation without CreateEntity names", () => {
  const purchaseItem: CrddIr = {
    irVersion: "0.1",
    operation: {
      id: "PurchaseItem",
      traces: ["REQ-SHOP-001"],
      input: {
        quantity: { type: "number" },
        price: { type: "number", unit: "JPY" },
      },
      state: {
        balance: { type: "number", unit: "JPY" },
        purchases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              quantity: { type: "number" },
              price: { type: "number", unit: "JPY" },
            },
          },
        },
      },
      requires: [
        {
          id: "sufficient-balance",
          expression: "state.balance >= input.price",
          error: "INSUFFICIENT_BALANCE",
        },
      ],
      effects: [
        {
          target: "state.purchases",
          action: "append",
          value: { quantity: "$input.quantity", price: "$input.price" },
        },
        {
          target: "state.balance",
          action: "assign",
          expression: "state.balance - input.price",
        },
      ],
      errors: [{ code: "INSUFFICIENT_BALANCE", traces: ["REQ-SHOP-001"] }],
      transaction: { atomic: true, rollbackOnFailure: true },
    },
  };

  const generated = generateUnreal(purchaseItem);
  const combined = generated.map((file) => file.content).join("\n");
  assert.deepEqual(
    generated.map((file) => file.name),
    ["PurchaseItem.generated.h", "PurchaseItem.generated.cpp"],
  );
  assert.match(combined, /FCrddPurchaseItemOperation/);
  assert.match(combined, /TArray<FCrddPurchaseItemPurchasesItem>/);
  assert.match(combined, /Result\.State\.Purchases\.Add\(\{Input\.Quantity, Input\.PriceJPY\}\)/);
  assert.doesNotMatch(combined, /CreateEntity/);
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
  invalid.operation.input.cost.unit = "USD";
  assert.ok(
    validateIr(invalid).some((diagnostic) => diagnostic.message.includes("incompatible units")),
  );
});

test("rejects append effects on non-array state", () => {
  const invalid = structuredClone(ir);
  invalid.operation.effects[0].target = "state.budget.remaining";
  assert.ok(
    validateIr(invalid).some((diagnostic) => diagnostic.message.includes("append requires an array target")),
  );
});

test("requires an explicit item schema for array state", () => {
  const invalid = structuredClone(ir) as unknown as {
    operation: { state: Record<string, Record<string, unknown>> };
  };
  delete invalid.operation.state.entities.items;
  assert.ok(
    validateIr(invalid).some(
      (diagnostic) => diagnostic.path.endsWith(".entities.items") && diagnostic.message.includes("object item schema"),
    ),
  );
});

test("rejects append values that do not match the array item schema", () => {
  const invalid = structuredClone(ir);
  if (invalid.operation.state.entities.type !== "array") return;
  invalid.operation.state.entities.items.properties.cost.unit = "USD";
  assert.ok(
    validateIr(invalid).some(
      (diagnostic) => diagnostic.path.endsWith(".value.cost") && diagnostic.message.includes('expected "USD"'),
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
