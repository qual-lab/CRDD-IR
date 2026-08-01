import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileMarkdown } from "../src/compiler.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { generateUnreal } from "../src/unreal.ts";
import { generateUnity } from "../src/unity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";
import { verifyTargetParity } from "../src/target-parity.ts";

const source = fileURLToPath(new URL("fixtures/contracts/multi-field-conformance.md", import.meta.url));

test("reviewable seeds cover branches that require coordinated field values deterministically", async () => {
  const compilation = await compileMarkdown(source);
  const first = generateTestManifest(compilation.ir);
  const second = generateTestManifest(compilation.ir);
  assert.deepEqual(first, second);

  const one = first.cases.find((item) => item.id.endsWith("branch-count-band-one"));
  const two = first.cases.find((item) => item.id.endsWith("branch-count-band-two"));
  assert.deepEqual(one?.arrange.input, {
    count_band: "one", signal_a: true, signal_b: false, signal_c: false,
  });
  assert.deepEqual(two?.arrange.input, {
    count_band: "two", signal_a: true, signal_b: true, signal_c: false,
  });
});

test("invalid or absent seeds do not legalize a branch that violates Requires", async () => {
  const { ir } = await compileMarkdown(source);
  const absent = structuredClone(ir);
  absent.operation.conformance!.seeds = [];
  assert.throws(() => generateTestManifest(absent), /Cannot cover effect branch.*Requires conflict: count-one/);

  const invalid = structuredClone(ir);
  invalid.operation.conformance!.seeds![0].input!.signal_a = false;
  assert.throws(() => generateTestManifest(invalid), /Conformance seed "one-signal-a".*Requires conflict: count-one/);

  const wrongType = structuredClone(ir);
  wrongType.operation.conformance!.seeds![0].input!.signal_a = "true";
  assert.throws(() => generateTestManifest(wrongType), /invalid value for input.signal_a/);
});

test("Unreal and Unity consume the same multi-field conformance semantics", async () => {
  const compilation = await compileMarkdown(source);
  const { ir } = compilation;
  const manifest = generateTestManifest(ir);
  const unreal = generateUnreal(ir).find((file) => file.name.endsWith("Conformance.spec.cpp"));
  const unity = generateUnity(ir, validateUnityTargetProfile({
    protocol: "crdd-ir/unity-target-v0.1",
    unityVersion: "6000.0.0f1",
    namespace: "Crdd.Generated",
    apiCompatibility: "netstandard2.1",
    scriptingBackend: "il2cpp",
  })).find((file) => file.name.includes("Conformance.Generated.Tests"));
  for (const item of manifest.cases.filter((candidate) => candidate.id.includes("branch-count-band"))) {
    const branch = item.id.slice(item.id.indexOf("branch-"));
    const normalized = (value: string) => value.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    assert.ok(normalized(unreal?.content ?? "").includes(normalized(branch)));
    assert.ok(normalized(unity?.content ?? "").includes(normalized(branch)));
  }
  const parity = verifyTargetParity(
    compilation,
    validateUnrealTargetProfile(JSON.parse(
      await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8"),
    )),
    validateUnityTargetProfile(JSON.parse(
      await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
    )),
  );
  assert.equal(parity.checks.sharedConformanceSemantics, true);
  assert.equal(parity.equivalent, true);
});
