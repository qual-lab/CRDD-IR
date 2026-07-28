import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { createUnrealBuildEvidence } from "../src/unreal-build-evidence.ts";
import { buildUnrealTargetPlan } from "../src/unreal-target.ts";
import type { UnrealExecutionEvidence } from "../src/unreal-report.ts";

const source = fileURLToPath(new URL(
  "../examples/create-entity/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
));

test("normalizes Shipping Build, Cook, Package, and Automation evidence", async () => {
  const compilation = await compileMarkdown(source);
  const plan = buildUnrealTargetPlan(compilation.ir, compilation.digest, {
    engine: { major: 5, minor: 8, patch: 0, dialect: "ue-5.8" },
    platform: "Win64",
    targetType: "Game",
    configuration: "Shipping",
    linkType: "monolithic",
    withEditor: false,
    buildId: "excluded-from-identity",
  });
  const packageDir = await mkdtemp(join(tmpdir(), "crdd-package-"));
  await writeFile(join(packageDir, "game.pak"), "deterministic", "utf8");
  const execution: UnrealExecutionEvidence = {
    protocol: "crdd-ir/unreal-execution-v0.1",
    operation: compilation.ir.operation.id,
    reportCreatedOn: "host-specific-time",
    sourceReportSha256: "a".repeat(64),
    platforms: ["WindowsEditor"],
    summary: { succeeded: 1, failed: 0, notRun: 0 },
    tests: [{
      path: "CRDD.Operation.Conformance",
      state: "Success",
      durationSeconds: 123.45,
      warnings: 0,
      errors: 0,
    }],
  };
  const first = await createUnrealBuildEvidence(plan, execution, packageDir);
  const second = await createUnrealBuildEvidence(plan, {
    ...execution,
    reportCreatedOn: "different-time",
    tests: [{ ...execution.tests[0], durationSeconds: 0.01 }],
  }, packageDir);
  assert.equal(first.hashes.identitySha256, second.hashes.identitySha256);
  assert.equal(first.stages.package, "passed");
  assert.equal(first.stages.cook, "passed");
  assert.equal(first.packageFiles.length, 1);
  assert.doesNotMatch(JSON.stringify(first), /host-specific-time|123\.45/);
});
