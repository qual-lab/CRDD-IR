import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { DiagnosticError, diagnosticEnvelope } from "../src/diagnostics.ts";
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

test("collects multiple source diagnostics with Markdown locations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crdd-diagnostics-"));
  const path = join(directory, "spec.md");
  await writeFile(path, [
    "# Invalid",
    "",
    "```crdd-contract",
    "schema: wrong",
    "unexpected: true",
    "operation:",
    "  id: ''",
    "  traces: []",
    "  input: {}",
    "  state: {}",
    "  requires: []",
    "  effects: []",
    "  errors: []",
    "  transaction:",
    "    atomic: yes",
    "```",
  ].join("\n"));
  try {
    await compileMarkdown(path);
    assert.fail("Expected source diagnostics");
  } catch (error) {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.length >= 6);
    assert.ok(error.diagnostics.some((item) => item.code === "CRDD_SOURCE_UNKNOWN_FIELD"));
    assert.ok(error.diagnostics.every((item) => (item.location?.line ?? 0) >= 4));
  }
});
