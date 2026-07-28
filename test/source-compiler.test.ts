import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { normalizeSourceExpression, parseSourceExpression } from "../src/source-expression.ts";
import { extractContractFences } from "../src/source-contract.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import type { CrddIr, FieldDefinition } from "../src/model.ts";

const sourcePath = new URL(
  "../examples/place-wall/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
);

test("extracts only explicitly tagged CRDD contract fences", () => {
  const markdown = [
    "```yaml",
    "ignored: true",
    "```",
    "```crdd-contract",
    "schema: crdd-source-contract/v0.1",
    "```",
  ].join("\n");
  const fences = extractContractFences(markdown);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].startLine, 5);
  assert.match(fences[0].content, /crdd-source-contract/);
});

test("rejects an unterminated CRDD contract fence with a source line", () => {
  assert.throws(
    () => extractContractFences("before\n```crdd-contract\nschema: bad", "spec.md"),
    /spec\.md:2: unterminated/,
  );
});

test("parses the allowed expression language without eval", () => {
  const ast = parseSourceExpression(
    "input.length >= 0.3m && state.budget.remaining >= input.cost",
  );
  assert.equal(ast.kind, "binary");
  if (ast.kind === "binary") assert.equal(ast.operator, "&&");
});

test("normalizes compatible unit literals", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.length": { type: "number", unit: "m" },
  };
  assert.equal(normalizeSourceExpression("input.length >= 300mm", fields), "input.length >= 0.3");
  assert.equal(normalizeSourceExpression("input.length >= 30cm", fields), "input.length >= 0.3");
});

test("rejects incompatible units", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.length": { type: "number", unit: "m" },
  };
  assert.throws(
    () => normalizeSourceExpression("input.length >= 100JPY", fields),
    /incompatible units "m" and "JPY"/,
  );
});

test("compiles CRDD Markdown into the existing Internal IR", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const expected = JSON.parse(
    await readFile(new URL("../examples/place-wall/place-wall.ir.json", import.meta.url), "utf8"),
  ) as CrddIr;
  assert.deepEqual(compiled.ir, expected);
  assert.match(compiled.digest, /^[a-f0-9]{64}$/);
  assert.ok(compiled.sourceMap.contractStartLine > 1);
});

test("produces byte-identical IR and digest from the same CRDD source", async () => {
  const first = await compileMarkdown(fileURLToPath(sourcePath));
  const second = await compileMarkdown(fileURLToPath(sourcePath));
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.digest, second.digest);
});

test("produces the same conformance semantics from Markdown and legacy IR", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const legacy = JSON.parse(
    await readFile(new URL("../examples/place-wall/place-wall.ir.json", import.meta.url), "utf8"),
  ) as CrddIr;
  assert.deepEqual(
    generateConformanceBundle(compiled.ir, generateTestManifest(compiled.ir)),
    generateConformanceBundle(legacy, generateTestManifest(legacy)),
  );
});
