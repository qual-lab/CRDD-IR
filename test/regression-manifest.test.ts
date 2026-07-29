import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateRegressionManifest } from "../src/regression-manifest.ts";

const createSource = fileURLToPath(new URL(
  "../examples/create-entity/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
));
const updateSource = fileURLToPath(new URL(
  "../examples/update-entity/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
));

test("generates a deterministic multi-operation product regression manifest", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-regression-"));
  const first = await generateRegressionManifest(
    [updateSource, createSource],
    outDir,
  );
  const firstBytes = await readFile(join(outDir, "regression.manifest.json"), "utf8");
  const second = await generateRegressionManifest(
    [createSource, updateSource],
    outDir,
  );
  const secondBytes = await readFile(join(outDir, "regression.manifest.json"), "utf8");

  assert.equal(firstBytes, secondBytes);
  assert.deepEqual(
    first.manifest.operations.map((operation) => operation.id),
    ["CreateEntity", "UpdateEntity"],
  );
  assert.deepEqual(second.changes.map((change) => change.action), [
    "unchanged",
    "unchanged",
    "unchanged",
  ]);
  for (const operation of first.manifest.operations) {
    assert.equal(operation.adapterKey, operation.id);
    assert.equal(
      operation.conformance.cases,
      operation.conformance.successCases + operation.conformance.failureCases,
    );
    assert.ok(operation.conformance.failureCases > 0);
    const bundle = await readFile(join(outDir, operation.conformance.path));
    assert.equal(createHash("sha256").update(bundle).digest("hex"), operation.conformance.sha256);
    assert.match(operation.source.path, /^examples\//);
  }
});

test("refuses to overwrite a modified product regression bundle", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-regression-"));
  const generated = await generateRegressionManifest([createSource], outDir);
  const path = join(outDir, generated.manifest.operations[0].conformance.path);
  await writeFile(path, "product edit", "utf8");

  const dryRun = await generateRegressionManifest([createSource], outDir, {
    dryRun: true,
  });
  assert.ok(dryRun.changes.some((change) =>
    change.path === generated.manifest.operations[0].conformance.path &&
    change.action === "conflict"
  ));
  await assert.rejects(
    generateRegressionManifest([createSource], outDir),
    /Generated file conflict/,
  );
});

test("rejects duplicate operation ownership in a regression manifest", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-regression-"));
  await assert.rejects(
    generateRegressionManifest([createSource, createSource], outDir),
    /Duplicate regression operation ID/,
  );
});
