import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { generateBatch } from "../src/batch.ts";

const source = fileURLToPath(
  new URL("../examples/apply-record/contract.md", import.meta.url),
);
const secondSource = fileURLToPath(
  new URL("../examples/revise-record/contract.md", import.meta.url),
);

test("generates an operation-scoped deterministic batch", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  const manifest = await generateBatch([source], outDir, "unreal");
  assert.equal(manifest.layout, "operation-directories");
  assert.equal(manifest.operations[0].id, "ApplyRecord");
  assert.deepEqual(
    manifest.operations[0].files.map((file) => file.path),
    [
      "ApplyRecord.bridge.generated.cpp",
      "ApplyRecord.bridge.generated.h",
      "ApplyRecord.bridge.generated.spec.cpp",
      "ApplyRecord.generated.cpp",
      "ApplyRecord.generated.h",
    ],
  );
  assert.ok(manifest.operations[0].files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  const persisted = JSON.parse(await readFile(join(outDir, "batch.manifest.json"), "utf8"));
  assert.deepEqual(persisted, manifest);
});

test("generates multiple Unreal operations into one collision-safe directory", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-flat-"));
  const manifest = await generateBatch([secondSource, source], outDir, "unreal", {
    layout: "flat",
  });
  assert.equal(manifest.layout, "flat");
  assert.deepEqual(manifest.operations.map((operation) => operation.id), [
    "ApplyRecord",
    "ReviseRecord",
  ]);
  assert.ok(manifest.operations.every((operation) => operation.outputDirectory === "."));
  assert.deepEqual(
    (await readdir(outDir)).sort(),
    [
      "ApplyRecord.bridge.generated.cpp",
      "ApplyRecord.bridge.generated.h",
      "ApplyRecord.bridge.generated.spec.cpp",
      "ApplyRecord.generated.cpp",
      "ApplyRecord.generated.h",
      "ReviseRecord.bridge.generated.cpp",
      "ReviseRecord.bridge.generated.h",
      "ReviseRecord.bridge.generated.spec.cpp",
      "ReviseRecord.generated.cpp",
      "ReviseRecord.generated.h",
      "batch.manifest.json",
    ],
  );
});

test("rejects case-insensitive generated filename collisions before writing", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-collision-"));
  const sourceDir = await mkdtemp(join(tmpdir(), "crdd-batch-source-"));
  const contract = await readFile(source, "utf8");
  const upper = join(sourceDir, "upper.md");
  const lower = join(sourceDir, "lower.md");
  await writeFile(upper, contract.replace("id: ApplyRecord", "id: Record"), "utf8");
  await writeFile(lower, contract.replace("id: ApplyRecord", "id: record"), "utf8");
  await assert.rejects(
    generateBatch([upper, lower], outDir, "unreal", { layout: "flat" }),
    /Generated file collision\(s\)/,
  );
  assert.deepEqual(await readdir(outDir), []);
});

test("reuses verified outputs and recovers a corrupt batch manifest", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  const first = await generateBatch([source], outDir, "ir");
  const output = join(outDir, "ApplyRecord", first.operations[0].files[0].path);
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

test("reuses batch outputs after a Windows CRLF checkout", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-crlf-"));
  await generateBatch([source], outDir, "unreal");
  const output = join(outDir, "ApplyRecord", "ApplyRecord.generated.h");
  const lf = await readFile(output, "utf8");
  await writeFile(output, lf.replace(/\n/g, "\r\n"), "utf8");

  const manifest = await generateBatch([source], outDir, "unreal");
  assert.equal(manifest.operations[0].id, "ApplyRecord");
  assert.equal(await readFile(output, "utf8"), lf.replace(/\n/g, "\r\n"));
});

test("refuses to overwrite modified owned batch output unless forced", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-owned-"));
  const manifest = await generateBatch([source], outDir, "unreal", { layout: "flat" });
  const output = join(outDir, manifest.operations[0].files[0].path);
  await writeFile(output, "user edit", "utf8");
  await assert.rejects(
    generateBatch([source], outDir, "unreal", { layout: "flat" }),
    /Refusing to overwrite modified batch output/,
  );
  assert.equal(await readFile(output, "utf8"), "user edit");
  await generateBatch([source], outDir, "unreal", { layout: "flat", force: true });
  assert.notEqual(await readFile(output, "utf8"), "user edit");
});

test("invalidates a verified cache entry when generated content changes", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-generator-change-"));
  const manifest = await generateBatch([source], outDir, "unreal", { layout: "flat" });
  const file = manifest.operations[0].files[0];
  const output = join(outDir, file.path);
  const stale = "// output from an older generator\n";
  await writeFile(output, stale, "utf8");
  file.sha256 = createHash("sha256").update(stale).digest("hex");
  await writeFile(
    join(outDir, "batch.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await generateBatch([source], outDir, "unreal", { layout: "flat" });
  assert.notEqual(await readFile(output, "utf8"), stale);
});

test("owns generated numeric boundary fixtures in the batch manifest", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-numeric-"));
  const numericSource = fileURLToPath(new URL("./fixtures/contracts/numeric-boundary.md", import.meta.url));
  const profile = JSON.parse(await readFile(
    fileURLToPath(new URL("../examples/unreal/profiles/ue-5.8-editor.json", import.meta.url)),
    "utf8",
  ));
  const manifest = await generateBatch([numericSource], outDir, "unreal", {
    layout: "flat",
    profile,
  });
  assert.ok(manifest.operations[0].files.some((file) =>
    file.path === "AppendRecord.numeric.generated.spec.cpp" &&
    /^[a-f0-9]{64}$/.test(file.sha256)
  ));
  assert.match(
    await readFile(join(outDir, "AppendRecord.numeric.generated.spec.cpp"), "utf8"),
    /Generated by crdd-ir\. Do not edit\./,
  );
});

test("rejects duplicate operation IDs before writing outputs", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-batch-"));
  await assert.rejects(
    generateBatch([source, source], outDir, "ir"),
    /Duplicate operation ID\(s\) in batch: ApplyRecord/,
  );
});
