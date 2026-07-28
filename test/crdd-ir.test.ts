import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateIr } from "../src/ir.ts";
import { simulate } from "../src/simulator.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { generateUnreal } from "../src/unreal.ts";
import type { CrddIr } from "../src/model.ts";

const ir = JSON.parse(
  await readFile(new URL("../examples/place-wall/place-wall.ir.json", import.meta.url), "utf8"),
) as CrddIr;

function request(length: number, cost: number, remaining: number) {
  return {
    input: { length, cost },
    state: { budget: { remaining }, walls: [] },
  };
}

test("PlaceWall IR is valid", () => {
  assert.deepEqual(validateIr(ir), []);
});

test("accepts the exact 0.300m boundary and applies both effects", () => {
  const result = simulate(ir, request(0.3, 12_000, 50_000));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state, {
    budget: { remaining: 38_000 },
    walls: [{ length: 0.3, cost: 12_000 }],
  });
});

test("rejects 0.299m without changing state", () => {
  const initial = request(0.299, 12_000, 50_000);
  const result = simulate(ir, initial);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "WALL_TOO_SHORT");
  assert.deepEqual(result.state, initial.state);
  assert.deepEqual(initial.state, { budget: { remaining: 50_000 }, walls: [] });
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
  assert.ok(manifest.cases.some((entry) => entry.id === "minimum-wall-length-below-boundary"));
  assert.ok(manifest.cases.some((entry) => entry.id === "sufficient-budget-insufficient"));
  assert.ok(manifest.cases.some((entry) => entry.expect.stateUnchanged === true));
  const belowBoundary = manifest.cases.find((entry) => entry.id === "minimum-wall-length-below-boundary");
  assert.equal(belowBoundary?.arrange.input.length, 0.299);
});

test("Unreal skeleton carries CRDD trace IDs and extension points", () => {
  const generated = generateUnreal(ir);
  const combined = generated.map((file) => file.content).join("\n");
  assert.match(combined, /CRDD-TRACE: REQ-WALL-001/);
  assert.match(combined, /CRDD-EXTENSION-POINT/);
  assert.match(combined, /WALL_TOO_SHORT/);
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
