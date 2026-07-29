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

test("IR-TEST-003 doctor kills composite arithmetic boundary mutations", async () => {
  const { root, configPath } = await fixture();
  await cp(
    fileURLToPath(new URL("fixtures/contracts/numeric-boundary.md", import.meta.url)),
    join(root, "contracts/spec.md"),
  );
  const report = await runDoctor(configPath);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) =>
    check.code === "CRDD_MUTATIONS_KILLED" &&
    check.message.includes("killed all 12 deterministic mutants")
  ));
  assert.ok(!report.checks.some((check) => check.code === "CRDD_MUTATIONS_SURVIVED"));
});

test("IR-TEST-003 doctor reports an unsatisfiable composite boundary explicitly", async () => {
  const { root, configPath } = await fixture();
  await writeFile(join(root, "contracts/spec.md"), `# Composite boundary

\`\`\`crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: CompositeBoundary
  kind: query
  traces: [IR-TEST-003]
  input:
    a: { type: number, unit: mm, minimum: 0, maximum: 2 }
    b: { type: number, unit: mm, minimum: 0, maximum: 2 }
    c: { type: number, unit: mm, minimum: 10, maximum: 10 }
  state: {}
  requires:
    - { id: opening-fits, condition: input.a + input.b <= input.c, error: OUTSIDE }
  effects: []
  errors:
    - { code: OUTSIDE, traces: [IR-TEST-003] }
\`\`\`
`);
  const report = await runDoctor(configPath);
  assert.equal(report.ok, false);
  const diagnostic = report.checks.find((check) =>
    check.code === "CRDD_BOUNDARY_CASE_UNSATISFIABLE"
  );
  assert.ok(diagnostic, JSON.stringify(report.checks, null, 2));
  assert.match(diagnostic.message, /requirement="opening-fits"/);
  assert.match(diagnostic.message, /expression="input\.a \+ input\.b <= input\.c"/);
  assert.match(diagnostic.message, /classification=unsatisfiable/);
  assert.match(diagnostic.message, /schema:/);
});
