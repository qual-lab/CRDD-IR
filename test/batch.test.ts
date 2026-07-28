import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { generateBatch } from "../src/batch.ts";

const source = fileURLToPath(
  new URL("../examples/create-entity/05_SPEC/01_Behavior_Specification.md", import.meta.url),
);

test("generates an operation-scoped deterministic batch", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  const manifest = await generateBatch([source], outDir, "unreal");
  assert.equal(manifest.operations[0].id, "CreateEntity");
  assert.deepEqual(
    manifest.operations[0].files.map((file) => file.path),
    ["CreateEntity.generated.cpp", "CreateEntity.generated.h"],
  );
  assert.ok(manifest.operations[0].files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  const persisted = JSON.parse(await readFile(join(outDir, "batch.manifest.json"), "utf8"));
  assert.deepEqual(persisted, manifest);
});

test("reuses verified outputs and recovers a corrupt batch manifest", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  const first = await generateBatch([source], outDir, "ir");
  const output = join(outDir, "CreateEntity", first.operations[0].files[0].path);
  const before = await stat(output);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await generateBatch([source], outDir, "ir");
  assert.equal(before.mtimeMs, (await stat(output)).mtimeMs);

  await writeFile(join(outDir, "batch.manifest.json"), "{broken");
  await generateBatch([source], outDir, "ir");
  const recovered = (await readdir(outDir))
    .some((name) => name.startsWith("batch.manifest.json.corrupt."));
  assert.equal(recovered, true);
});

test("rejects duplicate operation IDs before writing outputs", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  await assert.rejects(
    generateBatch([source, source], outDir, "ir"),
    /Duplicate operation ID\(s\) in batch: CreateEntity/,
  );
});
