import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticEnvelope } from "../src/diagnostics.ts";
import { validateIr } from "../src/ir.ts";

test("emits stable machine-readable diagnostic codes", () => {
  const diagnostics = validateIr({ irVersion: "9", operation: null });
  assert.deepEqual(
    diagnostics.map(({ code, path }) => ({ code, path })),
    [
      { code: "CRDD_IR_VERSION", path: "$.irVersion" },
      { code: "CRDD_IR_TYPE", path: "$.operation" },
    ],
  );
  assert.equal(diagnosticEnvelope(diagnostics, "broken.json").protocol, "crdd-ir/diagnostics-v0.1");
});
