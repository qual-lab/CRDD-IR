import { createHash } from "node:crypto";
import type { CrddIr } from "./model.ts";
import { resolveUnrealDialect } from "./unreal-dialect.ts";

export const UNREAL_TARGET_PLAN_PROTOCOL = "crdd-ir/unreal-target-plan-v0.1" as const;

export type UnrealTargetProfile = {
  engine: {
    major: number;
    minor: number;
    patch: number;
    dialect: string;
  };
  platform: "Win64" | "Linux" | "LinuxArm64" | "Mac" | "Android" | "IOS";
  targetType: "Editor" | "Game" | "Client" | "Server" | "Program";
  configuration: "Debug" | "DebugGame" | "Development" | "Test" | "Shipping";
  linkType: "modular" | "monolithic";
  withEditor: boolean;
  buildId?: string;
  toolchain?: {
    compiler?: string;
    compilerVersion?: string;
    sdk?: string;
  };
  modules?: UnrealModule[];
  plugins?: UnrealPlugin[];
  adapter?: UnrealAdapterContract;
};

export type UnrealAdapterContract = {
  lifecycle: {
    scope: "Engine" | "Editor" | "GameInstance" | "World" | "LocalPlayer";
    initialize: boolean;
    deinitialize: boolean;
    cancelOnTeardown: boolean;
    preventDoubleInitialize: boolean;
    dependencies: string[];
  };
  execution: {
    mode: "game-thread" | "thread-safe-pure" | "worker";
    completionThread: "game-thread" | "worker";
    cancellation: "none" | "cooperative";
    revisionPolicy: "none" | "input-hash" | "monotonic-revision";
    deadlineMs?: number;
    allowUObjectAccess: boolean;
    discardStaleResults: boolean;
  };
  types: UnrealTypeProjection[];
  declarations: UnrealDeclaration[];
  assets?: UnrealAssetContract[];
  config?: UnrealConfigPatch[];
  serialization?: UnrealSerializationContract;
  delegates?: UnrealDelegateContract[];
  projection?: UnrealWorldProjectionContract;
  performance?: UnrealPerformanceContract;
};

export type UnrealAssetContract = {
  id: string;
  primaryAssetType?: string;
  primaryAssetId?: string;
  reference: "hard" | "soft";
  bundles: string[];
  scanPath: string;
  cookRule: "Unknown" | "NeverCook" | "DevelopmentCook" | "AlwaysCook";
  chunkId?: number;
  developmentOnly: boolean;
  fallback?: string;
  memoryBudgetMb?: number;
  unload: "manual" | "owner-lifetime" | "never";
};

export type UnrealConfigPatch = {
  file: "DefaultEngine.ini" | "DefaultGame.ini" | "DefaultInput.ini" | string;
  platform?: string;
  section: string;
  key: string;
  operation: "set" | "add" | "remove" | "clear";
  value?: string;
  owner: string;
};

export type UnrealSerializationContract = {
  schemaVersion: number;
  customVersionGuid: string;
  preserveUnknownFields: boolean;
  namePolicy: "string" | "name-transient-only";
  objectPathRedirects: Record<string, string>;
  maxPayloadBytes: number;
  async: boolean;
  atomicWrite: boolean;
  compression: "none" | "zlib" | "oodle";
  encryption: "none" | "project-provider";
  hashOrder: "before-encryption" | "after-encryption";
  excludeEditorOnly: boolean;
};

export type UnrealDelegateContract = {
  name: string;
  kind: "native" | "dynamic";
  cardinality: "single-cast" | "multicast";
  owner: string;
  weakBinding: boolean;
  unbind: "owner-destroyed" | "deinitialize" | "manual";
  preventDuplicateBinding: boolean;
  order: "unspecified" | "registration";
  reentrant: boolean;
  visibility: "Runtime" | "Editor" | "Both";
  arguments: Array<{ name: string; type: string }>;
};

export type UnrealWorldProjectionContract = {
  domainId: string;
  actorIsAuthoritative: false;
  diff: Array<"spawn" | "update" | "destroy">;
  objectPool: boolean;
  worldPartition: "unsupported" | "supported";
  rebuild: boolean;
  staleActorDetection: boolean;
  distinguishPieAndEditorWorld: boolean;
};

export type UnrealPerformanceContract = {
  enabled: boolean;
  shipping: boolean;
  scopes: Array<
    "operation" | "async-request" | "game-thread-apply" | "asset-load" | "save"
  >;
  insights: boolean;
  memory: boolean;
  correlationId: "none" | "non-personal-random" | "input-hash";
};

export type UnrealTypeProjection = {
  source: string;
  target:
    | "PureCpp"
    | "USTRUCT"
    | "UObject"
    | "UDataAsset"
    | "UPrimaryDataAsset"
    | "AActor"
    | "UActorComponent"
    | "USubsystem"
    | "UInterface";
  reference:
    | "value"
    | "owned"
    | "observed"
    | "weak"
    | "soft-object"
    | "soft-class"
    | "strong"
    | "shared"
    | "unique";
  serialized: boolean;
  reflected: boolean;
  editable: boolean;
  blueprint: boolean;
  transient: boolean;
};

export type UnrealDeclaration = {
  kind: "UCLASS" | "USTRUCT" | "UENUM" | "UINTERFACE";
  name: string;
  module: string;
  apiMacro: string;
  base?: string;
  namespace?: string;
  template?: boolean;
  generatedBody: boolean;
  generatedHeaderLast: boolean;
  values?: string[];
  metadata: Record<string, string | boolean | number>;
  properties: Array<{
    name: string;
    cppType: string;
    specifiers: Array<
      | "Config"
      | "Transient"
      | "SaveGame"
      | "Replicated"
      | "ReplicatedUsing"
      | "EditAnywhere"
      | "VisibleAnywhere"
      | "BlueprintReadOnly"
      | "BlueprintReadWrite"
    >;
    reference?: UnrealTypeProjection["reference"];
  }>;
  functions: Array<{
    name: string;
    returnType: string;
    parameters: Array<{ name: string; cppType: string }>;
    specifiers: Array<
      | "BlueprintCallable"
      | "BlueprintPure"
      | "BlueprintAuthorityOnly"
      | "BlueprintImplementableEvent"
      | "BlueprintNativeEvent"
      | "Server"
      | "Client"
      | "NetMulticast"
      | "Reliable"
      | "Unreliable"
    >;
    metadata: Record<string, string | boolean | number>;
  }>;
};

export type UnrealModule = {
  name: string;
  type: "Runtime" | "Editor" | "Developer" | "Program";
  loadingPhase: "Default" | "PreDefault" | "PostDefault" | "PostEngineInit";
  publicDependencies: string[];
  privateDependencies: string[];
  dynamicModules: string[];
  publicIncludes: string[];
  privateIncludes: string[];
  platformAllowList: UnrealTargetProfile["platform"][];
  platformDenyList: UnrealTargetProfile["platform"][];
};

export type UnrealPlugin = {
  name: string;
  enabledByDefault: boolean;
  canContainContent: boolean;
  supportedTargetPlatforms: UnrealTargetProfile["platform"][];
  optional: boolean;
  modules: string[];
  dependencies: string[];
};

export type UnrealTargetPlan = {
  protocol: typeof UNREAL_TARGET_PLAN_PROTOCOL;
  operation: string;
  irSha256: string;
  profile: UnrealTargetProfile;
  modules: UnrealModule[];
  plugins: UnrealPlugin[];
  generatedCode: {
    module: string;
    reflection: boolean;
    files: string[];
  };
  adapter: UnrealAdapterContract;
  verification: {
    runUht: boolean;
    build: boolean;
    cook: boolean;
    package: boolean;
    automationContexts: Array<"Editor" | "Client" | "Server">;
  };
};

export function buildUnrealTargetPlan(
  ir: CrddIr,
  irSha256: string,
  profileValue: unknown,
): UnrealTargetPlan {
  const profile = validateUnrealTargetProfile(profileValue);
  resolveUnrealDialect(profile);
  const adapter = profile.adapter ?? defaultAdapterContract();
  const modules = profile.modules ?? modulesForValidation(profile.withEditor);
  const plugins = profile.plugins ?? defaultPlugins(modules, profile.platform);
  validateModuleGraph(modules, profile);
  validatePluginGraph(plugins, modules, profile);
  validateAdapterContract(adapter, modules, profile);
  const operationName = unrealIdentifier(ir.operation.id);

  return {
    protocol: UNREAL_TARGET_PLAN_PROTOCOL,
    operation: ir.operation.id,
    irSha256,
    profile,
    modules,
    plugins,
    generatedCode: {
      module: "CRDDIRRuntime",
      reflection: adapter.declarations.length > 0,
      files: [
        `${operationName}.generated.h`,
        `${operationName}.generated.cpp`,
        ...adapter.declarations.map((declaration) => `${declaration.name}.generated-adapter.h`),
      ],
    },
    adapter,
    verification: {
      runUht: modules.some((module) => module.type === "Editor"),
      build: true,
      cook: profile.targetType !== "Editor",
      package: profile.configuration === "Shipping",
      automationContexts: profile.targetType === "Editor" ? ["Editor"] : ["Client"],
    },
  };
}

export function validateUnrealTargetProfile(value: unknown): UnrealTargetProfile {
  const profile = record(value, "profile");
  rejectUnknown(profile, [
    "engine", "platform", "targetType", "configuration", "linkType",
    "withEditor", "buildId", "toolchain", "modules", "plugins", "adapter",
  ], "profile");
  const engine = record(profile.engine, "profile.engine");
  rejectUnknown(engine, ["major", "minor", "patch", "dialect"], "profile.engine");
  for (const key of ["major", "minor", "patch"] as const) {
    if (!Number.isInteger(engine[key]) || Number(engine[key]) < 0) {
      throw new Error(`profile.engine.${key} must be a non-negative integer`);
    }
  }
  nonEmpty(engine.dialect, "profile.engine.dialect");
  oneOf(profile.platform, ["Win64", "Linux", "LinuxArm64", "Mac", "Android", "IOS"], "profile.platform");
  oneOf(profile.targetType, ["Editor", "Game", "Client", "Server", "Program"], "profile.targetType");
  oneOf(
    profile.configuration,
    ["Debug", "DebugGame", "Development", "Test", "Shipping"],
    "profile.configuration",
  );
  oneOf(profile.linkType, ["modular", "monolithic"], "profile.linkType");
  if (typeof profile.withEditor !== "boolean") throw new Error("profile.withEditor must be boolean");
  if (profile.targetType === "Editor" && profile.withEditor !== true) {
    throw new Error("Editor target requires profile.withEditor=true");
  }
  if (profile.configuration === "Shipping" && profile.withEditor) {
    throw new Error("Shipping target must set profile.withEditor=false");
  }
  if (profile.buildId !== undefined) nonEmpty(profile.buildId, "profile.buildId");
  if (profile.toolchain !== undefined) {
    const toolchain = record(profile.toolchain, "profile.toolchain");
    rejectUnknown(toolchain, ["compiler", "compilerVersion", "sdk"], "profile.toolchain");
    for (const key of Object.keys(toolchain)) nonEmpty(toolchain[key], `profile.toolchain.${key}`);
  }
  const modules = (profile.modules as UnrealModule[] | undefined) ??
    modulesForValidation(profile.withEditor as boolean);
  validateModuleGraph(modules, value as UnrealTargetProfile);
  validatePluginGraph(
    (profile.plugins as UnrealPlugin[] | undefined) ??
      defaultPlugins(modules, profile.platform as UnrealTargetProfile["platform"]),
    modules,
    value as UnrealTargetProfile,
  );
  if (profile.adapter !== undefined) {
    validateAdapterContract(
      profile.adapter as UnrealAdapterContract,
      modules,
      value as UnrealTargetProfile,
    );
  }
  return value as UnrealTargetProfile;
}

export function validateAdapterContract(
  adapterValue: unknown,
  modules: UnrealModule[],
  profile: UnrealTargetProfile,
): asserts adapterValue is UnrealAdapterContract {
  const adapter = record(adapterValue, "profile.adapter");
  rejectUnknown(adapter, [
    "lifecycle", "execution", "types", "declarations", "assets", "config",
    "serialization", "delegates", "projection", "performance",
  ], "profile.adapter");
  const lifecycle = record(adapter.lifecycle, "profile.adapter.lifecycle");
  rejectUnknown(lifecycle, [
    "scope", "initialize", "deinitialize", "cancelOnTeardown",
    "preventDoubleInitialize", "dependencies",
  ], "profile.adapter.lifecycle");
  oneOf(
    lifecycle.scope,
    ["Engine", "Editor", "GameInstance", "World", "LocalPlayer"],
    "profile.adapter.lifecycle.scope",
  );
  for (const key of [
    "initialize", "deinitialize", "cancelOnTeardown", "preventDoubleInitialize",
  ]) requireBoolean(lifecycle[key], `profile.adapter.lifecycle.${key}`);
  requireStringArray(lifecycle.dependencies, "profile.adapter.lifecycle.dependencies", true);
  if (lifecycle.scope === "Editor" && !profile.withEditor) {
    throw new Error("Editor lifecycle cannot enter a non-Editor target");
  }

  const execution = record(adapter.execution, "profile.adapter.execution");
  rejectUnknown(execution, [
    "mode", "completionThread", "cancellation", "revisionPolicy", "deadlineMs",
    "allowUObjectAccess", "discardStaleResults",
  ], "profile.adapter.execution");
  oneOf(execution.mode, ["game-thread", "thread-safe-pure", "worker"], "profile.adapter.execution.mode");
  oneOf(execution.completionThread, ["game-thread", "worker"], "profile.adapter.execution.completionThread");
  oneOf(execution.cancellation, ["none", "cooperative"], "profile.adapter.execution.cancellation");
  oneOf(
    execution.revisionPolicy,
    ["none", "input-hash", "monotonic-revision"],
    "profile.adapter.execution.revisionPolicy",
  );
  requireBoolean(execution.allowUObjectAccess, "profile.adapter.execution.allowUObjectAccess");
  requireBoolean(execution.discardStaleResults, "profile.adapter.execution.discardStaleResults");
  if (execution.deadlineMs !== undefined &&
      (!Number.isInteger(execution.deadlineMs) || Number(execution.deadlineMs) <= 0)) {
    throw new Error("profile.adapter.execution.deadlineMs must be a positive integer");
  }
  if (execution.mode !== "game-thread" && execution.allowUObjectAccess) {
    throw new Error("Worker execution must not allow UObject access");
  }
  if (execution.mode !== "game-thread" && execution.completionThread !== "game-thread") {
    throw new Error("Worker execution must apply completion on the game thread");
  }
  if (execution.discardStaleResults && execution.revisionPolicy === "none") {
    throw new Error("Discarding stale results requires a revision policy");
  }

  if (!Array.isArray(adapter.types)) throw new Error("profile.adapter.types must be an array");
  for (const [index, item] of adapter.types.entries()) {
    validateTypeProjection(item, `profile.adapter.types[${index}]`);
  }
  if (!Array.isArray(adapter.declarations)) {
    throw new Error("profile.adapter.declarations must be an array");
  }
  const moduleNames = new Set(modules.map((module) => module.name));
  for (const [index, declaration] of adapter.declarations.entries()) {
    validateDeclaration(declaration, `profile.adapter.declarations[${index}]`, moduleNames);
  }
  validateAssetContracts(adapter.assets ?? [], profile);
  validateConfigPatches(adapter.config ?? []);
  if (adapter.serialization !== undefined) validateSerialization(adapter.serialization);
  validateDelegates(adapter.delegates ?? [], profile);
  if (adapter.projection !== undefined) validateProjection(adapter.projection);
  if (adapter.performance !== undefined) validatePerformance(adapter.performance, profile);
}

export function validateModuleGraph(
  modules: UnrealModule[],
  profile: UnrealTargetProfile,
): void {
  const names = new Set(modules.map((module) => module.name));
  if (names.size !== modules.length) throw new Error("Unreal module names must be unique");
  for (const module of modules) {
    validateModule(module);
    if (module.type === "Editor" && !profile.withEditor) {
      throw new Error(`Editor module "${module.name}" cannot enter a non-Editor target`);
    }
    if (module.platformAllowList.length > 0 &&
        !module.platformAllowList.includes(profile.platform)) {
      throw new Error(`Module "${module.name}" does not allow ${profile.platform}`);
    }
    if (module.platformDenyList.includes(profile.platform)) {
      throw new Error(`Module "${module.name}" denies ${profile.platform}`);
    }
  }
  const localDependencies = new Map(modules.map((module) => [
    module.name,
    [...module.publicDependencies, ...module.privateDependencies]
      .filter((dependency) => names.has(dependency)),
  ]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string, path: string[]) => {
    if (visiting.has(name)) throw new Error(`Unreal module dependency cycle: ${[...path, name].join(" -> ")}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of localDependencies.get(name) ?? []) visit(dependency, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of names) visit(name, []);
  const editorModules = new Set(
    modules.filter((module) => module.type === "Editor").map((module) => module.name),
  );
  for (const module of modules.filter((candidate) => candidate.type === "Runtime")) {
    const reachable = new Set<string>();
    const walk = (name: string) => {
      for (const dependency of localDependencies.get(name) ?? []) {
        if (!reachable.has(dependency)) {
          reachable.add(dependency);
          walk(dependency);
        }
      }
    };
    walk(module.name);
    const leaked = [...reachable].find((name) => editorModules.has(name));
    if (leaked) {
      throw new Error(`Runtime module "${module.name}" depends on Editor module "${leaked}"`);
    }
  }
}

export function validatePluginGraph(
  plugins: UnrealPlugin[],
  modules: UnrealModule[],
  profile: UnrealTargetProfile,
): void {
  const pluginNames = new Set(plugins.map((plugin) => plugin.name));
  if (pluginNames.size !== plugins.length) throw new Error("Unreal plugin names must be unique");
  const moduleNames = new Set(modules.map((module) => module.name));
  const dependencies = new Map<string, string[]>();
  for (const plugin of plugins) {
    nonEmpty(plugin.name, "profile.plugins[].name");
    if (!plugin.optional && plugin.supportedTargetPlatforms.length > 0 &&
        !plugin.supportedTargetPlatforms.includes(profile.platform)) {
      throw new Error(`Plugin "${plugin.name}" does not support ${profile.platform}`);
    }
    for (const module of plugin.modules) {
      if (!moduleNames.has(module)) {
        throw new Error(`Plugin "${plugin.name}" references unknown module "${module}"`);
      }
    }
    for (const dependency of plugin.dependencies) {
      if (!pluginNames.has(dependency)) {
        throw new Error(`Plugin "${plugin.name}" references unknown plugin "${dependency}"`);
      }
    }
    dependencies.set(plugin.name, plugin.dependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visiting.has(name)) throw new Error(`Unreal plugin dependency cycle at "${name}"`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of pluginNames) visit(name);
}

function defaultAdapterContract(): UnrealAdapterContract {
  return {
    lifecycle: {
      scope: "GameInstance",
      initialize: true,
      deinitialize: true,
      cancelOnTeardown: true,
      preventDoubleInitialize: true,
      dependencies: [],
    },
    execution: {
      mode: "thread-safe-pure",
      completionThread: "game-thread",
      cancellation: "cooperative",
      revisionPolicy: "input-hash",
      allowUObjectAccess: false,
      discardStaleResults: true,
    },
    types: [],
    declarations: [],
  };
}

function modulesForValidation(withEditor: boolean): UnrealModule[] {
  const runtime: UnrealModule = {
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
  };
  return withEditor
    ? [runtime, {
        name: "CRDDIRIntegration",
        type: "Editor",
        loadingPhase: "Default",
        publicDependencies: [],
        privateDependencies: ["CRDDIRRuntime", "UnrealEd"],
        dynamicModules: [],
        publicIncludes: [],
        privateIncludes: [],
        platformAllowList: [],
        platformDenyList: [],
      }]
    : [runtime];
}

function defaultPlugins(
  modules: UnrealModule[],
  platform: UnrealTargetProfile["platform"],
): UnrealPlugin[] {
  return [{
    name: "CRDDIRIntegration",
    enabledByDefault: true,
    canContainContent: false,
    supportedTargetPlatforms: [platform],
    optional: false,
    modules: modules.map((module) => module.name),
    dependencies: [],
  }];
}

function validateModule(module: UnrealModule): void {
  nonEmpty(module.name, "profile.modules[].name");
  oneOf(module.type, ["Runtime", "Editor", "Developer", "Program"], "profile.modules[].type");
  oneOf(
    module.loadingPhase,
    ["Default", "PreDefault", "PostDefault", "PostEngineInit"],
    "profile.modules[].loadingPhase",
  );
  for (const key of [
    "publicDependencies", "privateDependencies", "dynamicModules", "publicIncludes",
    "privateIncludes", "platformAllowList", "platformDenyList",
  ] as const) {
    if (!Array.isArray(module[key])) throw new Error(`profile.modules[].${key} must be an array`);
    if (new Set(module[key]).size !== module[key].length) {
      throw new Error(`profile.modules[].${key} must not contain duplicates`);
    }
  }
  for (const include of [...module.publicIncludes, ...module.privateIncludes]) {
    if (include.includes("..") || /^[A-Za-z]:|^[\\/]/.test(include)) {
      throw new Error(`Module "${module.name}" has unsafe include path "${include}"`);
    }
  }
}

function validateTypeProjection(value: unknown, path: string): void {
  const projection = record(value, path);
  rejectUnknown(projection, [
    "source", "target", "reference", "serialized", "reflected",
    "editable", "blueprint", "transient",
  ], path);
  nonEmpty(projection.source, `${path}.source`);
  oneOf(projection.target, [
    "PureCpp", "USTRUCT", "UObject", "UDataAsset", "UPrimaryDataAsset",
    "AActor", "UActorComponent", "USubsystem", "UInterface",
  ], `${path}.target`);
  oneOf(projection.reference, [
    "value", "owned", "observed", "weak", "soft-object", "soft-class",
    "strong", "shared", "unique",
  ], `${path}.reference`);
  for (const key of ["serialized", "reflected", "editable", "blueprint", "transient"]) {
    requireBoolean(projection[key], `${path}.${key}`);
  }
  if ((projection.editable || projection.blueprint) && !projection.reflected) {
    throw new Error(`${path} must be reflected when editable or exposed to Blueprint`);
  }
  if (projection.target === "PureCpp" && projection.reflected) {
    throw new Error(`${path}: PureCpp cannot be reflected`);
  }
  if (projection.reflected && ["shared", "unique"].includes(String(projection.reference))) {
    throw new Error(`${path}: reflected fields cannot use shared or unique ownership`);
  }
  if (projection.serialized && projection.reference === "weak") {
    throw new Error(`${path}: weak observations cannot be serialized`);
  }
  if (projection.transient && projection.serialized) {
    throw new Error(`${path}: transient projection cannot be serialized`);
  }
}

function validateDeclaration(
  value: unknown,
  path: string,
  modules: Set<string>,
): void {
  const declaration = record(value, path);
  rejectUnknown(declaration, [
    "kind", "name", "module", "apiMacro", "base", "namespace", "template",
    "generatedBody", "generatedHeaderLast", "values", "metadata", "properties", "functions",
  ], path);
  oneOf(declaration.kind, ["UCLASS", "USTRUCT", "UENUM", "UINTERFACE"], `${path}.kind`);
  nonEmpty(declaration.name, `${path}.name`);
  const module = nonEmpty(declaration.module, `${path}.module`);
  if (!modules.has(module)) throw new Error(`${path}.module references unknown module "${module}"`);
  const apiMacro = nonEmpty(declaration.apiMacro, `${path}.apiMacro`);
  if (!/^[A-Z][A-Z0-9_]*_API$/.test(apiMacro)) {
    throw new Error(`${path}.apiMacro must be a Module API macro`);
  }
  if (declaration.namespace !== undefined) {
    throw new Error(`${path}: reflected declarations cannot be placed in a namespace`);
  }
  if (declaration.template === true) {
    throw new Error(`${path}: reflected declarations cannot be templates`);
  }
  if (declaration.base !== undefined) nonEmpty(declaration.base, `${path}.base`);
  if (declaration.kind === "UENUM") {
    if (declaration.generatedBody !== false) {
      throw new Error(`${path}.generatedBody must be false for UENUM`);
    }
    requireStringArray(declaration.values, `${path}.values`);
  } else if (declaration.generatedBody !== true) {
    throw new Error(`${path}.generatedBody must be true`);
  }
  if (declaration.generatedHeaderLast !== true) {
    throw new Error(`${path}.generatedHeaderLast must be true`);
  }
  record(declaration.metadata, `${path}.metadata`);
  if (!Array.isArray(declaration.properties)) throw new Error(`${path}.properties must be an array`);
  if (!Array.isArray(declaration.functions)) throw new Error(`${path}.functions must be an array`);
  if (declaration.kind === "UENUM" &&
      (declaration.properties.length > 0 || declaration.functions.length > 0)) {
    throw new Error(`${path}: UENUM cannot declare properties or functions`);
  }
  for (const [index, propertyValue] of declaration.properties.entries()) {
    const propertyPath = `${path}.properties[${index}]`;
    const property = record(propertyValue, propertyPath);
    rejectUnknown(property, ["name", "cppType", "specifiers", "reference"], propertyPath);
    nonEmpty(property.name, `${propertyPath}.name`);
    nonEmpty(property.cppType, `${propertyPath}.cppType`);
    requireStringArray(property.specifiers, `${propertyPath}.specifiers`, true);
    if (property.reference !== undefined) oneOf(property.reference, [
      "value", "owned", "observed", "weak", "soft-object", "soft-class",
      "strong", "shared", "unique",
    ], `${propertyPath}.reference`);
    if (property.specifiers.includes("Transient") && property.specifiers.includes("SaveGame")) {
      throw new Error(`${propertyPath} cannot be both Transient and SaveGame`);
    }
  }
  for (const [index, functionValue] of declaration.functions.entries()) {
    const functionPath = `${path}.functions[${index}]`;
    const fn = record(functionValue, functionPath);
    rejectUnknown(fn, ["name", "returnType", "parameters", "specifiers", "metadata"], functionPath);
    nonEmpty(fn.name, `${functionPath}.name`);
    nonEmpty(fn.returnType, `${functionPath}.returnType`);
    if (!Array.isArray(fn.parameters)) throw new Error(`${functionPath}.parameters must be an array`);
    for (const [parameterIndex, parameterValue] of fn.parameters.entries()) {
      const parameterPath = `${functionPath}.parameters[${parameterIndex}]`;
      const parameter = record(parameterValue, parameterPath);
      rejectUnknown(parameter, ["name", "cppType"], parameterPath);
      nonEmpty(parameter.name, `${parameterPath}.name`);
      nonEmpty(parameter.cppType, `${parameterPath}.cppType`);
    }
    requireStringArray(fn.specifiers, `${functionPath}.specifiers`, true);
    record(fn.metadata, `${functionPath}.metadata`);
    const specs = fn.specifiers as string[];
    const directions = specs.filter((item) => ["Server", "Client", "NetMulticast"].includes(item));
    if (directions.length > 1) throw new Error(`${functionPath}: RPC direction must be unique`);
    if (specs.includes("Reliable") || specs.includes("Unreliable")) {
      if (directions.length === 0) {
        throw new Error(`${functionPath}: reliability requires an RPC direction`);
      }
    }
    if (directions.length > 0 && fn.returnType !== "void") {
      throw new Error(`${functionPath}: RPC functions must return void`);
    }
  }
}

function validateAssetContracts(value: unknown, profile: UnrealTargetProfile): void {
  if (!Array.isArray(value)) throw new Error("profile.adapter.assets must be an array");
  const ids = new Set<string>();
  for (const [index, assetValue] of value.entries()) {
    const path = `profile.adapter.assets[${index}]`;
    const asset = record(assetValue, path);
    rejectUnknown(asset, [
      "id", "primaryAssetType", "primaryAssetId", "reference", "bundles",
      "scanPath", "cookRule", "chunkId", "developmentOnly", "fallback",
      "memoryBudgetMb", "unload",
    ], path);
    const id = nonEmpty(asset.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id must be unique`);
    ids.add(id);
    if (asset.primaryAssetType !== undefined) nonEmpty(asset.primaryAssetType, `${path}.primaryAssetType`);
    if (asset.primaryAssetId !== undefined) nonEmpty(asset.primaryAssetId, `${path}.primaryAssetId`);
    if ((asset.primaryAssetType === undefined) !== (asset.primaryAssetId === undefined)) {
      throw new Error(`${path}: Primary Asset Type and ID must be declared together`);
    }
    oneOf(asset.reference, ["hard", "soft"], `${path}.reference`);
    requireStringArray(asset.bundles, `${path}.bundles`, true);
    const scanPath = nonEmpty(asset.scanPath, `${path}.scanPath`);
    if (!scanPath.startsWith("/Game/") && !scanPath.startsWith("/CRDDIRIntegration/")) {
      throw new Error(`${path}.scanPath must be an Unreal package path`);
    }
    oneOf(
      asset.cookRule,
      ["Unknown", "NeverCook", "DevelopmentCook", "AlwaysCook"],
      `${path}.cookRule`,
    );
    requireBoolean(asset.developmentOnly, `${path}.developmentOnly`);
    oneOf(asset.unload, ["manual", "owner-lifetime", "never"], `${path}.unload`);
    if (asset.chunkId !== undefined &&
        (!Number.isInteger(asset.chunkId) || Number(asset.chunkId) < 0)) {
      throw new Error(`${path}.chunkId must be a non-negative integer`);
    }
    if (asset.memoryBudgetMb !== undefined &&
        (typeof asset.memoryBudgetMb !== "number" || Number(asset.memoryBudgetMb) <= 0)) {
      throw new Error(`${path}.memoryBudgetMb must be positive`);
    }
    if (asset.fallback !== undefined) nonEmpty(asset.fallback, `${path}.fallback`);
    if (profile.configuration === "Shipping" && (
      asset.developmentOnly || asset.cookRule === "DevelopmentCook"
    )) {
      throw new Error(`${path}: development-only Asset cannot enter Shipping`);
    }
    if (asset.reference === "hard" && asset.memoryBudgetMb === undefined) {
      throw new Error(`${path}: hard Asset references require an explicit memory budget`);
    }
  }
}

function validateConfigPatches(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("profile.adapter.config must be an array");
  const ownership = new Map<string, string>();
  for (const [index, patchValue] of value.entries()) {
    const path = `profile.adapter.config[${index}]`;
    const patch = record(patchValue, path);
    rejectUnknown(patch, [
      "file", "platform", "section", "key", "operation", "value", "owner",
    ], path);
    nonEmpty(patch.file, `${path}.file`);
    if (patch.platform !== undefined) nonEmpty(patch.platform, `${path}.platform`);
    nonEmpty(patch.section, `${path}.section`);
    nonEmpty(patch.key, `${path}.key`);
    oneOf(patch.operation, ["set", "add", "remove", "clear"], `${path}.operation`);
    const owner = nonEmpty(patch.owner, `${path}.owner`);
    if (patch.operation !== "clear" && patch.value === undefined) {
      throw new Error(`${path}.value is required for ${patch.operation}`);
    }
    if (patch.operation === "clear" && patch.value !== undefined) {
      throw new Error(`${path}.value is not allowed for clear`);
    }
    const identity = [
      patch.file, patch.platform ?? "", patch.section, patch.key,
    ].join("|").toLowerCase();
    const existingOwner = ownership.get(identity);
    if (existingOwner && existingOwner !== owner) {
      throw new Error(`${path}: Config key conflicts with owner "${existingOwner}"`);
    }
    ownership.set(identity, owner);
  }
}

function validateSerialization(value: unknown): void {
  const path = "profile.adapter.serialization";
  const contract = record(value, path);
  rejectUnknown(contract, [
    "schemaVersion", "customVersionGuid", "preserveUnknownFields", "namePolicy",
    "objectPathRedirects", "maxPayloadBytes", "async", "atomicWrite",
    "compression", "encryption", "hashOrder", "excludeEditorOnly",
  ], path);
  if (!Number.isInteger(contract.schemaVersion) || Number(contract.schemaVersion) < 1) {
    throw new Error(`${path}.schemaVersion must be a positive integer`);
  }
  const guid = nonEmpty(contract.customVersionGuid, `${path}.customVersionGuid`);
  if (!/^[{(]?[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}[)}]?$/.test(guid)) {
    throw new Error(`${path}.customVersionGuid must be a GUID`);
  }
  requireBoolean(contract.preserveUnknownFields, `${path}.preserveUnknownFields`);
  oneOf(contract.namePolicy, ["string", "name-transient-only"], `${path}.namePolicy`);
  const redirects = record(contract.objectPathRedirects, `${path}.objectPathRedirects`);
  for (const [from, to] of Object.entries(redirects)) {
    nonEmpty(from, `${path}.objectPathRedirects key`);
    nonEmpty(to, `${path}.objectPathRedirects.${from}`);
  }
  if (!Number.isInteger(contract.maxPayloadBytes) || Number(contract.maxPayloadBytes) <= 0) {
    throw new Error(`${path}.maxPayloadBytes must be a positive integer`);
  }
  for (const key of ["async", "atomicWrite", "excludeEditorOnly"]) {
    requireBoolean(contract[key], `${path}.${key}`);
  }
  oneOf(contract.compression, ["none", "zlib", "oodle"], `${path}.compression`);
  oneOf(contract.encryption, ["none", "project-provider"], `${path}.encryption`);
  oneOf(
    contract.hashOrder,
    ["before-encryption", "after-encryption"],
    `${path}.hashOrder`,
  );
  if (Number(contract.maxPayloadBytes) > 1024 * 1024 && contract.async !== true) {
    throw new Error(`${path}: payloads over 1 MiB require async Save/Load`);
  }
  if (contract.atomicWrite !== true) throw new Error(`${path}.atomicWrite must be true`);
}

function validateDelegates(value: unknown, profile: UnrealTargetProfile): void {
  if (!Array.isArray(value)) throw new Error("profile.adapter.delegates must be an array");
  const names = new Set<string>();
  for (const [index, delegateValue] of value.entries()) {
    const path = `profile.adapter.delegates[${index}]`;
    const delegate = record(delegateValue, path);
    rejectUnknown(delegate, [
      "name", "kind", "cardinality", "owner", "weakBinding", "unbind",
      "preventDuplicateBinding", "order", "reentrant", "visibility", "arguments",
    ], path);
    const name = nonEmpty(delegate.name, `${path}.name`);
    if (names.has(name)) throw new Error(`${path}.name must be unique`);
    names.add(name);
    oneOf(delegate.kind, ["native", "dynamic"], `${path}.kind`);
    oneOf(delegate.cardinality, ["single-cast", "multicast"], `${path}.cardinality`);
    nonEmpty(delegate.owner, `${path}.owner`);
    requireBoolean(delegate.weakBinding, `${path}.weakBinding`);
    oneOf(delegate.unbind, ["owner-destroyed", "deinitialize", "manual"], `${path}.unbind`);
    requireBoolean(delegate.preventDuplicateBinding, `${path}.preventDuplicateBinding`);
    oneOf(delegate.order, ["unspecified", "registration"], `${path}.order`);
    requireBoolean(delegate.reentrant, `${path}.reentrant`);
    oneOf(delegate.visibility, ["Runtime", "Editor", "Both"], `${path}.visibility`);
    if (delegate.visibility === "Editor" && !profile.withEditor) {
      throw new Error(`${path}: Editor delegate cannot enter non-Editor target`);
    }
    if (!Array.isArray(delegate.arguments)) throw new Error(`${path}.arguments must be an array`);
    for (const [argumentIndex, argumentValue] of delegate.arguments.entries()) {
      const argumentPath = `${path}.arguments[${argumentIndex}]`;
      const argument = record(argumentValue, argumentPath);
      rejectUnknown(argument, ["name", "type"], argumentPath);
      nonEmpty(argument.name, `${argumentPath}.name`);
      nonEmpty(argument.type, `${argumentPath}.type`);
    }
    if (delegate.weakBinding !== true && delegate.unbind === "owner-destroyed") {
      throw new Error(`${path}: owner-destroyed unbind requires weak binding`);
    }
  }
}

function validateProjection(value: unknown): void {
  const path = "profile.adapter.projection";
  const projection = record(value, path);
  rejectUnknown(projection, [
    "domainId", "actorIsAuthoritative", "diff", "objectPool", "worldPartition",
    "rebuild", "staleActorDetection", "distinguishPieAndEditorWorld",
  ], path);
  nonEmpty(projection.domainId, `${path}.domainId`);
  if (projection.actorIsAuthoritative !== false) {
    throw new Error(`${path}.actorIsAuthoritative must be false`);
  }
  requireStringArray(projection.diff, `${path}.diff`);
  for (const item of projection.diff as string[]) {
    oneOf(item, ["spawn", "update", "destroy"], `${path}.diff`);
  }
  for (const key of [
    "objectPool", "rebuild", "staleActorDetection", "distinguishPieAndEditorWorld",
  ]) requireBoolean(projection[key], `${path}.${key}`);
  oneOf(projection.worldPartition, ["unsupported", "supported"], `${path}.worldPartition`);
}

function validatePerformance(value: unknown, profile: UnrealTargetProfile): void {
  const path = "profile.adapter.performance";
  const performance = record(value, path);
  rejectUnknown(performance, [
    "enabled", "shipping", "scopes", "insights", "memory", "correlationId",
  ], path);
  for (const key of ["enabled", "shipping", "insights", "memory"]) {
    requireBoolean(performance[key], `${path}.${key}`);
  }
  requireStringArray(performance.scopes, `${path}.scopes`, true);
  for (const scope of performance.scopes as string[]) {
    oneOf(
      scope,
      ["operation", "async-request", "game-thread-apply", "asset-load", "save"],
      `${path}.scopes`,
    );
  }
  oneOf(
    performance.correlationId,
    ["none", "non-personal-random", "input-hash"],
    `${path}.correlationId`,
  );
  if (profile.configuration === "Shipping" && performance.enabled && !performance.shipping) {
    throw new Error(`${path}: performance hooks are disabled for Shipping`);
  }
}

export function unrealTargetPlanDigest(plan: UnrealTargetPlan): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

function unrealIdentifier(value: string): string {
  const result = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  if (!result || !/^[A-Za-z]/.test(result)) throw new Error(`Invalid Unreal identifier: ${value}`);
  return result;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}
function rejectUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown field(s): ${unknown.join(", ")}`);
}
function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}
function oneOf(value: unknown, allowed: string[], path: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }
}
function requireBoolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
}
function requireStringArray(value: unknown, path: string, allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${path} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
  }
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
