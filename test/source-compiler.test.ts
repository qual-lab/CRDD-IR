import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { generateAssets, getAssetDefinitions, removeStaleGeneratedAssets } from "../src/assets.ts";
import { generateConformanceBundle } from "../src/conformance.ts";
import { normalizeSourceExpression, parseSourceExpression } from "../src/source-expression.ts";
import { UnitRegistry } from "../src/unit-registry.ts";
import { extractContractFences } from "../src/source-contract.ts";
import { analyzeTestCoverage, generateTestManifest } from "../src/test-manifest.ts";
import { simulate } from "../src/simulator.ts";
import { runTestManifest } from "../src/test-runner.ts";
import {
  generateEvidenceMarkdown,
  generateTraceabilityManifest,
} from "../src/traceability.ts";
import { generateUnreal } from "../src/unreal.ts";
import { parseUnrealAutomationReport } from "../src/unreal-report.ts";
import { validateIr } from "../src/ir.ts";
import type { CrddIr, FieldDefinition } from "../src/model.ts";

const sourcePath = new URL(
  "../examples/apply-record/contract.md",
  import.meta.url,
);
const revisionSourcePath = new URL(
  "../examples/revise-record/contract.md",
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
    "input.length >= 0.3m && state.capacity.remaining >= input.amount",
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

test("normalizes project-defined units through an explicit registry", () => {
  const registry = new UnitRegistry({
    base: { dimension: "custom", factor: 1 },
    sub: { dimension: "custom", factor: 0.01 },
  });
  assert.equal(
    normalizeSourceExpression(
      "input.value >= 25sub",
      { "input.value": { type: "number", unit: "base" } },
      registry,
    ),
    "input.value >= 0.25",
  );
});

test("supports string and boolean literals in deterministic expressions", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.label": { type: "string" },
    "input.enabled": { type: "boolean" },
  };
  assert.equal(
    normalizeSourceExpression('input.label == "record" && input.enabled == true', fields),
    'input.label == "record" && input.enabled == true',
  );
});

test("rejects incompatible units", () => {
  const fields: Record<string, FieldDefinition> = {
    "input.length": { type: "number", unit: "m" },
  };
  assert.throws(
    () => normalizeSourceExpression("input.length >= 100credit", fields),
    /incompatible units "m" and "credit"/,
  );
});

test("compiles CRDD Markdown into the existing Internal IR", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const expected = JSON.parse(
    await readFile(new URL("../examples/apply-record/apply-record.ir.json", import.meta.url), "utf8"),
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

test("produces the same conformance semantics from Markdown and its IR snapshot", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const snapshot = JSON.parse(
    await readFile(new URL("../examples/apply-record/apply-record.ir.json", import.meta.url), "utf8"),
  ) as CrddIr;
  assert.deepEqual(
    generateConformanceBundle(compiled.ir, generateTestManifest(compiled.ir)),
    generateConformanceBundle(snapshot, generateTestManifest(snapshot)),
  );
});

test("produces byte-identical Unreal C++ from the same CRDD source", async () => {
  const first = generateUnreal((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const second = generateUnreal((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  assert.deepEqual(first, second);
  assert.ok(first.some((file) => file.content.includes("Result.State.Records.Add")));
});

test("generates Unreal append values for references and typed literals", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const records = ir.operation.state.records;
  assert.equal(records.type, "array");
  if (records.type !== "array") return;
  records.items.properties.label = { type: "string" };
  records.items.properties.enabled = { type: "boolean" };
  ir.operation.effects[0] = {
    target: "state.records",
    action: "append",
    value: {
      length: "$input.length",
      amount: "$input.amount",
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
    target: "state.capacity.remaining",
    action: "increment",
    expression: "-input.amount",
  }];
  const result = simulate(ir, {
    input: { length: 1, amount: 100 },
    state: { records: [], capacity: { remaining: 1_000 } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { records: [], capacity: { remaining: 900 } });
  const source = generateUnreal(ir).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(source, /Result\.State\.CapacityRemainingCredit \+= -Input\.AmountCredit/);
});

test("derives deterministic counterexamples for non-boundary requirements", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  ir.operation.input.enabled = { type: "boolean" };
  ir.operation.requires = [{
    id: "must-be-enabled",
    expression: "input.enabled == true",
    error: "RECORD_TOO_SMALL",
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

test("validates, simulates, and generates typed array update/remove effects", async () => {
  const base = (await compileMarkdown(fileURLToPath(sourcePath))).ir;
  const request = {
    input: { length: 1, amount: 100 },
    state: {
      capacity: { remaining: 1_000 },
      records: [
        { length: 1, amount: 100 },
        { length: 3, amount: 300 },
      ],
    },
  };

  const update = structuredClone(base);
  update.operation.effects = [{
    target: "state.records",
    action: "update",
    where: { amount: "$input.amount" },
    set: { length: 2 },
  }];
  assert.deepEqual(validateIr(update).filter((item) => item.severity === "error"), []);
  const updated = simulate(update, structuredClone(request));
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.state.records, [
    { length: 2, amount: 100 },
    { length: 3, amount: 300 },
  ]);
  const updateCpp = generateUnreal(update).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(updateCpp, /for \(FCrddApplyRecordRecordsItem& Item/);
  assert.match(updateCpp, /Item\.AmountCredit == Input\.AmountCredit/);
  assert.match(updateCpp, /Item\.LengthUnit = 2/);

  const remove = structuredClone(base);
  remove.operation.effects = [{
    target: "state.records",
    action: "remove",
    where: { amount: "$input.amount" },
  }];
  assert.deepEqual(validateIr(remove).filter((item) => item.severity === "error"), []);
  const removed = simulate(remove, structuredClone(request));
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.state.records, [{ length: 3, amount: 300 }]);
  const removeCpp = generateUnreal(remove).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(removeCpp, /RemoveAll/);
});

test("compiles the ReviseRecord source contract and exercises its generated case", async () => {
  const ir = (await compileMarkdown(fileURLToPath(revisionSourcePath))).ir;
  assert.deepEqual(validateIr(ir).filter((item) => item.severity === "error"), []);
  const manifest = generateTestManifest(ir);
  const success = manifest.cases.find((item) => item.expect.ok);
  assert.ok(success);
  if (!success) return;
  const result = simulate(ir, structuredClone(success.arrange));
  assert.equal(result.ok, true);
  assert.equal((result.state.records as Array<{ length: number }>)[0].length, 1);
  const mutation = (await import("../src/mutation.ts")).analyzeMutationCoverage(ir, manifest);
  assert.equal(mutation.score, 100);
});

test("derives isolated conformance cases from a baseline satisfying multiple requirements", async () => {
  const compilation = await compileMarkdown("test/fixtures/contracts/numeric-boundary.md");
  const manifest = generateTestManifest(compilation.ir);
  const report = await runTestManifest(compilation.ir, manifest);
  assert.equal(report.failed, 0);
  assert.equal(report.passed, report.total);
  assert.ok(manifest.cases.find((item) => item.id === "append-record-success")?.expect.ok);
  for (const requirement of compilation.ir.operation.requires) {
    assert.ok(manifest.cases.some((item) =>
      item.sourceRequirement === requirement.id && item.expect.ok === false
    ));
  }
  for (const requirementId of ["segment-fits-span", "segment-fits-extent"]) {
    assert.ok(manifest.cases.some((item) =>
      item.id === `${requirementId}-at-boundary` && item.expect.ok === true
    ));
    assert.ok(manifest.cases.some((item) =>
      item.id === `${requirementId}-outside-boundary` && item.expect.ok === false
    ));
    assert.ok(manifest.cases.some((item) =>
      item.id === `${requirementId}-inside-boundary` && item.expect.ok === true
    ));
  }
  const mutation = (await import("../src/mutation.ts")).analyzeMutationCoverage(
    compilation.ir,
    manifest,
  );
  assert.equal(mutation.score, 100);
  assert.deepEqual(mutation.survived, []);
});

test("fails with requirement IDs when no satisfying conformance baseline exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crdd-unsatisfied-"));
  const path = join(directory, "impossible.md");
  const source = await readFile("test/fixtures/contracts/numeric-boundary.md", "utf8");
  await writeFile(path, source.replace(
    "condition: input.span >= 300mm",
    "condition: input.span >= 300mm",
  ).replace(
    "    - { id: minimum-extent",
    "    - { id: impossible-maximum, condition: input.span <= 10mm, error: SPAN_TOO_SMALL }\n    - { id: minimum-extent",
  ));
  const compilation = await compileMarkdown(path);
  assert.throws(
    () => generateTestManifest(compilation.ir),
    /Cannot derive a satisfying conformance baseline.*minimum-span|impossible-maximum/,
  );
});

test("materializes optional enum defaults and rejects unknown values", async () => {
  const compiled = await compileMarkdown(fileURLToPath(revisionSourcePath));
  const request = {
    input: { record_id: "record-1", new_length: 2, options: {} },
    state: {
      audit: { mode: "preserve_metadata" },
      records: [{ record_id: "record-1", length: 1 }],
    },
  };
  const result = simulate(compiled.ir, request);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal((result.state.audit as { mode: string }).mode, "replace");
  assert.equal(Object.hasOwn(request.input.options, "mode"), false);
  assert.throws(
    () => simulate(compiled.ir, {
      input: { ...request.input, options: { mode: "invent" } },
      state: request.state,
    }),
    /must be one of: replace, preserve_metadata/,
  );
  const header = generateUnreal(compiled.ir).find((file) => file.name.endsWith(".h"))?.content ?? "";
  assert.match(header, /struct FCrddReviseRecordInputOptions/);
  assert.match(header, /struct FCrddReviseRecordStateAudit/);
  assert.match(header, /FString Mode = TEXT\("replace"\);/);
  const source = generateUnreal(compiled.ir).find((file) => file.name.endsWith(".cpp"))?.content ?? "";
  assert.match(source, /Result\.State\.Audit\.Mode = Input\.Options\.Mode;/);
});

test("rejects invalid optional defaults and enums", async () => {
  const compiled = await compileMarkdown(fileURLToPath(revisionSourcePath));
  const ir = structuredClone(compiled.ir);
  const options = ir.operation.input.options;
  assert.equal(options.type, "object");
  if (options.type !== "object") return;
  const mode = options.properties.mode;
  mode.default = "invent";
  mode.enum = ["replace", "replace"];
  const diagnostics = validateIr(ir);
  assert.ok(diagnostics.some((item) => item.path.endsWith(".enum")));
  assert.ok(diagnostics.some((item) => item.path.endsWith(".default")));
});

test("produces deterministic traceability evidence from CRDD source", async () => {
  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const tests = generateTestManifest(compiled.ir);
  const bundle = generateConformanceBundle(compiled.ir, tests);
  const unreal = generateUnreal(compiled.ir);
  const artifacts = unreal.map((file) => ({
    path: `unreal/${file.name}`,
    sha256: file.sha256,
    traces: [...compiled.ir.operation.traces],
  }));
  const first = generateTraceabilityManifest(
    compiled.ir,
    "contracts/contract.md",
    compiled.digest,
    artifacts,
    tests,
    bundle,
  );
  const second = generateTraceabilityManifest(
    compiled.ir,
    "contracts/contract.md",
    compiled.digest,
    artifacts,
    tests,
    bundle,
  );

  assert.deepEqual(first, second);
  assert.match(first.source.irSha256, /^[a-f0-9]{64}$/);
  assert.ok(first.generatedFiles.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(
    first.requirements.find((requirement) => requirement.id === "minimum-record-length")?.traces,
    ["REQ-RECORD-001"],
  );
  assert.match(generateEvidenceMarkdown(first), /REQ-RECORD-001/);
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
        fullTestPath: "CRDD.ApplyRecord.Conformance",
        state: "Success",
        duration: 0.016,
        warnings: 0,
        errors: 0,
      },
      {
        fullTestPath: "CRDD.Assets.PrimaryPreview",
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
  const execution = parseUnrealAutomationReport(`\uFEFF${raw}`, "ApplyRecord");
  assert.deepEqual(execution.summary, { succeeded: 3, failed: 0, notRun: 0 });
  assert.deepEqual(execution.platforms, ["WindowsEditor"]);
  assert.doesNotMatch(JSON.stringify(execution), /developer-machine|private-instance-id/);

  const compiled = await compileMarkdown(fileURLToPath(sourcePath));
  const tests = generateTestManifest(compiled.ir);
  const bundle = generateConformanceBundle(compiled.ir, tests);
  const unrealArtifacts = generateUnreal(compiled.ir).map((file) => ({
    path: `unreal/${file.name}`,
    sha256: file.sha256,
    traces: [...compiled.ir.operation.traces],
  }));
  const assetArtifacts = generateAssets(compiled.ir).map((file) => ({
    path: `assets/${file.name}`,
    sha256: file.sha256,
    traces: [...compiled.ir.operation.traces],
  }));
  const executionArtifact = {
    path: "unreal-execution.json",
    sha256: createHash("sha256").update(`${JSON.stringify(execution, null, 2)}\n`).digest("hex"),
    status: execution.summary.failed === 0 && execution.summary.notRun === 0
      ? "passed" as const
      : "failed" as const,
    tests: execution.tests.map((test) => test.path),
  };
  const traceability = generateTraceabilityManifest(
    compiled.ir,
    "contracts/contract.md",
    compiled.digest,
    [...unrealArtifacts, ...assetArtifacts],
    tests,
    bundle,
    executionArtifact,
  );
  assert.equal(traceability.execution?.status, "passed");
  assert.equal(
    traceability.execution?.sha256,
    createHash("sha256").update(`${JSON.stringify(execution, null, 2)}\n`).digest("hex"),
  );
  assert.match(generateEvidenceMarkdown(traceability), /Execution[\s\S]*PASSED/);
  assert.ok(
    traceability.generatedFiles.some((file) => file.path === "assets/PrimaryPreview.generated.obj"),
  );
});

test("generates deterministic unit-declared 3D assets from CRDD", async () => {
  const ir = (await compileMarkdown(fileURLToPath(sourcePath))).ir;
  const first = generateAssets(ir);
  const second = generateAssets(ir);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((file) => file.name),
    [
      "PrimaryPreview.generated.obj",
      "PrimaryPreview.generated.mtl",
      "SecondaryPreview.generated.obj",
      "SecondaryPreview.generated.mtl",
      "assets.manifest.json",
    ],
  );
  const obj = first.find((file) => file.name.endsWith(".obj"))?.content ?? "";
  assert.match(obj, /Units: centimeters/);
  assert.match(obj, /v -50 -10 0/);
  assert.match(obj, /v 50 10 240/);
  assert.match(obj, /vt 1 1/);
  assert.match(obj, /f 1\/1 4\/4 3\/3 2\/2/);
  assert.match(obj, /CRDD-TRACE: REQ-RECORD-001/);
  const manifest = JSON.parse(
    first.find((file) => file.name === "assets.manifest.json")?.content ?? "",
  );
  assert.deepEqual(manifest, {
    protocol: "crdd-ir/assets-v0.2",
    operation: "ApplyRecord",
    coordinateSystem: "right-handed-z-up",
    units: { distance: "cm", angle: "deg" },
    scene: { id: "ApplyRecordScene" },
    assets: [
      {
        id: "PrimaryPreview",
        source: "PrimaryPreview.generated.obj",
        previewScene: "PrimaryPreviewScene",
        dimensions: { length: 100, width: 20, height: 240 },
        collision: { shape: "box" },
        lod: { policy: "architectural" },
        placement: {
          location: { x: 0, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        },
        traces: ["REQ-RECORD-001"],
      },
      {
        id: "SecondaryPreview",
        source: "SecondaryPreview.generated.obj",
        previewScene: "SecondaryPreviewScene",
        dimensions: { length: 90, width: 10, height: 200 },
        collision: { shape: "box" },
        lod: { policy: "large" },
        placement: {
          location: { x: 150, y: 25, z: 0 },
          rotation: { pitch: 0, yaw: 90, roll: 0 },
        },
        traces: ["REQ-RECORD-001"],
      },
    ],
  });
});

test("rejects unsupported collision shapes and LOD policies", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const asset = getAssetDefinitions(ir)[0];
  assert.ok(asset);
  if (!asset) return;
  asset.collision.shape = "triangle-mesh" as typeof asset.collision.shape;
  asset.lod.policy = "cinematic" as typeof asset.lod.policy;
  assert.throws(() => generateAssets(ir), /collision\.shape is unsupported/);
});

test("generates one manifest entry for every declared 3D asset", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  getAssetDefinitions(ir).push({
    id: "SecondaryPreview2",
    type: "box",
    dimensions: {
      length: { value: 0.9, unit: "m" },
      width: { value: 0.1, unit: "m" },
      height: { value: 2.0, unit: "m" },
    },
    material: { baseColor: [0.4, 0.2, 0.1] },
    collision: { shape: "box" },
    lod: { policy: "large" },
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
    traces: ["REQ-RECORD-001"],
  });

  const files = generateAssets(ir);
  assert.ok(files.some((file) => file.name === "SecondaryPreview2.generated.obj"));
  const manifest = JSON.parse(
    files.find((file) => file.name === "assets.manifest.json")?.content ?? "",
  );
  assert.deepEqual(
    manifest.assets.map((asset: { id: string }) => asset.id),
    ["PrimaryPreview", "SecondaryPreview", "SecondaryPreview2"],
  );
});

test("generates deterministic cylinder geometry with UVs and normals", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(sourcePath))).ir);
  const cylinder = structuredClone(getAssetDefinitions(ir)[0]);
  assert.ok(cylinder);
  if (!cylinder) return;
  cylinder.id = "ColumnPreview";
  cylinder.type = "cylinder";
  const extension = ir.operation.extensions?.["crdd.3d-assets"];
  assert.ok(extension && typeof extension.data === "object" && extension.data !== null);
  if (!extension || typeof extension.data !== "object" || extension.data === null) return;
  (extension.data as { assets: unknown[] }).assets = [cylinder];
  const first = generateAssets(ir);
  const second = generateAssets(ir);
  assert.deepEqual(first, second);
  const obj = first.find((file) => file.name === "ColumnPreview.generated.obj")?.content ?? "";
  assert.equal((obj.match(/^v /gm) ?? []).length, 50);
  assert.equal((obj.match(/^vn /gm) ?? []).length, 26);
  assert.equal((obj.match(/^vt /gm) ?? []).length, 50);
  assert.equal((obj.match(/^f /gm) ?? []).length, 72);
  assert.match(obj, /CRDD-TRACE: REQ-RECORD-001/);
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
