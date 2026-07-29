import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateBatch } from "../src/batch.ts";
import { compileMarkdown } from "../src/compiler.ts";
import { generateUnity } from "../src/unity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";

const source = fileURLToPath(new URL("fixtures/contracts/numeric-boundary.md", import.meta.url));
const profile = validateUnityTargetProfile({
  protocol: "crdd-ir/unity-target-v0.1",
  unityVersion: "6000.0.0f1",
  namespace: "Crdd.Generated",
  apiCompatibility: "netstandard2.1",
  scriptingBackend: "il2cpp",
  numericProjection: {
    mm: {
      csharpType: "long",
      jsonRepresentation: "decimal-string",
      rounding: "reject",
      overflow: "error",
    },
  },
});

test("generates deterministic IL2CPP-safe Unity contracts and bridges", async () => {
  const compilation = await compileMarkdown(source);
  const first = generateUnity(compilation.ir, profile, { irSha256: compilation.digest });
  const second = generateUnity(compilation.ir, profile, { irSha256: compilation.digest });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((file) => file.name), [
    "AppendRecord.Generated.cs",
    "AppendRecord.Bridge.Generated.cs",
    "AppendRecord.Bridge.Generated.Tests.cs",
    "AppendRecord.Conformance.Generated.Tests.cs",
  ]);

  const contract = first[0].content;
  const bridge = first[1].content;
  assert.match(contract, /public long SpanMm/);
  assert.match(contract, /checked\(input\.OffsetMm \+ input\.SegmentSpanMm/);
  assert.match(contract, /catch \(OverflowException\)/);
  assert.match(contract, /State = CloneState\(initialState\)/);
  assert.doesNotMatch(contract, /UnityEditor|System\.Reflection|dynamic/);
  assert.match(bridge, /interface IAppendRecordProductAdapter/);
  assert.match(bridge, /original\.Revision == ulong\.MaxValue/);
  assert.ok(bridge.indexOf("if (!contract.Succeeded)") < bridge.indexOf("TryCommitSnapshot(candidate"));
  assert.match(first[3].content, /public void SegmentFitsSpanFalsified/);
  assert.match(first[3].content, /Assert\.That\(result\.State\.Records\.Count/);
  assert.doesNotMatch(first[3].content, /\d+\.\d+L/);
});

test("generates collision-safe Unity batches with owned outputs", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "crdd-unity-batch-"));
  const manifest = await generateBatch([source], outDir, "unity", {
    layout: "flat",
    unityProfile: profile,
  });
  assert.equal(manifest.target, "unity");
  assert.deepEqual((await readdir(outDir)).sort(), [
    "AppendRecord.Bridge.Generated.Tests.cs",
    "AppendRecord.Bridge.Generated.cs",
    "AppendRecord.Conformance.Generated.Tests.cs",
    "AppendRecord.Generated.cs",
    "batch.manifest.json",
  ]);
  assert.equal(manifest.operations[0].files.length, 4);
});

test("rejects ambiguous Unity target profiles", () => {
  assert.throws(() => validateUnityTargetProfile({
    protocol: "crdd-ir/unity-target-v0.1",
    unityVersion: "latest",
    namespace: "bad namespace",
    apiCompatibility: "netstandard2.1",
    scriptingBackend: "il2cpp",
  }), /Unity editor version/);
});
