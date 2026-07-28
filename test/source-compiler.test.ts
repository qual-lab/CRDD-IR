import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { generateAssets, removeStaleGeneratedAssets } from "../src/assets.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { normalizeSourceExpression, parseSourceExpression } from "../src/source-expression.ts";
import { extractContractFences } from "../src/source-contract.ts";
import { analyzeTestCoverage, generateTestManifest } from "../src/test-manifest.ts";
import { simulate } from "../src/simulator.ts";
import {
  generateEvidenceMarkdown,
  generateTraceabilityManifest,
} from "../src/traceability.ts";
import { generateUnreal } from "../src/unreal.ts";
import { parseUnrealAutomationReport } from "../src/unreal-report.ts";
import type { CrddIr, FieldDefinition } from "../src/model.ts";

const sourcePath = new URL(
  "../examples/place-wall/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
);

test("extracts only explicitly tagged CRDD contract fences", () => {
  const markdown = [
    "```yaml",
    "ignored: true",
    "```",
    "```crdd-contract",
    "schema: crdd-source-contract/v0.1",
    "```",
  ].join("\n");
  const fences = extractContractFences(markdown);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].startLine, 5);
  assert.match(fences[0].content, /crdd-source-contract/);
});

test("rejects an unterminated CRDD contract fence with a source line", () => {
  assert.throws(
    () => extractContractFences("before\n```crdd-contract\nschema: bad", "spec.md"),
    /spec\.md:2: unterminated/,
  );
});

test("parses the allowed expression language without eval", () => {
  const ast = parseSourceExpression(
    "input.length >= 0.3m && state.budget.remaining >= input.cost",
  );
  assert.equal(ast.kind, "binary");
  if (ast.kind === "binary") assert.equal(ast.operator, "&&");
});

test("normalizes compatible unit literals", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.length": { type: "number", unit: "m" },
  };
  assert.equal(normalizeSourceExpression("input.length >= 300mm", fields), "input.length >= 0.3");
  assert.equal(normalizeSourceExpression("input.length >= 30cm", fields), "input.length >= 0.3");
});

test("supports string and boolean literals in deterministic expressions", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.label": { type: "string" },
    "input.enabled": { type: "boolean" },
  };
  assert.equal(
    normalizeSourceExpression('input.label == "wall" && input.enabled == true', fields),
    'input.label == "wall" && input.enabled == true',
  );
});

test("rejects incompatible units", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.length": { type: "number", unit: "m" },
  };
  assert.throws(
    () => normalizeSourceExpression("input.length >= 100JPY", fields),
    /incompatible units "m" and "JPY"/,
  );
});

test("compiles CRDD Markdown into the existing Internal IR", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const expected = JSON.parse(
    await readFile(new URL("../examples/place-wall/place-wall.ir.json", import.meta.url), "utf8"),
  ) as CrddIr;
  assert.deepEqual(compiled.ir, expected);
  assert.match(compiled.digest, /^[a-f0-9]{64}$/);
  assert.ok(compiled.sourceMap.contractStartLine > 1);
});

test("produces byte-identical IR and digest from the same CRDD source", async () => {
  const first = await compileMarkdown(fileURLToPath(sourcePath));
  const second = await compileMarkdown(fileURLToPath(sourcePath));
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.digest, second.digest);
});

test("produces the same conformance semantics from Markdown and legacy IR", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const legacy = JSON.parse(
    await readFile(new URL("../examples/place-wall/place-wall.ir.json", import.meta.url), "utf8"),
  ) as CrddIr;
  assert.deepEqual(
    generateConformanceBundle(compiled.ir, generateTestManifest(compiled.ir)),
    generateConformanceBundle(legacy, generateTestManifest(legacy)),
  );
});

test("produces byte-identical Unreal C++ from the same CRDD source", async () => {
  const first = generateUnreal((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const second = generateUnreal((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  assert.deepEqual(first, second);
  assert.ok(first.some((file) => file.content.includes("Result.State.Walls.Add")));
});

test("generates Unreal append values for references and typed literals", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const walls = ir.operation.state.walls;
  assert.equal(walls.type, "array");
  if (walls.type !== "array") return;
  walls.items.properties.label = { type: "string" };
  walls.items.properties.enabled = { type: "boolean" };
  ir.operation.effects[0] = {
    target: "state.walls",
    action: "append",
    value: {
      length: "$input.length",
      cost: "$input.cost",
      label: "generated",
      enabled: true,
    },
  };
  const source = generateUnreal(ir).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(source, /TEXT\("generated"\), true/);
});

test("validates and generates numeric increment effects end to end", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  ir.operation.effects = [{
    target: "state.budget.remaining",
    action: "increment",
    expression: "-input.cost",
  }];
  const result = simulate(ir, {
    input: { length: 1, cost: 100 },
    state: { walls: [], budget: { remaining: 1_000 } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { walls: [], budget: { remaining: 900 } });
  const source = generateUnreal(ir).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(source, /Result\.State\.BudgetRemainingJPY \+= -Input\.CostJPY/);
});

test("derives deterministic counterexamples for non-boundary requirements", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  ir.operation.input.enabled = { type: "boolean" };
  ir.operation.requires = [{
    id: "must-be-enabled",
    expression: "input.enabled == true",
    error: "WALL_TOO_SHORT",
  }];
  const manifest = generateTestManifest(ir);
  const counterexample = manifest.cases.find((item) => item.sourceRequirement === "must-be-enabled");
  assert.equal(counterexample?.arrange.input.enabled, false);
  assert.deepEqual(analyzeTestCoverage(ir, manifest), {
    requirements: 1,
    covered: 1,
    uncovered: [],
  });
});

test("produces deterministic traceability evidence from CRDD source", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const tests = generateTestManifest(compiled.ir);
  const bundle = generateConformanceBundle(compiled.ir, tests);
  const unreal = generateUnreal(compiled.ir);
  const first = generateTraceabilityManifest(
    compiled.ir,
    "05_SPEC/01_Behavior_Specification.md",
    compiled.digest,
    unreal,
    tests,
    bundle,
  );
  const second = generateTraceabilityManifest(
    compiled.ir,
    "05_SPEC/01_Behavior_Specification.md",
    compiled.digest,
    unreal,
    tests,
    bundle,
  );

  assert.deepEqual(first, second);
  assert.match(first.source.irSha256, /^[a-f0-9]{64}$/);
  assert.ok(first.generatedFiles.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(
    first.requirements.find((requirement) => requirement.id === "minimum-wall-length")?.traces,
    ["REQ-WALL-001"],
  );
  assert.match(generateEvidenceMarkdown(first), /REQ-WALL-001/);
  assert.doesNotMatch(generateEvidenceMarkdown(first), /Generated at|timestamp/i);
});

test("normalizes Unreal Automation results without device identity", async () => {
  const raw = JSON.stringify({
    devices: [
      {
        deviceName: "developer-machine",
        instance: "private-instance-id",
        platform: "WindowsEditor",
      },
    ],
    reportCreatedOn: "2026.07.28-09.23.02",
    tests: [
      {
        fullTestPath: "CRDD.PlaceWall.Conformance",
        state: "Success",
        duration: 0.016,
        warnings: 0,
        errors: 0,
      },
      {
        fullTestPath: "CRDD.Assets.WallPreview",
        state: "Success",
        duration: 0.02,
        warnings: 0,
        errors: 0,
      },
      {
        fullTestPath: "CRDD.Integration.GeneratedAssets",
        state: "Success",
        duration: 0.03,
        warnings: 0,
        errors: 0,
      },
    ],
  });
  const execution = parseUnrealAutomationReport(`\uFEFF${raw}`, "PlaceWall");
  assert.deepEqual(execution.summary, { succeeded: 3, failed: 0, notRun: 0 });
  assert.deepEqual(execution.platforms, ["WindowsEditor"]);
  assert.doesNotMatch(JSON.stringify(execution), /developer-machine|private-instance-id/);

  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const tests = generateTestManifest(compiled.ir);
  const bundle = generateConformanceBundle(compiled.ir, tests);
  const traceability = generateTraceabilityManifest(
    compiled.ir,
    "05_SPEC/01_Behavior_Specification.md",
    compiled.digest,
    generateUnreal(compiled.ir),
    tests,
    bundle,
    execution,
    generateAssets(compiled.ir),
  );
  assert.equal(traceability.execution?.status, "passed");
  assert.equal(
    traceability.execution?.sha256,
    createHash("sha256").update(`${JSON.stringify(execution, null, 2)}\n`).digest("hex"),
  );
  assert.match(generateEvidenceMarkdown(traceability), /Unreal Execution[\s\S]*PASSED/);
  assert.ok(
    traceability.generatedFiles.some((file) => file.path === "assets/WallPreview.generated.obj"),
  );
});

test("generates deterministic Unreal-scale 3D assets from CRDD", async () => {
  const ir = (await compileMarkdown(fileURLToPath(sourcePath))).ir;
  const first = generateAssets(ir);
  const second = generateAssets(ir);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((file) => file.name),
    [
      "WallPreview.generated.obj",
      "WallPreview.generated.mtl",
      "DoorPreview.generated.obj",
      "DoorPreview.generated.mtl",
      "assets.manifest.json",
    ],
  );
  const obj = first.find((file) => file.name.endsWith(".obj"))?.content ?? "";
  assert.match(obj, /Units: centimeters/);
  assert.match(obj, /v -50 -10 0/);
  assert.match(obj, /v 50 10 240/);
  assert.match(obj, /vt 1 1/);
  assert.match(obj, /f 1\/1 4\/4 3\/3 2\/2/);
  assert.match(obj, /CRDD-TRACE: REQ-WALL-001/);
  const manifest = JSON.parse(
    first.find((file) => file.name === "assets.manifest.json")?.content ?? "",
  );
  assert.deepEqual(manifest, {
    protocol: "crdd-ir/assets-v0.1",
    operation: "PlaceWall",
    scene: {
      unrealLevel: "/Game/CRDD/Generated/PlaceWallScene",
    },
    assets: [
      {
        id: "WallPreview",
        source: "WallPreview.generated.obj",
        unrealDestination: "/Game/CRDD/Generated",
        previewLevel: "/Game/CRDD/Generated/WallPreviewLevel",
        dimensionsCm: { length: 100, width: 20, height: 240 },
        placement: {
          locationCm: { x: 0, y: 0, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
        traces: ["REQ-WALL-001"],
      },
      {
        id: "DoorPreview",
        source: "DoorPreview.generated.obj",
        unrealDestination: "/Game/CRDD/Generated",
        previewLevel: "/Game/CRDD/Generated/DoorPreviewLevel",
        dimensionsCm: { length: 90, width: 10, height: 200 },
        placement: {
          locationCm: { x: 150, y: 25, z: 0 },
          rotationDeg: { pitch: 0, yaw: 90, roll: 0 },
        },
        traces: ["REQ-WALL-001"],
      },
    ],
  });
});

test("generates one manifest entry for every declared 3D asset", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  ir.operation.assets?.push({
    id: "DoorPreview2",
    type: "box",
    dimensions: {
      length: { value: 0.9, unit: "m" },
      width: { value: 0.1, unit: "m" },
      height: { value: 2.0, unit: "m" },
    },
    material: { baseColor: [0.4, 0.2, 0.1] },
    placement: {
      location: {
        x: { value: 2, unit: "m" },
        y: { value: 0, unit: "m" },
        z: { value: 0, unit: "m" },
      },
      rotation: {
        pitch: { value: 0, unit: "deg" },
        yaw: { value: 45, unit: "deg" },
        roll: { value: 0, unit: "deg" },
      },
    },
    traces: ["REQ-WALL-001"],
  });

  const files = generateAssets(ir);
  assert.ok(files.some((file) => file.name === "DoorPreview2.generated.obj"));
  const manifest = JSON.parse(
    files.find((file) => file.name === "assets.manifest.json")?.content ?? "",
  );
  assert.deepEqual(
    manifest.assets.map((asset: { id: string }) => asset.id),
    ["WallPreview", "DoorPreview", "DoorPreview2"],
  );
});

test("generates deterministic cylinder geometry with UVs and normals", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const cylinder = structuredClone(ir.operation.assets?.[0]);
  assert.ok(cylinder);
  if (!cylinder) return;
  cylinder.id = "ColumnPreview";
  cylinder.type = "cylinder";
  ir.operation.assets = [cylinder];
  const first = generateAssets(ir);
  const second = generateAssets(ir);
  assert.deepEqual(first, second);
  const obj = first.find((file) => file.name === "ColumnPreview.generated.obj")?.content ?? "";
  assert.equal((obj.match(/^v /gm) ?? []).length, 50);
  assert.equal((obj.match(/^vn /gm) ?? []).length, 26);
  assert.equal((obj.match(/^vt /gm) ?? []).length, 50);
  assert.equal((obj.match(/^f /gm) ?? []).length, 72);
  assert.match(obj, /CRDD-TRACE: REQ-WALL-001/);
});

test("removes only obsolete generated 3D source files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crdd-assets-"));
  await Promise.all([
    writeFile(join(directory, "Current.generated.obj"), "current"),
    writeFile(join(directory, "Old.generated.obj"), "old"),
    writeFile(join(directory, "Old.generated.mtl"), "old"),
    writeFile(join(directory, "hand-authored.obj"), "keep"),
  ]);

  await removeStaleGeneratedAssets(
    directory,
    new Set(["Current.generated.obj", "assets.manifest.json"]),
  );

  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["Current.generated.obj", "hand-authored.obj"],
  );
});
