import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import { simulate } from "../src/simulator.ts";
import { generateUnreal } from "../src/unreal.ts";
import { generateUnity } from "../src/unity.ts";
import { validateUnityTargetProfile } from "../src/unity-target.ts";
import { validateUnrealTargetProfile } from "../src/unreal-target.ts";
import { verifyTargetParity } from "../src/target-parity.ts";

const source = fileURLToPath(new URL("fixtures/contracts/collection-evaluation.md", import.meta.url));
const input = {
  expectedRevision: 4,
  selectedIds: ["truth-primary", "truth-cover", "wrong"],
  records: [{ recordId: "record-1", observationId: "obs-1", captureMethod: "photo" }],
  truthNodes: [
    { truthId: "truth-primary", role: "primary" },
    { truthId: "truth-contributing", role: "contributing" },
    { truthId: "truth-cover", role: "cover" },
    { truthId: "wrong", role: "cover" },
  ],
  observationRelations: [
    { observationId: "obs-1", captureMethod: "photo", truthId: "truth-primary", relation: "supports", reliability: 3, importance: 2 },
  ],
  policy: { primaryWeight: 10, contributingWeight: 5, coverWeight: 1, incorrectPenalty: 2, rewardMultiplier: 3, highBandMinimum: 15, mediumBandMinimum: 8 },
};
const state = { revision: 4, submitted: false, truthAccuracyScore: 0, reportingQualityScore: 0, totalScore: 0, rewardBalance: 100, rewardAwarded: 0, resultBand: "none" };

test("deterministic collection joins, filters, groups, and aggregates stay inside the contract", async () => {
  const compilation = await compileMarkdown(source);
  compilation.ir.operation.conformance = {
    baseline: { input, state },
    seeds: [
      { id: "medium-band", when: "state.totalScore >= input.policy.mediumBandMinimum", input, state: { ...state, totalScore: 17 } },
      { id: "high-band", when: "state.totalScore >= input.policy.highBandMinimum", input, state: { ...state, totalScore: 17 } },
    ],
  };
  const result = simulate(compilation.ir, { input, state });
  assert.equal(result.ok, true);
  assert.deepEqual(result.output, { truthAccuracyScore: 12, reportingQualityScore: 5, totalScore: 17, reward: 51, resultBand: "high", revision: 5 });
  assert.equal(result.state.rewardBalance, 151);
  assert.deepEqual(result.events?.[0]?.payload, { totalScore: 17, reward: 51, resultBand: "high", revision: 5 });
  assert.equal(JSON.stringify(result.output).includes("truthNodes"), false);
  assert.equal(JSON.stringify(result.output).includes("observationRelations"), false);
});

test("invalid collection submissions fail atomically without reward or events", async () => {
  const { ir } = await compileMarkdown(source);
  for (const [change, error] of [
    [{ selectedIds: [] }, "EMPTY_SELECTION"],
    [{ selectedIds: ["truth-primary", "truth-primary"] }, "DUPLICATE_SELECTION"],
    [{ selectedIds: ["unknown"] }, "UNKNOWN_SELECTION_ID"],
    [{ records: [{ recordId: "bad", observationId: "missing", captureMethod: "photo" }] }, "INVALID_RECORD"],
    [{ expectedRevision: 3 }, "REVISION_CONFLICT"],
  ] as const) {
    const result = simulate(ir, { input: { ...input, ...change }, state });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, error);
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.events, []);
  }
});

test("Unreal and Unity generate the same aggregate operations without adapter scoring", async () => {
  const compilation = await compileMarkdown(source);
  compilation.ir.operation.conformance = {
    baseline: { input, state },
    seeds: [
      { id: "medium-band", when: "state.totalScore >= input.policy.mediumBandMinimum", input, state: { ...state, totalScore: 17 } },
      { id: "high-band", when: "state.totalScore >= input.policy.highBandMinimum", input, state: { ...state, totalScore: 17 } },
    ],
  };
  const unreal = generateUnreal(compilation.ir).map((file) => file.content).join("\n");
  const unityProfile = validateUnityTargetProfile(JSON.parse(await readFile("examples/unity/profiles/unity-6-il2cpp.json", "utf8")));
  const unity = generateUnity(compilation.ir, unityProfile).map((file) => file.content).join("\n");
  assert.match(unreal, /CrddTryAddInt64/);
  assert.match(unreal, /Result\.Output\.Totalscore, int64\{17\}/);
  assert.match(unity, /SelectMany|LongCount|Sum/);
  assert.doesNotMatch(unreal + unity, /Product Adapter.*Score/i);
  const unrealProfile = validateUnrealTargetProfile(JSON.parse(await readFile("examples/unreal/profiles/ue-5.8-editor.json", "utf8")));
  const parity = verifyTargetParity(compilation, unrealProfile, unityProfile);
  assert.equal(parity.equivalent, true);
  assert.ok(parity.requirements.includes("IR-COLLECTION-AGGREGATE-001"));
  assert.ok(parity.requirements.includes("IR-PRIVATE-OUTPUT-001"));
});

test("private authoritative collections cannot be projected directly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crdd-private-output-"));
  const path = join(directory, "contract.md");
  await writeFile(path, `# Private output\n\n\`\`\`crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: RejectPrivateProjection
  kind: query
  traces: [IR-PRIVATE-OUTPUT-001]
  input:
    secret:
      type: object
      visibility: private
      properties:
        value: { type: string }
  state:
    marker: { type: boolean }
  output: { type: string }
  returns: input.secret.value
  requires: []
  effects: []
  errors: []
\`\`\`\n`, "utf8");
  await assert.rejects(() => compileMarkdown(path), /private field "input\.secret\.value" cannot be projected directly/);
});

test("aggregate arithmetic fails closed when collection bounds cannot prove overflow safety", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crdd-aggregate-bounds-"));
  const path = join(directory, "contract.md");
  const contract = await readFile(source, "utf8");
  await writeFile(path, contract.replace("      maxItems: 15\n", ""), "utf8");
  await assert.rejects(() => compileMarkdown(path), /collection requires maxItems for overflow proof/);
});
