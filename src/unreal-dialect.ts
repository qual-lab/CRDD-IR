import type { UnrealTargetPlan, UnrealTargetProfile } from "./unreal-target.ts";

export type UnrealDialect = {
  id: string;
  engine: { major: number; minor: number; minimumPatch: number };
  includeOrderVersion: string;
  buildSettingsVersion: string;
  supportedTargets: UnrealTargetProfile["targetType"][];
  supportedPropertySpecifiers: string[];
  supportedFunctionSpecifiers: string[];
  deprecatedApis: Record<string, string>;
};

const DIALECTS: Record<string, UnrealDialect> = {
  "ue-5.8": {
    id: "ue-5.8",
    engine: { major: 5, minor: 8, minimumPatch: 0 },
    includeOrderVersion: "EngineIncludeOrderVersion.Unreal5_8",
    buildSettingsVersion: "BuildSettingsVersion.V7",
    supportedTargets: ["Editor", "Game", "Client", "Server", "Program"],
    supportedPropertySpecifiers: [
      "Config", "Transient", "SaveGame", "Replicated", "ReplicatedUsing",
      "EditAnywhere", "VisibleAnywhere", "BlueprintReadOnly", "BlueprintReadWrite",
    ],
    supportedFunctionSpecifiers: [
      "BlueprintCallable", "BlueprintPure", "BlueprintAuthorityOnly",
      "BlueprintImplementableEvent", "BlueprintNativeEvent", "Server", "Client",
      "NetMulticast", "Reliable", "Unreliable",
    ],
    deprecatedApis: {
      "TSoftObjectPtr::LoadSynchronous": "Use Asset Manager or Streamable Manager for runtime loading",
      "ANY_PACKAGE": "Use an explicit package or object path",
    },
  },
};

export function resolveUnrealDialect(profile: UnrealTargetProfile): UnrealDialect {
  const dialect = DIALECTS[profile.engine.dialect];
  if (!dialect) throw new Error(`Unsupported Unreal dialect: ${profile.engine.dialect}`);
  if (
    dialect.engine.major !== profile.engine.major ||
    dialect.engine.minor !== profile.engine.minor ||
    profile.engine.patch < dialect.engine.minimumPatch
  ) {
    throw new Error(
      `Dialect ${dialect.id} does not match UE ` +
      `${profile.engine.major}.${profile.engine.minor}.${profile.engine.patch}`,
    );
  }
  if (!dialect.supportedTargets.includes(profile.targetType)) {
    throw new Error(`Dialect ${dialect.id} does not support target ${profile.targetType}`);
  }
  return dialect;
}

export function findDeprecatedUnrealApis(
  text: string,
  dialect: UnrealDialect,
): Array<{ api: string; replacement: string }> {
  return Object.entries(dialect.deprecatedApis)
    .filter(([api]) => text.includes(api))
    .map(([api, replacement]) => ({ api, replacement }));
}

export type UnrealMigrationReport = {
  protocol: "crdd-ir/unreal-migration-v0.1";
  from: string;
  to: string;
  automatic: string[];
  manual: string[];
};

export function createUnrealMigrationReport(
  fromId: string,
  toId: string,
): UnrealMigrationReport {
  const from = DIALECTS[fromId];
  const to = DIALECTS[toId];
  if (!from) throw new Error(`Unsupported Unreal dialect: ${fromId}`);
  if (!to) throw new Error(`Unsupported Unreal dialect: ${toId}`);
  const automatic: string[] = [];
  const manual: string[] = [];
  if (from.includeOrderVersion !== to.includeOrderVersion) {
    automatic.push(`IncludeOrderVersion: ${from.includeOrderVersion} -> ${to.includeOrderVersion}`);
  }
  if (from.buildSettingsVersion !== to.buildSettingsVersion) {
    automatic.push(`BuildSettingsVersion: ${from.buildSettingsVersion} -> ${to.buildSettingsVersion}`);
  }
  for (const [api, replacement] of Object.entries(to.deprecatedApis)) {
    if (!Object.hasOwn(from.deprecatedApis, api)) manual.push(`${api}: ${replacement}`);
  }
  return {
    protocol: "crdd-ir/unreal-migration-v0.1",
    from: fromId,
    to: toId,
    automatic,
    manual,
  };
}

export function semanticUnrealPlanDiff(
  before: UnrealTargetPlan,
  after: UnrealTargetPlan,
): string[] {
  const changes: string[] = [];
  compare("profile.engine.dialect", before.profile.engine.dialect, after.profile.engine.dialect, changes);
  compare("profile.platform", before.profile.platform, after.profile.platform, changes);
  compare("profile.targetType", before.profile.targetType, after.profile.targetType, changes);
  compare("profile.configuration", before.profile.configuration, after.profile.configuration, changes);
  compare("profile.withEditor", before.profile.withEditor, after.profile.withEditor, changes);
  compare(
    "modules",
    before.modules.map((module) => `${module.name}:${module.type}`).join(","),
    after.modules.map((module) => `${module.name}:${module.type}`).join(","),
    changes,
  );
  compare(
    "generatedCode.reflection",
    before.generatedCode.reflection,
    after.generatedCode.reflection,
    changes,
  );
  compare(
    "profile.numericProjection",
    stableNumericProjection(before.profile.numericProjection),
    stableNumericProjection(after.profile.numericProjection),
    changes,
  );
  compare("verification.cook", before.verification.cook, after.verification.cook, changes);
  compare("verification.package", before.verification.package, after.verification.package, changes);
  return changes;
}

function stableNumericProjection(
  projection: UnrealTargetProfile["numericProjection"],
): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(projection ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )),
  );
}

function compare(path: string, before: unknown, after: unknown, changes: string[]): void {
  if (before !== after) changes.push(`${path}: ${String(before)} -> ${String(after)}`);
}
