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
      edit_unknown: false,
      new_element_id: "new-c",
      new_numeric_id: 1,
      proposed_elements: {},
      frames: [{ id: "frame-1", kind: "coordinate-frame" }],
    },
    state: {
      parents: { primary: { id: "parent-1" } },
      elements: [
        { id: "a", kind: "source", frame_id: "frame-1", parent_id: "parent-1" },
        { id: "b", kind: "target", frame_id: "frame-1", parent_id: "parent-1" },
      ],
      numeric_elements: [{ id: 0 }],
      relations: [{ from_id: "a", to_id: "b" }],
      map_elements: {
        source: { id: "ma", kind: "source", frame_id: "frame-1", parent_id: "parent-1" },
        target: { id: "mb", kind: "target", frame_id: "frame-1", parent_id: "parent-1" },
      },
      map_relations: { primary: { from_id: "ma", to_id: "mb" } },
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

test("IR-COLLECTION-001 enforces every rule kind when the source collection is a map", async () => {
  const { ir } = await compileMarkdown(source);
  const cases: Array<[string, (request: SimulationRequest) => void]> = [
    ["DM-MAP-ELEMENT-ID-UNIQUE", (request) => {
      (request.state.map_elements as Record<string, Record<string, unknown>>).target.id = "ma";
    }],
    ["DM-MAP-FRAME-REFERENCE", (request) => {
      (request.state.map_elements as Record<string, Record<string, unknown>>).source.frame_id = "missing";
    }],
    ["DM-MAP-PARENT-MEMBERSHIP", (request) => {
      (request.state.map_elements as Record<string, Record<string, unknown>>).source.parent_id = "missing";
    }],
    ["DM-MAP-RELATION-ENDPOINTS", (request) => {
      (request.state.map_relations as Record<string, Record<string, unknown>>).primary.to_id = "ma";
    }],
  ];
  for (const [rule, mutate] of cases) {
    const request = validRequest();
    mutate(request);
    const result = simulate(ir, request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failedRequirement, rule);
      assert.deepEqual(result.state, request.state);
    }
  }
});

test("IR-COLLECTION-001 owns scalar and collection prospective uniqueness", async () => {
  const { ir } = await compileMarkdown(source);
  const scalar = validRequest();
  scalar.input.new_element_id = "a";
  const scalarResult = simulate(ir, scalar);
  assert.equal(scalarResult.ok, false);
  if (!scalarResult.ok) assert.equal(scalarResult.failedRequirement, "DM-NEW-ELEMENT-ID-AVAILABLE");

  const collection = validRequest();
  collection.input.proposed_elements = { candidate: { id: "b" } };
  const collectionResult = simulate(ir, collection);
  assert.equal(collectionResult.ok, false);
  if (!collectionResult.ok) assert.equal(collectionResult.failedRequirement, "DM-PROPOSED-ELEMENTS-UNIQUE");
});

test("IR-COLLECTION-001 normalizes integer negative zero to zero across targets", async () => {
  const { ir } = await compileMarkdown(source);
  const request = validRequest();
  request.input.new_numeric_id = -0;
  const result = simulate(ir, request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failedRequirement, "DM-NEW-NUMERIC-ID-AVAILABLE");
    assert.equal(result.error, "NUMERIC_ID_ALREADY_EXISTS");
    assert.deepEqual(result.state, request.state);
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

  for (const active of [false, true]) {
    for (const corruption of ["base64", "sha256"] as const) {
      const invalid = validRequest();
      (invalid.state.unknown_extension as Record<string, unknown>).active = active;
      (invalid.input.proposed_extension as Record<string, unknown>).active = active;
      (invalid.input.proposed_extension as Record<string, unknown>)[corruption] =
        corruption === "base64" ? "not canonical!" : "f".repeat(64);
      const standalone = structuredClone(ir);
      standalone.operation.portableRules = standalone.operation.portableRules?.filter(
        (rule) => rule.kind === "opaque.immutable-when-inactive",
      );
      const result = simulate(standalone, invalid);
      assert.equal(result.ok, false, `${active ? "active" : "inactive"} ${corruption}`);
      if (!result.ok) assert.equal(result.failedRequirement, "DM-UNKNOWN-PRESERVED");
    }
  }
});

test("IR-IMMUTABLE-001 rejects edit intent even when inactive bytes are unchanged", async () => {
  const { ir } = await compileMarkdown(source);
  const request = validRequest();
  request.input.edit_unknown = true;
  const result = simulate(ir, request);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failedRequirement, "DM-UNKNOWN-EDIT-INTENT");
  assert.equal(result.error, "UNKNOWN_EXTENSION_EDIT_REJECTED");
  assert.deepEqual(result.state, request.state);
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
  assert.ok(parity.requirements.includes("IR-IMMUTABLE-001"));

  const editIntentOnly = structuredClone(compilation);
  editIntentOnly.ir.operation.portableRules = editIntentOnly.ir.operation.portableRules?.filter(
    (rule) => rule.kind === "opaque.reject-edit-when-inactive",
  );
  const editIntentParity = verifyTargetParity(editIntentOnly, unrealProfile, unityProfile);
  assert.ok(editIntentParity.requirements.includes("IR-IMMUTABLE-001"));

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
  assert.equal(first.cases.filter((item) => item.sourceRequirement?.startsWith("DM-")).length, 16);
  const report = analyzeMutationCoverage(compilation.ir, first);
  assert.equal(report.survived.length, 0);
  assert.equal(report.killed, 16);
});
