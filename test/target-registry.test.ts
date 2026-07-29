import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateBatch } from "../src/batch.ts";
import {
  describeTarget,
  getTargetAdapter,
  listTargetAdapters,
  registerTargetAdapter,
} from "../src/target-registry.ts";

test("built-in targets expose generation capabilities through one registry", () => {
  assert.deepEqual(
    listTargetAdapters().map((target) => target.id),
    ["assets", "ir", "typescript", "unity", "unreal"],
  );
  assert.deepEqual(describeTarget(getTargetAdapter("unity")), {
    id: "unity",
    description: "Unity C# contract, bridge, and NUnit conformance tests",
    profile: {
      required: true,
      schema: "schemas/unity-target-profile.schema.json",
    },
    capabilities: {
      generate: true,
      flatBatch: true,
    },
    extensions: {
      consumes: [],
    },
  });
  assert.deepEqual(describeTarget(getTargetAdapter("assets")).extensions, {
    consumes: ["crdd.3d-assets"],
  });
});

test("unknown target reports all registered alternatives", () => {
  assert.throws(
    () => getTargetAdapter("godot"),
    /Unsupported target: godot\. Available targets: assets, ir, typescript, unity, unreal/,
  );
});

test("a new target is added without changing CLI or batch dispatch", async () => {
  registerTargetAdapter({
    id: "test-target",
    description: "Test-only adapter",
    profileRequired: false,
    supportsFlatBatch: false,
    generate: ({ compilation }) => [{
      name: `${compilation.ir.operation.id}.txt`,
      content: compilation.digest,
    }],
  });
  assert.equal(getTargetAdapter("test-target").id, "test-target");
  const outDir = await mkdtemp(join(tmpdir(), "crdd-target-registry-"));
  const manifest = await generateBatch(
    ["examples/apply-record/contract.md"],
    outDir,
    "test-target",
  );
  assert.equal(manifest.target, "test-target");
  assert.equal(
    await readFile(join(outDir, "ApplyRecord", "ApplyRecord.txt"), "utf8"),
    manifest.operations[0].digest,
  );
});

test("CLI lists targets as machine-readable registry metadata", () => {
  const output = execFileSync(
    process.execPath,
    ["src/cli.ts", "target", "list"],
    { encoding: "utf8" },
  );
  const registry = JSON.parse(output);
  assert.equal(registry.protocol, "crdd-ir/target-registry-v0.1");
  assert.deepEqual(
    registry.targets.map((target: { id: string }) => target.id),
    ["assets", "ir", "typescript", "unity", "unreal"],
  );
});
