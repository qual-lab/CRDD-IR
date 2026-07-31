import { generateAssets } from "./assets.ts";
import type { CompilationResult } from "./compiler.ts";
import { generateUnity } from "./unity.ts";
import {
  validateUnityTargetProfile,
  type UnityTargetProfile,
} from "./unity-target.ts";
import { generateUnreal } from "./unreal.ts";
import {
  buildUnrealTargetPlan,
  validateUnrealTargetProfile,
  type UnrealTargetProfile,
} from "./unreal-target.ts";
import { generateUnrealReflection } from "./unreal-uht.ts";
import { generateTypeScript } from "./typescript.ts";
import { TOOL_VERSION } from "./version.ts";

export type TargetGeneratedFile = {
  name: string;
  content: string;
  sha256?: string;
};

export type TargetGenerationContext = {
  compilation: CompilationResult;
  profile?: unknown;
  operationIndex: number;
};

export type TargetAdapter<TProfile = unknown> = {
  id: string;
  description: string;
  consumesExtensions?: string[];
  profileSchema?: string;
  profileRequired: boolean;
  supportsFlatBatch: boolean;
  validateProfile?: (value: unknown) => TProfile;
  generate: (context: TargetGenerationContext & { profile?: TProfile }) => TargetGeneratedFile[];
};

const adapters = new Map<string, TargetAdapter>([
  ["ir", {
    id: "ir",
    description: "Canonical CRDD IR JSON",
    profileRequired: false,
    supportsFlatBatch: false,
    generate: ({ compilation }) => [{
      name: `${compilation.ir.operation.id}.ir.json`,
      content: compilation.canonicalJson,
    }],
  }],
  ["typescript", {
    id: "typescript",
    description: "Portable TypeScript DTOs, runtime validators, handler contracts, and event contracts",
    profileRequired: false,
    supportsFlatBatch: true,
    generate: ({ compilation }) => generateTypeScript(compilation.ir),
  }],
  ["unreal", {
    id: "unreal",
    description: "Unreal Engine C++ contract, bridge, tests, and reflection adapters",
    profileSchema: "schemas/unreal-target-profile.schema.json",
    profileRequired: true,
    supportsFlatBatch: true,
    validateProfile: validateUnrealTargetProfile,
    generate: ({ compilation, profile, operationIndex }) => {
      assertStateTransitionTargetCompatibility("unreal", compilation);
      const unrealProfile = profile as UnrealTargetProfile | undefined;
      return [
        ...generateUnreal(compilation.ir, unrealProfile ? {
          irSha256: compilation.digest,
          generatorVersion: TOOL_VERSION,
          numericProjection: unrealProfile.numericProjection,
        } : undefined),
        ...(unrealProfile && operationIndex === 0
          ? generateUnrealReflection(buildUnrealTargetPlan(
              compilation.ir,
              compilation.digest,
              unrealProfile,
            ))
          : []),
      ];
    },
  }],
  ["unity", {
    id: "unity",
    description: "Unity C# contract, bridge, and NUnit conformance tests",
    profileSchema: "schemas/unity-target-profile.schema.json",
    profileRequired: true,
    supportsFlatBatch: true,
    validateProfile: validateUnityTargetProfile,
    generate: ({ compilation, profile }) => {
      assertStateTransitionTargetCompatibility("unity", compilation);
      return generateUnity(
        compilation.ir,
        profile as UnityTargetProfile,
        { irSha256: compilation.digest, generatorVersion: TOOL_VERSION },
      );
    },
  }],
  ["assets", {
    id: "assets",
    description: "Deterministic code-generated 3D assets",
    consumesExtensions: ["crdd.3d-assets"],
    profileRequired: false,
    supportsFlatBatch: false,
    generate: ({ compilation }) => generateAssets(compilation.ir),
  }],
]);

function assertStateTransitionTargetCompatibility(
  target: string,
  compilation: CompilationResult,
): void {
  const operation = compilation.ir.operation;
  if (operation.kind === "query") {
    throw new Error(
      `Target "${target}" does not yet project query output semantics; use target "ir" or a query-capable adapter`,
    );
  }
  if (operation.execution?.mode === "async") {
    throw new Error(
      `Target "${target}" does not yet project async execution semantics; use target "ir" or an async-capable adapter`,
    );
  }
  if (operation.output !== undefined || (operation.emits?.length ?? 0) > 0) {
    throw new Error(
      `Target "${target}" does not yet project output or event semantics; use target "ir" or a capable adapter`,
    );
  }
  const unsupported = [...Object.values(operation.input), ...Object.values(operation.state)]
    .find((field) => containsGeneralApplicationType(field, true));
  if (unsupported) {
    throw new Error(
      `Target "${target}" does not yet support field type "${unsupported.type}"; use target "ir" or a capable adapter`,
    );
  }
}

function containsGeneralApplicationType(
  field: import("./model.ts").FieldDefinition,
  allowObjectMap: boolean,
):
  import("./model.ts").FieldDefinition | undefined {
  if (field.nullable === true) return field;
  if (field.type === "map") {
    if (!allowObjectMap || field.values.type !== "object") return field;
    return containsGeneralApplicationType(field.values, allowObjectMap);
  }
  if (field.type === "object") {
    for (const nested of Object.values(field.properties)) {
      const unsupported = containsGeneralApplicationType(nested, allowObjectMap);
      if (unsupported) return unsupported;
    }
  }
  if (field.type === "array") return containsGeneralApplicationType(field.items, allowObjectMap);
  return undefined;
}

export function listTargetAdapters(): TargetAdapter[] {
  return [...adapters.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function registerTargetAdapter(adapter: TargetAdapter): void {
  if (!/^[a-z][a-z0-9-]*$/.test(adapter.id)) {
    throw new Error(`Invalid target ID: ${adapter.id}`);
  }
  if (adapters.has(adapter.id)) {
    throw new Error(`Target is already registered: ${adapter.id}`);
  }
  adapters.set(adapter.id, adapter);
}

export function getTargetAdapter(id: string): TargetAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(
      `Unsupported target: ${id}. Available targets: ${listTargetAdapters().map((item) => item.id).join(", ")}`,
    );
  }
  return adapter;
}

export function validateTargetProfile(adapter: TargetAdapter, value: unknown): unknown {
  return adapter.validateProfile ? adapter.validateProfile(value) : value;
}

export function describeTarget(adapter: TargetAdapter) {
  return {
    id: adapter.id,
    description: adapter.description,
    profile: {
      required: adapter.profileRequired,
      schema: adapter.profileSchema ?? null,
    },
    capabilities: {
      generate: true,
      flatBatch: adapter.supportsFlatBatch,
    },
    extensions: {
      consumes: [...(adapter.consumesExtensions ?? [])].sort(),
    },
  };
}
