import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runDoctor } from "../src/doctor.ts";

async function fixture(): Promise<{ root: string; configPath: string; config: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), "crdd-doctor-"));
  await mkdir(join(root, "tools/CRDD-IR/src"), { recursive: true });
  await mkdir(join(root, "contracts"), { recursive: true });
  await writeFile(join(root, "tools/CRDD-IR/src/cli.ts"), "");
  await writeFile(join(root, "tools/CRDD-IR/package.json"), '{"version":"0.1.0"}');
  await cp(
    fileURLToPath(new URL("../examples/apply-record/contract.md", import.meta.url)),
    join(root, "contracts/spec.md"),
  );
  const config = {
    protocol: "crdd-ir/project-config-v0.2",
    toolRoot: "tools/CRDD-IR",
    sources: ["contracts/spec.md"],
    evidence: "evidence/crdd-ir",
    targets: {
      ir: { output: "generated/ir" },
    },
  };
  const configPath = join(root, "crdd-ir.config.json");
  await writeFile(configPath, JSON.stringify(config));
  return { root, configPath, config };
}

test("doctor preflights a project before generation", async () => {
  const { configPath } = await fixture();
  const report = await runDoctor(configPath);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) => check.code === "CRDD_SOURCE_COMPILES"));
  assert.ok(report.checks.some((check) => check.code === "CRDD_GENERATED_NAMES_UNIQUE"));
});

test("doctor rejects colliding output directories", async () => {
  const { configPath, config } = await fixture();
  config.targets = {
    ir: { output: "evidence/crdd-ir" },
  };
  await writeFile(configPath, JSON.stringify(config));
  const report = await runDoctor(configPath);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.code === "CRDD_OUTPUT_COLLISION"));
});
