import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileMarkdown } from "../src/compiler.ts";
import { evaluateExpression } from "../src/expression.ts";
import { simulate } from "../src/simulator.ts";
import { generateUnreal } from "../src/unreal.ts";
import { generateUnity } from "../src/unity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { verifyTargetParity } from "../src/target-parity.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";
import { portableRuleSatisfied } from "../src/portable-rules.ts";
import type { PortableRule } from "../src/model.ts";

const contract = "test/fixtures/contracts/collection-result-events.md";

test("collection all/any are deterministic boolean expressions with mathematical empty semantics", () => {
  assert.equal(evaluateExpression("all(input.items, item.value >= input.minimum)", {
    input: { items: [], minimum: 3 },
  }), true);
  assert.equal(evaluateExpression("any(input.items, item.value >= input.minimum)", {
    input: { items: [], minimum: 3 },
  }), false);
  assert.equal(evaluateExpression("all(input.items, item.value >= item.minimumValue)", {
    input: { items: [{ value: 4, minimumValue: 3 }, { value: 5, minimumValue: 5 }] },
  }), true);
});

test("typed collection all/any guards preserve AND predicates and mathematical empty semantics", () => {
  const base = {
    id: "threshold-guard",
    error: "THRESHOLD_NOT_MET",
    collection: "input.axes",
    predicates: [
      { field: "value", operator: "gte", reference: "item.minimumValue" },
      { field: "value", operator: "gte", reference: "input.commonMinimum" },
    ],
  } as const;
  const all = { ...base, kind: "collection.all" } satisfies PortableRule;
  const any = { ...base, kind: "collection.any" } satisfies PortableRule;
  assert.equal(portableRuleSatisfied(all, { input: { axes: [], commonMinimum: 3 }, state: {} }), true);
  assert.equal(portableRuleSatisfied(any, { input: { axes: [], commonMinimum: 3 }, state: {} }), false);
  const context = {
    input: { axes: [{ value: 4, minimumValue: 3 }, { value: 2, minimumValue: 2 }], commonMinimum: 3 },
    state: {},
  };
  assert.equal(portableRuleSatisfied(all, context), false);
  assert.equal(portableRuleSatisfied(any, context), true);
});

test("returns use post-effect state and events fire only on the false-to-true edge", async () => {
  const { ir } = await compileMarkdown(contract);
  const request = {
    input: { axes: [{ value: 4, minimumValue: 3 }, { value: 5, minimumValue: 5 }], commonMinimum: 5, accepted: true },
    state: { crossed: false },
  };
  const first = simulate(ir, request);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.output, { crossed: true, anyMeetsCommonMinimum: true });
  assert.deepEqual(first.events, [{
    type: "ThresholdSetCrossed",
    payload: { crossed: true },
    traces: ["IR-OUTPUT-EVENT-001"],
  }]);

  const repeated = simulate(ir, { ...request, state: first.state });
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.deepEqual(repeated.events, []);
});

test("normal false returns no event while rejected operations return neither output nor event", async () => {
  const { ir } = await compileMarkdown(contract);
  const normal = simulate(ir, {
    input: { axes: [{ value: 2, minimumValue: 3 }], commonMinimum: 3, accepted: true },
    state: { crossed: false },
  });
  assert.equal(normal.ok, true);
  if (normal.ok) {
    assert.deepEqual(normal.output, { crossed: false, anyMeetsCommonMinimum: false });
    assert.deepEqual(normal.events, []);
  }
  const rejected = simulate(ir, {
    input: { axes: [], commonMinimum: 3, accepted: false },
    state: { crossed: false },
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.state, { crossed: false });
  assert.deepEqual(rejected.events, []);
  assert.equal("output" in rejected, false);
});

test("Unreal and Unity project identical quantifiers, output, edge events, and bridge DTOs", async () => {
  const compilation = await compileMarkdown(contract);
  const unreal = generateUnreal(compilation.ir);
  const unity = generateUnity(compilation.ir, validateUnityTargetProfile({
    protocol: "crdd-ir/unity-target-v0.1",
    unityVersion: "6000.0.0f1",
    namespace: "Crdd.Generated",
    apiCompatibility: "netstandard2.1",
    scriptingBackend: "il2cpp",
    numericProjection: {},
  }));
  const cpp = unreal.find((file) => file.name.endsWith(".generated.cpp"))!.content;
  const cppBridge = unreal.find((file) => file.name.endsWith(".bridge.generated.cpp"))!.content;
  const cs = unity.find((file) => file.name.endsWith(".Generated.cs") && !file.name.includes("Bridge"))!.content;
  const csBridge = unity.find((file) => file.name.endsWith(".Bridge.Generated.cs"))!.content;
  assert.match(cpp, /Algo::AllOf\(Input\.Axes/);
  assert.match(cpp, /axis-minimum-is-nonnegative: collection\.all/);
  assert.match(cpp, /at-least-one-axis-meets-common-minimum: collection\.any/);
  assert.match(cpp, /InitialState\.Crossed == false/);
  assert.match(cpp, /Result\.Events\.Add/);
  assert.match(cppBridge, /Result\.Output = ContractResult\.Output/);
  assert.match(cs, /input\.Axes\.All\(item =>/);
  assert.match(cs, /axis-minimum-is-nonnegative: collection\.all/);
  assert.match(cs, /at-least-one-axis-meets-common-minimum: collection\.any/);
  assert.match(cs, /initialState\.Crossed == false/);
  assert.match(cs, /result\.Events = events/);
  assert.match(csBridge, /Output = contract\.Output/);
  const unrealProfile = validateUnrealTargetProfile(JSON.parse(
    await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8"),
  ));
  const unityProfile = validateUnityTargetProfile(JSON.parse(
    await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8"),
  ));
  const parity = verifyTargetParity(compilation, unrealProfile, unityProfile);
  assert.ok(parity.requirements.includes("IR-COLLECTION-QUANTIFIER-001"));
  assert.ok(parity.requirements.includes("IR-OUTPUT-EVENT-001"));
});
