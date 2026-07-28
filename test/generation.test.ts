import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateTransactionally } from "../src/generation.ts";

function generated(name: string, content: string) {
  return { name, content, sha256: createHash("sha256").update(content).digest("hex") };
}

test("plans and applies generated files transactionally", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-generation-"));
  const files = [generated("Example.generated.h", "v1")];
  assert.deepEqual(
    (await generateTransactionally({ outDir, files, dryRun: true })).map((item) => item.action),
    ["create"],
  );
  await generateTransactionally({ outDir, files });
  assert.equal(await readFile(join(outDir, "Example.generated.h"), "utf8"), "v1");
  assert.deepEqual(
    (await generateTransactionally({ outDir, files, dryRun: true })).map((item) => item.action),
    ["unchanged"],
  );
  await generateTransactionally({ outDir, files: [generated("Example.generated.h", "v2")] });
  assert.equal(await readFile(join(outDir, "Example.generated.h"), "utf8"), "v2");
});

test("refuses to overwrite edited generated files", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-generation-"));
  await generateTransactionally({ outDir, files: [generated("Example.generated.h", "v1")] });
  await writeFile(join(outDir, "Example.generated.h"), "user edit");
  const plan = await generateTransactionally({
    outDir,
    files: [generated("Example.generated.h", "v2")],
    dryRun: true,
  });
  assert.equal(plan[0].action, "conflict");
  await assert.rejects(
    generateTransactionally({ outDir, files: [generated("Example.generated.h", "v2")] }),
    /Generated file conflict/,
  );
  assert.equal(await readFile(join(outDir, "Example.generated.h"), "utf8"), "user edit");
});

test("deletes only files owned by the previous generation", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-generation-"));
  await generateTransactionally({
    outDir,
    files: [generated("Old.generated.h", "old"), generated("Keep.generated.h", "keep")],
  });
  await writeFile(join(outDir, "hand-authored.txt"), "keep");
  const plan = await generateTransactionally({
    outDir,
    files: [generated("Keep.generated.h", "keep")],
  });
  assert.ok(plan.some((item) => item.path === "Old.generated.h" && item.action === "delete"));
  assert.equal(await readFile(join(outDir, "hand-authored.txt"), "utf8"), "keep");
});
