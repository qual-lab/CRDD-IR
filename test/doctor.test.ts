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
  await mkdir(join(root, "05_SPEC"), { recursive: true });
  await writeFile(join(root, "tools/CRDD-IR/src/cli.ts"), "");
  await writeFile(join(root, "tools/CRDD-IR/package.json"), '{"version":"0.1.0"}');
  await cp(
    fileURLToPath(new URL("../examples/place-wall/05_SPEC/01_Behavior_Specification.md", import.meta.url)),
    join(root, "05_SPEC/spec.md"),
  );
  const config = {
    protocol: "crdd-ir/project-config-v0.1",
    toolRoot: "tools/CRDD-IR",
    source: "05_SPEC/spec.md",
    generatedSource: "40_Develop/Generated/Source",
    generatedAssets: "40_Develop/Generated/Assets",
    evidence: "07_Quality/CRDD_IR",
    unreal: null,
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
  assert.ok(report.checks.some((check) => check.code === "CRDD_UNREAL_DISABLED"));
});

test("doctor rejects colliding output directories", async () => {
  const { configPath, config } = await fixture();
  config.generatedAssets = config.generatedSource;
  await writeFile(configPath, JSON.stringify(config));
  const report = await runDoctor(configPath);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.code === "CRDD_OUTPUT_COLLISION"));
});
