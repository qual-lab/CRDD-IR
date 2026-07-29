import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { analyzeMutationCoverage } from "../src/mutation.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { evaluateExpression } from "../src/expression.ts";
import type { CrddIr } from "../src/model.ts";

const source = fileURLToPath(
  new URL("../examples/apply-record/contract.md", import.meta.url),
);

test("conformance cases kill requirement, boundary, and effect mutants", async () => {
  const ir = (await compileMarkdown(source)).ir;
  const report = analyzeMutationCoverage(ir, generateTestManifest(ir));
  assert.ok(report.total >= 5);
  assert.equal(report.killed, report.total);
  assert.deepEqual(report.survived, []);
  assert.equal(report.score, 100);
});

test("IR-TEST-003 kills all inclusive and strict composite arithmetic boundary mutants", () => {
  for (const operator of ["<=", "<", ">=", ">"] as const) {
    const ir = arithmeticIr(`input.a + input.b ${operator} input.c`);
    const first = generateTestManifest(ir);
    const second = generateTestManifest(ir);
    assert.deepEqual(second, first, `${operator} generation must be deterministic`);

    const boundary = first.cases.find((item) => item.id === "composite-boundary-at-boundary");
    const inside = first.cases.find((item) => item.id === "composite-boundary-inside-boundary");
    const outside = first.cases.find((item) => item.id === "composite-boundary-outside-boundary");
    assert.ok(boundary, `${operator} equality case`);
    assert.ok(inside, `${operator} inside case`);
    assert.ok(outside, `${operator} outside case`);

    const difference = (request: typeof boundary.arrange) =>
      Number(request.input.a) + Number(request.input.b) - Number(request.input.c);
    assert.equal(difference(boundary.arrange), 0);
    assert.equal(
      evaluateExpression(ir.operation.requires[0].expression, inside.arrange),
      true,
    );
    assert.equal(
      evaluateExpression(ir.operation.requires[0].expression, outside.arrange),
      false,
    );

    const report = analyzeMutationCoverage(ir, first);
    assert.deepEqual(report.survived, [], `${operator} boundary mutant must be killed`);
  }
});

test("IR-TEST-003 supports subtraction and uses one integer unit outside the boundary", () => {
  const ir = arithmeticIr("input.a - input.b <= input.c", "integer");
  const manifest = generateTestManifest(ir);
  const boundary = manifest.cases.find((item) => item.id === "composite-boundary-at-boundary")!;
  const outside = manifest.cases.find((item) => item.id === "composite-boundary-outside-boundary")!;
  const difference = (request: typeof boundary.arrange) =>
    Number(request.input.a) - Number(request.input.b) - Number(request.input.c);
  assert.equal(difference(boundary.arrange), 0);
  assert.equal(difference(outside.arrange), 1);
  assert.deepEqual(analyzeMutationCoverage(ir, manifest).survived, []);
});

test("IR-TEST-003 reports an unsatisfiable boundary with requirement, expression, and conflicts", () => {
  const ir = arithmeticIr("input.a + input.b <= input.c");
  ir.operation.input.a = { type: "number", minimum: 0, maximum: 2 };
  ir.operation.input.b = { type: "number", minimum: 0, maximum: 2 };
  ir.operation.input.c = { type: "number", minimum: 10, maximum: 10 };
  assert.throws(
    () => generateTestManifest(ir),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /requirement="composite-boundary"/);
      assert.match(error.message, /expression="input\.a \+ input\.b <= input\.c"/);
      assert.match(error.message, /classification=unsatisfiable/);
      assert.match(error.message, /schema:/);
      return true;
    },
  );
});

function arithmeticIr(
  expression: string,
  type: "number" | "integer" = "number",
): CrddIr {
  return {
    irVersion: "0.1",
    operation: {
      id: "CompositeArithmetic",
      kind: "command",
      traces: ["IR-TEST-003"],
      input: {
        a: { type, unit: "mm", minimum: 0, maximum: 100 },
        b: { type, unit: "mm", minimum: 0, maximum: 100 },
        c: { type, unit: "mm", minimum: 0, maximum: 100 },
      },
      state: {},
      requires: [{
        id: "composite-boundary",
        expression,
        error: "OUTSIDE_BOUNDARY",
      }],
      effects: [],
      errors: [{ code: "OUTSIDE_BOUNDARY", traces: ["IR-TEST-003"] }],
    },
  };
}
