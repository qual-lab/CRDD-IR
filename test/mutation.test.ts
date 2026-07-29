import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { analyzeMutationCoverage } from "../src/mutation.ts";
import { generateTestManifest } from "../src/test-manifest.ts";

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
