import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { validateIr } from "../src/ir.ts";
import { simulate } from "../src/simulator.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { generateUnity } from "../src/unity.ts";
import { generateUnreal } from "../src/unreal.ts";
import { canonicalJson } from "../src/portable-rules.ts";
import { verifyTargetParity } from "../src/target-parity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";

const source = "test/fixtures/contracts/compound-evidence-contract.md";

function evidenceHash(value: Record<string, unknown>): string {
  const { canonical_evidence_hash: _hash, ...payload } = value;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function request(variant = "space") {
  const result = {
    input: {
      evidence_version: "v1",
      quantity_kind: "length",
      scope_id: "scope-\b\f\u0001-雪-😀",
      subject_ref: variant === "space"
        ? { variant, space_id: "space-a" }
        : { variant, building_id: "building-a" },
      aggregation_scope_id: "aggregate-a",
      numeric_policy_id: "numeric-v1",
      quantity_state: "approximated",
      slot_disposition: "accepted",
      value_interval: { minimum: "1", maximum: "2" },
      absolute_error_upper_bound: "0.01",
      segments: [
        { id: "segment-a", labels: ["primary", "exterior"] },
        { id: "segment-b", labels: [] },
      ],
      numeric_lexemes: {
        negative_zero: "-0",
        exponent: "1e+21",
        min_subnormal: "5e-324",
        max_finite: "1.7976931348623157e+308",
      },
      fragment_ids: ["fragment-a", "fragment-b"],
      canonical_evidence_hash: "",
    },
    state: {
      persisted_segments: [{ id: "previous", labels: ["previous"] }],
      evidence_version: "v1",
      quantity_kind: "",
      scope_id: "scope-\b\f\u0001-雪-😀",
      subject_ref: { variant: "space", space_id: "" },
      aggregation_scope_id: "",
      numeric_policy_id: "",
      quantity_state: "",
      slot_disposition: "",
      value_interval: { minimum: "1", maximum: "2" },
      absolute_error_upper_bound: "0.01",
      segments: [{ id: "initial", labels: ["initial"] }],
      numeric_lexemes: {
        negative_zero: "-0",
        exponent: "1e+21",
        min_subnormal: "5e-324",
        max_finite: "1.7976931348623157e+308",
      },
      fragment_ids: [],
      canonical_evidence_hash: "0".repeat(64),
    },
  };
  result.input.canonical_evidence_hash = evidenceHash(result.input);
  return result;
}

test("IR-UNION-001 validates known variants and rejects unknown variants", async () => {
  const { ir } = await compileMarkdown(source);
  assert.equal(simulate(ir, request()).ok, true);
  assert.equal(simulate(ir, request("building")).ok, true);
  assert.throws(() => simulate(ir, request("future")), /unknown variant/);
  const variants = generateTestManifest(ir).cases.filter((item) =>
    item.id.startsWith("preserve-evidence-subject-ref-")
  );
  assert.equal(variants.length, 2);
});

test("IR-PRIMITIVE-COLLECTION-001 preserves order, empty arrays, and uniqueness", async () => {
  const { ir } = await compileMarkdown(source);
  const valid = request();
  const result = simulate(ir, valid);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.state.fragment_ids, valid.input.fragment_ids);

  const empty = request();
  empty.input.fragment_ids = [];
  empty.input.canonical_evidence_hash = evidenceHash(empty.input);
  const emptyResult = simulate(ir, empty);
  assert.equal(emptyResult.ok, true);
  if (emptyResult.ok) assert.deepEqual(emptyResult.state.fragment_ids, []);

  const duplicate = request();
  duplicate.input.fragment_ids = ["fragment-a", "fragment-a"];
  duplicate.input.canonical_evidence_hash = evidenceHash(duplicate.input);
  const rejected = simulate(ir, duplicate);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.failedRequirement, "EV-FRAGMENTS-UNIQUE");
});

test("IR-EVIDENCE-ROUNDTRIP-001 rejects changed evidence and owns its conformance case", async () => {
  const { ir } = await compileMarkdown(source);
  const changed = request();
  changed.input.quantity_kind = "area";
  const rejected = simulate(ir, changed);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.failedRequirement, "EV-CANONICAL-HASH");
  assert.ok(generateTestManifest(ir).cases.some((item) =>
    item.sourceRequirement === "EV-CANONICAL-HASH"
  ));
});

test("canonical Evidence covers JSON controls and Unicode and rejects binary floats", async () => {
  const value = { text: "\u0000\u0001\b\f\n\r\t\"\\雪😀\ud800" };
  assert.equal(
    canonicalJson(value),
    '{"text":"\\u0000\\u0001\\b\\f\\n\\r\\t\\"\\\\雪😀\\ud800"}',
  );

  const { ir } = await compileMarkdown(source);
  const unsupported = structuredClone(ir);
  unsupported.operation.input.absolute_error_upper_bound = { type: "number" };
  assert.ok(validateIr(unsupported).some((diagnostic) =>
    diagnostic.path.endsWith(".source") &&
    diagnostic.message.includes("canonical decimal string")
  ));
});

test("compound evidence generates type-safe Unreal and Unity targets deterministically", async () => {
  const compilation = await compileMarkdown(source);
  const unityProfile = validateUnityTargetProfile(JSON.parse(
    await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
  ));
  const unreal = generateUnreal(compilation.ir, { irSha256: compilation.digest });
  const unity = generateUnity(compilation.ir, unityProfile, { irSha256: compilation.digest });
  assert.deepEqual(unreal, generateUnreal(compilation.ir, { irSha256: compilation.digest }));
  assert.deepEqual(unity, generateUnity(compilation.ir, unityProfile, { irSha256: compilation.digest }));
  const cpp = unreal.find((file) => file.name.endsWith(".generated.h"))!.content;
  const cppSource = unreal.find((file) => file.name.endsWith(".generated.cpp"))!.content;
  const cs = unity.find((file) => file.name.endsWith(".Generated.cs"))!.content;
  assert.match(cpp, /Variant::Unknown|Variant = .*::Unknown/);
  assert.match(cpp, /TArray<FString> FragmentIds/);
  assert.equal((cpp.match(/struct FCrddPreserveEvidenceSegmentsItem/g) ?? []).length, 1);
  assert.match(cpp, /TArray<FString> Labels/);
  assert.match(cpp, /TArray<FCrddPreserveEvidenceSegmentsItem> Segments/);
  assert.match(cpp, /TArray<FCrddPreserveEvidenceSegmentsItem> PersistedSegments/);
  assert.match(cs, /Variant\.Unknown|Variant;/);
  assert.match(cs, /List<string> FragmentIds/);
  assert.match(cs, /List<string> Labels/);
  assert.equal((cs.match(/class PreserveEvidenceSegmentsItem/g) ?? []).length, 1);
  assert.match(cs, /List<PreserveEvidenceSegmentsItem> PersistedSegments/);
  assert.doesNotMatch(cs, /Labels = item\.Labels[, }]/);
  assert.doesNotMatch(cs, /PersistedSegments = input\.Segments;/);
  assert.match(cs, /Labels = .*Labels\.ConvertAll\(item => item\)/);
  assert.match(cs, /PersistedSegments = input\.Segments\.ConvertAll/);
  assert.match(cppSource, /CrddCanonicalInputSha256/);
  assert.match(cppSource, /case TEXT\('\\\\b'\)|case TEXT\('\\b'\)/);
  assert.match(cppSource, /0x1f/);
  assert.match(cs, /CanonicalInputSha256/);
  assert.match(cs, /case '\\\\f'|case '\\f'/);
  assert.match(cs, /character <= 0x1f/);
  assert.ok(generateTestManifest(compilation.ir).cases.some((item) =>
    item.sourceRequirement === "EV-FRAGMENTS-UNIQUE"
  ));
});

test("nested collections and structural type reuse are attributed in parity evidence", async () => {
  const compilation = await compileMarkdown(source);
  const unrealProfile = validateUnrealTargetProfile(JSON.parse(
    await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8"),
  ));
  const unityProfile = validateUnityTargetProfile(JSON.parse(
    await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
  ));
  const first = verifyTargetParity(compilation, unrealProfile, unityProfile);
  const second = verifyTargetParity(compilation, unrealProfile, unityProfile);
  assert.deepEqual(first, second);
  assert.equal(first.equivalent, true);
  assert.equal(first.checks.sharedSnapshotOwnership, true);
  assert.equal(first.targets[0].snapshotOwnershipSha256, first.targets[1].snapshotOwnershipSha256);
  assert.equal(first.snapshotOwnershipSha256, first.targets[0].snapshotOwnershipSha256);
  assert.ok(first.requirements.includes("IR-STRUCTURAL-TYPE-001"));
  assert.ok(first.requirements.includes("IR-NESTED-COLLECTION-001"));
});
