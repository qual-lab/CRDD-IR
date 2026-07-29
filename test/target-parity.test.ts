import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { verifyTargetParity } from "../src/target-parity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";

const source = "test/fixtures/contracts/numeric-boundary.md";

async function profiles() {
  return {
    unreal: validateUnrealTargetProfile(JSON.parse(
      await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8"),
    )),
    unity: validateUnityTargetProfile(JSON.parse(
      await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
    )),
  };
}

test("IR-TARGET-001 generates independent Unreal C++ and Unity C# targets", async () => {
  const compilation = await compileMarkdown(source);
  const profile = await profiles();
  const report = verifyTargetParity(compilation, profile.unreal, profile.unity);
  assert.equal(report.checks.independentTargetOutputs, true);
  assert.deepEqual(report.targets.map((target) => target.id), ["unreal", "unity"]);
  assert.ok(report.targets[0].generatedFiles.every((file) => /\.(?:h|cpp)$/.test(file.path)));
  assert.ok(report.targets[1].generatedFiles.every((file) => /\.cs$/.test(file.path)));
});

test("IR-PARITY-001 proves shared semantics and compatible numeric projections", async () => {
  const compilation = await compileMarkdown(source);
  const profile = await profiles();
  const first = verifyTargetParity(compilation, profile.unreal, profile.unity);
  const second = verifyTargetParity(compilation, profile.unreal, profile.unity);
  assert.deepEqual(first, second);
  assert.equal(first.checks.sharedSourceIr, true);
  assert.equal(first.checks.sharedConformanceSemantics, true);
  assert.equal(first.checks.equivalentNumericProjections, true);
  assert.equal(first.equivalent, true);
  assert.deepEqual(first.numericProjections.map((item) => item.unit), ["mm"]);
});

test("IR-PARITY-001 fails when target numeric behavior differs", async () => {
  const compilation = await compileMarkdown(source);
  const profile = await profiles();
  const incompatible = structuredClone(profile.unreal);
  incompatible.numericProjection!.mm.jsonRepresentation = "number";
  const report = verifyTargetParity(compilation, incompatible, profile.unity);
  assert.equal(report.checks.equivalentNumericProjections, false);
  assert.equal(report.equivalent, false);
});
