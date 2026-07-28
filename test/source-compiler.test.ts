import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { generateAssets } from "../src/assets.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { normalizeSourceExpression, parseSourceExpression } from "../src/source-expression.ts";
import { extractContractFences } from "../src/source-contract.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
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
    ],
  });
  const execution = parseUnrealAutomationReport(`\uFEFF${raw}`, "PlaceWall");
  assert.deepEqual(execution.summary, { succeeded: 2, failed: 0, notRun: 0 });
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
