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

const unityDefaultProfile: UnityTargetProfile = {
  protocol: "crdd-ir/unity-target-v0.1",
  unityVersion: "6000.0.0f1",
  namespace: "Crdd.Generated",
  apiCompatibility: "netstandard2.1",
  scriptingBackend: "il2cpp",
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
  ["unreal", {
    id: "unreal",
    description: "Unreal Engine C++ contract, bridge, tests, and reflection adapters",
    profileSchema: "schemas/unreal-target-profile.schema.json",
    profileRequired: true,
    supportsFlatBatch: true,
    validateProfile: validateUnrealTargetProfile,
    generate: ({ compilation, profile, operationIndex }) => {
      const unrealProfile = profile as UnrealTargetProfile | undefined;
      return [
        ...generateUnreal(compilation.ir, unrealProfile ? {
          irSha256: compilation.digest,
          generatorVersion: "0.2.1",
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
    generate: ({ compilation, profile }) =>
      generateUnity(
        compilation.ir,
        (profile as UnityTargetProfile | undefined) ?? unityDefaultProfile,
        { irSha256: compilation.digest, generatorVersion: "0.2.1" },
      ),
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
