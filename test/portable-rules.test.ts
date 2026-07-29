import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileMarkdown } from "../src/compiler.ts";
import { simulate } from "../src/simulator.ts";
import {
  portableSemanticsDigestFromGenerated,
  verifyTargetParity,
} from "../src/target-parity.ts";
import { generateUnity } from "../src/unity.ts";
import { generateUnreal } from "../src/unreal.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { analyzeMutationCoverage } from "../src/mutation.ts";
import { validateIr } from "../src/ir.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";
import type { SimulationRequest } from "../src/model.ts";

const source = fileURLToPath(new URL("./fixtures/contracts/portable-contract.md", import.meta.url));
const unrealProfile = validateUnrealTargetProfile(JSON.parse(
  await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8"),
));
const unityProfile = validateUnityTargetProfile(JSON.parse(
  await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
));

function opaque(bytes: Uint8Array, active = false) {
  return {
    base64: Buffer.from(bytes).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    active,
  };
}

function validRequest(): SimulationRequest {
  const preserved = opaque(new Uint8Array([0, 255, 16, 128]));
  return {
    input: {
      proposed_extension: structuredClone(preserved),
      frames: [{ id: "frame-1", kind: "coordinate-frame" }],
    },
    state: {
      parents: { primary: { id: "parent-1" } },
      elements: [
        { id: "a", kind: "source", frame_id: "frame-1", parent_id: "parent-1" },
        { id: "b", kind: "target", frame_id: "frame-1", parent_id: "parent-1" },
      ],
      relations: [{ from_id: "a", to_id: "b" }],
      unknown_extension: preserved,
    },
  };
}

test("IR-COLLECTION-001 enforces deterministic collection rule ordering and rollback", async () => {
  const { ir } = await compileMarkdown(source);
  const valid = validRequest();
  assert.equal(simulate(ir, valid).ok, true);

  const duplicate = structuredClone(valid);
  (duplicate.state.elements as Array<Record<string, unknown>>)[1].id = "a";
  const failed = simulate(ir, duplicate);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.failedRequirement, "DM-ELEMENT-ID-UNIQUE");
  assert.equal(failed.error, "DUPLICATE_ELEMENT_ID");
  assert.deepEqual(failed.state, duplicate.state);
});

test("IR-COLLECTION-001 validates typed references, membership, and relation endpoints", async () => {
  const { ir } = await compileMarkdown(source);
  const cases: Array<[string, (request: SimulationRequest) => void]> = [
    ["DM-FRAME-REFERENCE", (request) => {
      (request.input.frames as Array<Record<string, unknown>>)[0].kind = "other";
    }],
    ["DM-PARENT-MEMBERSHIP", (request) => {
      (request.state.elements as Array<Record<string, unknown>>)[0].parent_id = "missing";
    }],
    ["DM-RELATION-ENDPOINTS", (request) => {
      (request.state.relations as Array<Record<string, unknown>>)[0].to_id = "a";
    }],
  ];
  for (const [rule, mutate] of cases) {
    const request = validRequest();
    mutate(request);
    const result = simulate(ir, request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failedRequirement, rule);
  }
});

test("IR-OPAQUE-001 preserves arbitrary bytes and rejects noncanonical or mismatched values", async () => {
  const { ir } = await compileMarkdown(source);
  const request = validRequest();
  const result = simulate(ir, request);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.unknown_extension, request.state.unknown_extension);

  const invalid = validRequest();
  (invalid.input.proposed_extension as Record<string, unknown>).base64 = "AP8Q_g==";
  const rejected = simulate(ir, invalid);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.failedRequirement, "DM-UNKNOWN-BYTES");

  const mismatch = validRequest();
  (mismatch.input.proposed_extension as Record<string, unknown>).sha256 = "0".repeat(64);
  const digestRejected = simulate(ir, mismatch);
  assert.equal(digestRejected.ok, false);
  if (!digestRejected.ok) assert.equal(digestRejected.failedRequirement, "DM-UNKNOWN-BYTES");
});

test("IR-IMMUTABLE-001 rejects inactive unknown edits without state changes", async () => {
  const { ir } = await compileMarkdown(source);
  const request = validRequest();
  request.input.proposed_extension = opaque(new Uint8Array([1, 2, 3]));
  const result = simulate(ir, request);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failedRequirement, "DM-UNKNOWN-PRESERVED");
  assert.equal(result.error, "UNKNOWN_EXTENSION_EDIT_REJECTED");
  assert.deepEqual(result.state, request.state);

  const active = validRequest();
  (active.state.unknown_extension as Record<string, unknown>).active = true;
  active.input.proposed_extension = opaque(new Uint8Array([1, 2, 3]), true);
  const accepted = simulate(ir, active);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.deepEqual(accepted.state.unknown_extension, active.input.proposed_extension);

  const malformed = validRequest();
  malformed.state.unknown_extension = { arbitrary: "not-an-envelope" };
  const immutableOnly = structuredClone(ir);
  immutableOnly.operation.portableRules = immutableOnly.operation.portableRules?.filter(
    (rule) => rule.id !== "DM-STORED-UNKNOWN-BYTES",
  );
  const failClosed = simulate(immutableOnly, malformed);
  assert.equal(failClosed.ok, false);
  if (!failClosed.ok) assert.equal(failClosed.failedRequirement, "DM-UNKNOWN-PRESERVED");
});

test("portable rules generate independently for Unreal and Unity with shared parity evidence", async () => {
  const compilation = await compileMarkdown(source);
  const unreal = generateUnreal(compilation.ir, { irSha256: compilation.digest });
  const unity = generateUnity(compilation.ir, unityProfile, { irSha256: compilation.digest });
  assert.match(unreal.find((file) => file.name.endsWith(".cpp"))!.content, /CrddOpaqueValid/);
  assert.match(unreal.find((file) => file.name.endsWith(".cpp"))!.content, /DM-RELATION-ENDPOINTS/);
  assert.ok(unreal.some((file) => file.name.endsWith("Conformance.spec.cpp")));
  assert.match(unreal.find((file) => file.name.endsWith(".generated.h"))!.content, /TMap<FString/);
  assert.match(unity.find((file) => file.name.endsWith(".Generated.cs"))!.content, /OpaqueValid/);
  assert.match(unity.find((file) => file.name.endsWith(".Generated.cs"))!.content, /DM-UNKNOWN-PRESERVED/);
  assert.match(unity.find((file) => file.name.endsWith(".Generated.cs"))!.content, /CloneOpaque/);
  assert.match(unity.find((file) => file.name.endsWith(".Generated.cs"))!.content, /Dictionary<string/);
  const parity = verifyTargetParity(compilation, unrealProfile, unityProfile);
  assert.equal(parity.equivalent, true);
  const tampered = unreal.map((file) => ({ ...file }));
  const markerFile = tampered.find((file) => file.content.includes("CRDD-PORTABLE-SEMANTICS:"))!;
  markerFile.content = markerFile.content.replace(
    /^\s*\/\/ CRDD-PORTABLE-SEMANTICS:.*\r?\n/m,
    "",
  );
  assert.notEqual(
    portableSemanticsDigestFromGenerated(tampered),
    parity.portableRulesSha256,
  );
});

test("IR-COLLECTION-001 rejects non-portable and incompatible ID fields before generation", async () => {
  const compilation = await compileMarkdown(source);
  const invalidId = structuredClone(compilation.ir);
  const elements = invalidId.operation.state.elements;
  if (elements.type !== "array" || elements.items.type !== "object") throw new Error("fixture changed");
  elements.items.properties.id = { type: "boolean" };
  assert.ok(validateIr(invalidId).some((item) =>
    item.path.endsWith(".key") && item.message.includes("string or integer")
  ));

  const mismatch = structuredClone(compilation.ir);
  const frames = mismatch.operation.input.frames;
  if (frames.type !== "array" || frames.items.type !== "object") throw new Error("fixture changed");
  frames.items.properties.id = { type: "number" };
  assert.ok(validateIr(mismatch).some((item) =>
    item.path.endsWith(".reference") && item.message.includes("same type")
  ));
});

test("portable conformance cases kill every typed rule mutation deterministically", async () => {
  const compilation = await compileMarkdown(source);
  const first = generateTestManifest(compilation.ir);
  const second = generateTestManifest(compilation.ir);
  assert.deepEqual(first, second);
  assert.equal(first.cases.filter((item) => item.sourceRequirement?.startsWith("DM-")).length, 8);
  const report = analyzeMutationCoverage(compilation.ir, first);
  assert.equal(report.survived.length, 0);
  assert.equal(report.killed, 8);
});
