import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { adoptProjectConfig } from "../src/adopt-config.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "crdd-adopt-"));
  await mkdir(join(root, "tools/CRDD-IR/src"), { recursive: true });
  await mkdir(join(root, "contracts"), { recursive: true });
  await writeFile(join(root, "tools/CRDD-IR/src/cli.ts"), "");
  await writeFile(join(root, "tools/CRDD-IR/package.json"), '{"version":"0.6.0"}');
  await cp(fileURLToPath(new URL("fixtures/contracts/conditional-effects.md", import.meta.url)),
    join(root, "contracts/operation.md"));
  const wrapper = "wrapper-content\n";
  await mkdir(join(root, "tools"), { recursive: true });
  await writeFile(join(root, "tools/crdd-ir.ps1"), wrapper);
  const original = JSON.stringify({
    protocol: "crdd-ir/project-config-v0.2",
    toolRoot: "tools/CRDD-IR",
    sources: ["contracts/operation.md"],
    evidence: "evidence/crdd-ir",
    targets: { ir: { output: "generated/ir" } },
  }, null, 2) + "\n";
  const configPath = join(root, "crdd-ir.config.json");
  await writeFile(configPath, original);
  const manifestPath = join(root, ".crdd-ir.install.json");
  await writeFile(manifestPath, JSON.stringify({
    protocol: "crdd-ir/install-manifest-v0.2",
    toolVersion: "0.6.0",
    files: [
      { path: "crdd-ir.config.json", kind: "file", sha256: sha(original) },
      { path: "tools/crdd-ir.ps1", kind: "file", sha256: sha(wrapper) },
    ],
  }, null, 2) + "\n");
  return { root, configPath, manifestPath, wrapper };
}

test("adopt-config updates only the reviewed config hash with audit values", async () => {
  const { configPath, manifestPath, root, wrapper } = await fixture();
  const changed = (await readFile(configPath, "utf8")).replace(
    '"sources": [\n    "contracts/operation.md"\n  ]',
    '"sources": [\n    "contracts/operation.md",\n    "contracts/second.md"\n  ]',
  );
  await writeFile(
    join(root, "contracts/second.md"),
    (await readFile(join(root, "contracts/operation.md"), "utf8")).replace("ResolveDecision", "ResolveAlternate"),
  );
  await writeFile(configPath, changed);
  const before = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = await adoptProjectConfig(configPath);
  const after = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(result.oldSha256, before.files[0].sha256);
  assert.equal(result.newSha256, sha(changed));
  assert.equal(result.adopted, true);
  assert.equal(after.files[0].sha256, sha(changed));
  assert.deepEqual(after.files[1], before.files[1]);
  assert.equal(await readFile(join(root, "tools/crdd-ir.ps1"), "utf8"), wrapper);
});

test("adopt-config dry run reports hashes without modifying the manifest", async () => {
  const { configPath, manifestPath } = await fixture();
  await writeFile(configPath, (await readFile(configPath, "utf8")).replace("generated/ir", "generated/new-ir"));
  const before = await readFile(manifestPath, "utf8");
  const result = await adoptProjectConfig(configPath, { dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(result.adopted, false);
  assert.equal(await readFile(manifestPath, "utf8"), before);
});

test("adopt-config rejects unsafe output overlap without changing ownership", async () => {
  const { configPath, manifestPath } = await fixture();
  const unsafe = (await readFile(configPath, "utf8")).replace("generated/ir", "contracts");
  await writeFile(configPath, unsafe);
  const before = await readFile(manifestPath, "utf8");
  await assert.rejects(() => adoptProjectConfig(configPath), /CRDD_OUTPUT_OVERLAP/);
  assert.equal(await readFile(manifestPath, "utf8"), before);
});
