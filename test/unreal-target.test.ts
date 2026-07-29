import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileMarkdown } from "../src/compiler.ts";
import {
  buildUnrealTargetPlan,
  unrealTargetPlanDigest,
  validateModuleGraph,
  validateAdapterContract,
  validateUnrealTargetProfile,
  type UnrealModule,
  type UnrealTargetProfile,
} from "../src/unreal-target.ts";
import {
  createUnrealMigrationReport,
  findDeprecatedUnrealApis,
  resolveUnrealDialect,
  semanticUnrealPlanDiff,
} from "../src/unreal-dialect.ts";
import { generateUnreal } from "../src/unreal.ts";

const source = fileURLToPath(new URL(
  "../examples/apply-record/contract.md",
  import.meta.url,
));

const shipping = {
  engine: { major: 5, minor: 8, patch: 0, dialect: "ue-5.8" },
  platform: "Win64",
  targetType: "Game",
  configuration: "Shipping",
  linkType: "monolithic",
  withEditor: false,
} satisfies UnrealTargetProfile;

test("builds a deterministic Shipping Unreal Target Plan", async () => {
  const compilation = await compileMarkdown(source);
  const first = buildUnrealTargetPlan(compilation.ir, compilation.digest, shipping);
  const second = buildUnrealTargetPlan(compilation.ir, compilation.digest, shipping);
  assert.deepEqual(first, second);
  assert.equal(unrealTargetPlanDigest(first), unrealTargetPlanDigest(second));
  assert.deepEqual(first.modules.map((module) => module.name), ["CRDDIRRuntime"]);
  assert.equal(first.verification.package, true);
  assert.equal(first.generatedCode.reflection, false);
});

test("rejects Editor dependencies and invalid profile combinations in Shipping", () => {
  assert.throws(
    () => validateUnrealTargetProfile({ ...shipping, withEditor: true }),
    /Shipping target must set profile.withEditor=false/,
  );
  const editorModule: UnrealModule = {
    name: "BadEditorModule",
    type: "Editor",
    loadingPhase: "Default",
    publicDependencies: [],
    privateDependencies: [],
    dynamicModules: [],
    publicIncludes: [],
    privateIncludes: [],
    platformAllowList: [],
    platformDenyList: [],
  };
  assert.throws(
    () => validateModuleGraph([editorModule], shipping),
    /cannot enter a non-Editor target/,
  );
});

test("rejects circular Unreal module dependencies", () => {
  const module = (
    name: string,
    dependency: string,
  ): UnrealModule => ({
    name,
    type: "Runtime",
    loadingPhase: "Default",
    publicDependencies: [dependency],
    privateDependencies: [],
    dynamicModules: [],
    publicIncludes: [],
    privateIncludes: [],
    platformAllowList: [],
    platformDenyList: [],
  });
  assert.throws(
    () => validateModuleGraph([module("A", "B"), module("B", "A")], shipping),
    /dependency cycle: A -> B -> A/,
  );
});

test("validates UHT, GC, lifecycle, and worker-thread contracts before generation", () => {
  const modules: UnrealModule[] = [{
    name: "CRDDIRRuntime",
    type: "Runtime",
    loadingPhase: "Default",
    publicDependencies: ["Core", "CoreUObject", "Engine"],
    privateDependencies: [],
    dynamicModules: [],
    publicIncludes: [],
    privateIncludes: [],
    platformAllowList: [],
    platformDenyList: [],
  }];
  const adapter = {
    lifecycle: {
      scope: "GameInstance",
      initialize: true,
      deinitialize: true,
      cancelOnTeardown: true,
      preventDoubleInitialize: true,
      dependencies: [],
    },
    execution: {
      mode: "worker",
      completionThread: "game-thread",
      cancellation: "cooperative",
      revisionPolicy: "monotonic-revision",
      deadlineMs: 5000,
      allowUObjectAccess: false,
      discardStaleResults: true,
    },
    types: [{
      source: "state.asset",
      target: "UPrimaryDataAsset",
      reference: "soft-object",
      serialized: true,
      reflected: true,
      editable: true,
      blueprint: false,
      transient: false,
    }],
    declarations: [{
      kind: "USTRUCT",
      name: "FCrddRuntimeState",
      module: "CRDDIRRuntime",
      apiMacro: "CRDDIRRUNTIME_API",
      generatedBody: true,
      generatedHeaderLast: true,
      metadata: {},
      properties: [{
        name: "Asset",
        cppType: "TSoftObjectPtr<UObject>",
        specifiers: ["SaveGame"],
        reference: "soft-object",
      }],
      functions: [],
    }],
  };
  assert.doesNotThrow(() => validateAdapterContract(adapter, modules, shipping));
  assert.throws(
    () => validateAdapterContract({
      ...adapter,
      execution: {
        ...adapter.execution,
        allowUObjectAccess: true,
      },
    }, modules, shipping),
    /Worker execution must not allow UObject access/,
  );
  assert.throws(
    () => validateAdapterContract({
      ...adapter,
      declarations: [{
        ...adapter.declarations[0],
        namespace: "Invalid",
      }],
    }, modules, shipping),
    /cannot be placed in a namespace/,
  );
});

test("validates Asset, Config, Serialization, Delegate, Projection, and performance policy", () => {
  const profile = {
    ...shipping,
    adapter: {
      lifecycle: {
        scope: "GameInstance",
        initialize: true,
        deinitialize: true,
        cancelOnTeardown: true,
        preventDoubleInitialize: true,
        dependencies: [],
      },
      execution: {
        mode: "worker",
        completionThread: "game-thread",
        cancellation: "cooperative",
        revisionPolicy: "input-hash",
        allowUObjectAccess: false,
        discardStaleResults: true,
      },
      types: [],
      declarations: [],
      assets: [{
        id: "Catalog",
        primaryAssetType: "CRDDCatalog",
        primaryAssetId: "Default",
        reference: "soft",
        bundles: ["Runtime"],
        scanPath: "/Game/CRDD/Generated",
        cookRule: "AlwaysCook",
        chunkId: 0,
        developmentOnly: false,
        fallback: "/Game/CRDD/Fallback",
        memoryBudgetMb: 64,
        unload: "owner-lifetime",
      }],
      config: [{
        file: "DefaultGame.ini",
        section: "/Script/Engine.AssetManagerSettings",
        key: "PrimaryAssetTypesToScan",
        operation: "add",
        value: "(PrimaryAssetType=\"CRDDCatalog\")",
        owner: "CRDDIRIntegration",
      }],
      serialization: {
        schemaVersion: 1,
        customVersionGuid: "12345678-1234-1234-1234-123456789abc",
        preserveUnknownFields: true,
        namePolicy: "string",
        objectPathRedirects: {},
        maxPayloadBytes: 2_000_000,
        async: true,
        atomicWrite: true,
        compression: "zlib",
        encryption: "none",
        hashOrder: "before-encryption",
        excludeEditorOnly: true,
      },
      delegates: [{
        name: "OnApplied",
        kind: "native",
        cardinality: "multicast",
        owner: "UCRDDIRRuntimeSubsystem",
        weakBinding: true,
        unbind: "owner-destroyed",
        preventDuplicateBinding: true,
        order: "unspecified",
        reentrant: false,
        visibility: "Runtime",
        arguments: [{ name: "Revision", type: "uint64" }],
      }],
      projection: {
        domainId: "record.id",
        actorIsAuthoritative: false,
        diff: ["spawn", "update", "destroy"],
        objectPool: false,
        worldPartition: "unsupported",
        rebuild: true,
        staleActorDetection: true,
        distinguishPieAndEditorWorld: true,
      },
      performance: {
        enabled: true,
        shipping: true,
        scopes: ["operation", "asset-load"],
        insights: true,
        memory: false,
        correlationId: "input-hash",
      },
    },
  };
  assert.doesNotThrow(() => validateUnrealTargetProfile(profile));
  assert.throws(
    () => validateUnrealTargetProfile({
      ...profile,
      adapter: {
        ...profile.adapter,
        assets: [{
          ...profile.adapter.assets[0],
          reference: "hard",
          memoryBudgetMb: undefined,
        }],
      },
    }),
    /hard Asset references require an explicit memory budget/,
  );
  assert.throws(
    () => validateUnrealTargetProfile({
      ...profile,
      adapter: {
        ...profile.adapter,
        serialization: {
          ...profile.adapter.serialization,
          async: false,
        },
      },
    }),
    /payloads over 1 MiB require async Save\/Load/,
  );
});

test("resolves an engine dialect and reports semantic target changes", async () => {
  const dialect = resolveUnrealDialect(shipping);
  assert.equal(dialect.id, "ue-5.8");
  assert.deepEqual(
    findDeprecatedUnrealApis("ANY_PACKAGE", dialect),
    [{ api: "ANY_PACKAGE", replacement: "Use an explicit package or object path" }],
  );
  assert.deepEqual(createUnrealMigrationReport("ue-5.8", "ue-5.8"), {
    protocol: "crdd-ir/unreal-migration-v0.1",
    from: "ue-5.8",
    to: "ue-5.8",
    automatic: [],
    manual: [],
  });
  const compilation = await compileMarkdown(source);
  const game = buildUnrealTargetPlan(compilation.ir, compilation.digest, shipping);
  const editor = buildUnrealTargetPlan(compilation.ir, compilation.digest, {
    ...shipping,
    targetType: "Editor",
    configuration: "Development",
    linkType: "modular",
    withEditor: true,
  });
  assert.match(semanticUnrealPlanDiff(game, editor).join("\n"), /targetType/);
  assert.match(semanticUnrealPlanDiff(game, editor).join("\n"), /verification\.package/);
});

test("projects a unit to an explicit integer C++ and JSON representation", async () => {
  const compilation = await compileMarkdown("test/fixtures/contracts/numeric-boundary.md");
  const profile: UnrealTargetProfile = {
    ...shipping,
    numericProjection: {
      mm: {
        cppType: "int64",
        jsonRepresentation: "decimal-string",
        rounding: "reject-lossy",
        overflow: "error",
      },
    },
  };
  const plan = buildUnrealTargetPlan(compilation.ir, compilation.digest, profile);
  assert.equal(plan.profile.numericProjection?.mm.cppType, "int64");
  assert.deepEqual(plan.verification.numericBoundaryTests[0].cases, [
    "minimum", "maximum", "overflow", "lossy-input", "json-round-trip",
  ]);
  const generated = generateUnreal(compilation.ir, {
    numericProjection: profile.numericProjection,
  });
  const header = generated.find((file) => file.name.endsWith(".h"))!.content;
  const cpp = generated.find((file) => file.name.endsWith(".cpp"))!.content;
  const numericFixture = generated.find((file) =>
    file.name.endsWith(".numeric.generated.spec.cpp")
  )!;
  assert.ok(numericFixture);
  assert.match(header, /CRDD-IR Numeric Projection: mm -> int64/);
  assert.match(header, /int64 SpanMm = 0;/);
  assert.match(header, /TryParseProjectedInt64/);
  assert.match(cpp, /CrddTryAddInt64\(Input\.OffsetMm, Input\.SegmentSpanMm/);
  assert.match(cpp, /bCrddOverflow4_1 \|\| !\(\(CrddChecked4_0 <= Input\.SpanMm\)\)/);
  assert.match(cpp, /if \(!LexTryParseString\(OutValue, \*Decimal\)\)/);
  assert.match(cpp, /return LexToString\(OutValue\) == Decimal/);
  assert.match(cpp, /return LexToString\(Value\)/);
  assert.match(numericFixture.content, /NumericBoundary\.Generated/);
  assert.match(numericFixture.content, /std::numeric_limits<int64>::max\(\)/);
  assert.match(numericFixture.content, /segment-fits-span/);
  assert.match(numericFixture.content, /9223372036854775808/);

  const changed = buildUnrealTargetPlan(compilation.ir, compilation.digest, {
    ...profile,
    numericProjection: {
      mm: { ...profile.numericProjection!.mm, jsonRepresentation: "number" },
    },
  });
  assert.match(
    semanticUnrealPlanDiff(plan, changed).join("\n"),
    /profile\.numericProjection/,
  );
});
