import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { simulate } from "../src/simulator.ts";
import { generateTestManifest } from "../src/test-manifest.ts";
import { generateUnity } from "../src/unity.ts";
import { generateUnreal } from "../src/unreal.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { analyzeMutationCoverage } from "../src/mutation.ts";

const source = fileURLToPath(new URL("fixtures/contracts/conditional-effects.md", import.meta.url));

test("conditional effects select one atomic branch and emit branch traces", async () => {
  const compilation = await compileMarkdown(source);
  const initial = { danger: 40, status: "active" };
  const continued = simulate(compilation.ir, {
    input: { decision: "continue", danger_gain: 5 }, state: initial,
  });
  assert.equal(continued.ok, true);
  assert.deepEqual(continued.state, { danger: 45, status: "active" });
  assert.deepEqual(continued.traces, ["IR-CONDITIONAL-EFFECT-001", "BRANCH-CONTINUE"]);

  const withdrawn = simulate(compilation.ir, {
    input: { decision: "withdraw", danger_gain: 5 }, state: initial,
  });
  assert.equal(withdrawn.ok, true);
  assert.deepEqual(withdrawn.state, { danger: 40, status: "withdrawn" });
  assert.deepEqual(withdrawn.traces, ["IR-CONDITIONAL-EFFECT-001", "BRANCH-WITHDRAW"]);

  assert.throws(() => simulate(compilation.ir, {
    input: { decision: "unknown", danger_gain: 5 }, state: initial,
  }), /must be one of/);

  const rejected = simulate(compilation.ir, {
    input: { decision: "withdraw", danger_gain: 5 },
    state: { danger: 40, status: "withdrawn" },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "STATUS_NOT_ACTIVE");
  assert.deepEqual(rejected.state, { danger: 40, status: "withdrawn" });
});

test("conditional effect conformance owns every enum branch and rollback", async () => {
  const { ir } = await compileMarkdown(source);
  const manifest = generateTestManifest(ir);
  assert.ok(manifest.cases.some((item) => item.id.endsWith("branch-decision-continue")));
  assert.ok(manifest.cases.some((item) => item.id.endsWith("branch-decision-withdraw")));
  assert.ok(manifest.cases.some((item) => item.expect.stateUnchanged));
  assert.deepEqual(analyzeMutationCoverage(ir, manifest).survived, []);
});

test("Unreal and Unity generate equivalent conditional branches and traces", async () => {
  const compilation = await compileMarkdown(source);
  const cpp = generateUnreal(compilation.ir).map((file) => file.content).join("\n");
  const cppFiles = generateUnreal(compilation.ir);
  const unity = generateUnity(compilation.ir, validateUnityTargetProfile({
    protocol: "crdd-ir/unity-target-v0.1",
    unityVersion: "6000.0.0f1",
    namespace: "Crdd.Generated",
    apiCompatibility: "netstandard2.1",
    scriptingBackend: "il2cpp",
  })).map((file) => file.content).join("\n");
  assert.match(cpp, /if \(Input\.Decision == TEXT\("continue"\)\)/);
  assert.match(cpp, /Result\.Traces\.Add\(TEXT\("BRANCH-CONTINUE"\)\)/);
  const cppConformance = cppFiles.find((file) => file.name === "ResolveDecisionConformance.spec.cpp");
  assert.ok(cppConformance);
  assert.match(cppConformance.content, /branch-decision-continue trace BRANCH-CONTINUE/);
  assert.match(cppConformance.content, /branch-decision-withdraw trace BRANCH-WITHDRAW/);
  assert.match(unity, /if \(input\.Decision == "withdraw"\)/);
  assert.match(unity, /"BRANCH-WITHDRAW"/);
});

test("effect and requirement selectors must be typed boolean expressions", async () => {
  const compilation = await compileMarkdown(source);
  const invalidEffect = structuredClone(compilation.ir);
  invalidEffect.operation.effects[0].when = "input.decision";
  assert.ok((await import("../src/ir.ts")).validateIr(invalidEffect).some((item) =>
    item.path === "$.operation.effects[0].when" && item.message.includes("boolean")
  ));
  const invalidRequirement = structuredClone(compilation.ir);
  invalidRequirement.operation.requires[1].when = "input.danger_gain";
  assert.ok((await import("../src/ir.ts")).validateIr(invalidRequirement).some((item) =>
    item.path === "$.operation.requires[1].when" && item.message.includes("boolean")
  ));
});
