import { createHash } from "node:crypto";
import type { CompilationResult } from "./compiler.ts";
import { generateConformanceBundle } from "./conformance.ts";
import { generatedTextSha256 } from "./content-hash.ts";
import type { FieldDefinition } from "./model.ts";
import { getTargetAdapter } from "./target-registry.ts";
import { generateTestManifest } from "./test-manifest.ts";
import type { UnityNumericProjection, UnityTargetProfile } from "./unity-target.ts";
import type { UnrealNumericProjection, UnrealTargetProfile } from "./unreal-target.ts";

type NormalizedNumericProjection = {
  kind: "signed-integer" | "binary-float";
  bits: 32 | 64;
  jsonRepresentation: "number" | "decimal-string";
  rounding: "reject" | "nearest" | "floor" | "ceil";
  overflow: "error" | "clamp";
};

export type TargetParityReport = {
  protocol: "crdd-ir/target-parity-v0.1";
  requirements: ["IR-TARGET-001", "IR-PARITY-001"];
  operation: string;
  irSha256: string;
  conformanceSha256: string;
  targets: Array<{
    id: "unreal" | "unity";
    profileSha256: string;
    irSha256: string;
    conformanceSha256: string;
    generatedFiles: Array<{ path: string; sha256: string }>;
  }>;
  numericProjections: Array<{
    unit: string;
    unreal: NormalizedNumericProjection;
    unity: NormalizedNumericProjection;
    equivalent: boolean;
  }>;
  checks: {
    independentTargetOutputs: boolean;
    sharedSourceIr: boolean;
    sharedConformanceSemantics: boolean;
    equivalentNumericProjections: boolean;
  };
  equivalent: boolean;
};

export function verifyTargetParity(
  compilation: CompilationResult,
  unrealProfile: UnrealTargetProfile,
  unityProfile: UnityTargetProfile,
): TargetParityReport {
  const unrealFiles = getTargetAdapter("unreal").generate({
    compilation,
    profile: unrealProfile,
    operationIndex: 0,
  });
  const unityFiles = getTargetAdapter("unity").generate({
    compilation,
    profile: unityProfile,
    operationIndex: 0,
  });
  const conformance = generateConformanceBundle(
    compilation.ir,
    generateTestManifest(compilation.ir),
  );
  const conformanceSha256 = sha256(canonicalJson(conformance));
  const units = collectNumericUnits(compilation.ir.operation.input, compilation.ir.operation.state);
  const numericProjections = [...units].sort().map((unit) => {
    const unreal = normalizeUnreal(unrealProfile.numericProjection?.[unit]);
    const unity = normalizeUnity(unityProfile.numericProjection?.[unit]);
    return {
      unit,
      unreal,
      unity,
      equivalent: canonicalJson(unreal) === canonicalJson(unity),
    };
  });
  const independentTargetOutputs =
    unrealFiles.every((file) => /\.(?:h|cpp)$/.test(file.name) && !/UnityEngine/.test(file.content)) &&
    unityFiles.every((file) => /\.cs$/.test(file.name) && !/\bUObject\b|#include/.test(file.content));
  const targets = [
    targetEvidence("unreal", unrealProfile, unrealFiles, compilation.digest, conformanceSha256),
    targetEvidence("unity", unityProfile, unityFiles, compilation.digest, conformanceSha256),
  ];
  const checks = {
    independentTargetOutputs,
    sharedSourceIr: new Set(targets.map((target) => target.irSha256)).size === 1 &&
      targets[0].irSha256 === compilation.digest,
    sharedConformanceSemantics:
      new Set(targets.map((target) => target.conformanceSha256)).size === 1 &&
      targets[0].conformanceSha256 === conformanceSha256,
    equivalentNumericProjections: numericProjections.every((item) => item.equivalent),
  };
  return {
    protocol: "crdd-ir/target-parity-v0.1",
    requirements: ["IR-TARGET-001", "IR-PARITY-001"],
    operation: compilation.ir.operation.id,
    irSha256: compilation.digest,
    conformanceSha256,
    targets,
    numericProjections,
    checks,
    equivalent: Object.values(checks).every(Boolean),
  };
}

function targetEvidence(
  id: "unreal" | "unity",
  profile: UnrealTargetProfile | UnityTargetProfile,
  files: Array<{ name: string; content: string }>,
  irSha256: string,
  conformanceSha256: string,
) {
  return {
    id,
    profileSha256: sha256(canonicalJson(profile)),
    irSha256,
    conformanceSha256,
    generatedFiles: files
      .map((file) => ({ path: file.name, sha256: generatedTextSha256(file.content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function collectNumericUnits(
  ...collections: Array<Record<string, FieldDefinition>>
): Set<string> {
  const units = new Set<string>();
  const visit = (field: FieldDefinition) => {
    if (field.type === "number" && field.unit) units.add(field.unit);
    if (field.type === "object") Object.values(field.properties).forEach(visit);
    if (field.type === "array") visit(field.items);
  };
  collections.forEach((collection) => Object.values(collection).forEach(visit));
  return units;
}

function normalizeUnreal(
  projection?: UnrealNumericProjection,
): NormalizedNumericProjection {
  if (!projection) {
    return {
      kind: "binary-float",
      bits: 64,
      jsonRepresentation: "number",
      rounding: "nearest",
      overflow: "error",
    };
  }
  const type = {
    int32: { kind: "signed-integer" as const, bits: 32 as const },
    int64: { kind: "signed-integer" as const, bits: 64 as const },
    float: { kind: "binary-float" as const, bits: 32 as const },
    double: { kind: "binary-float" as const, bits: 64 as const },
  }[projection.cppType];
  return {
    ...type,
    jsonRepresentation: projection.jsonRepresentation,
    rounding: projection.rounding === "reject-lossy" ? "reject" : projection.rounding,
    overflow: projection.overflow,
  };
}

function normalizeUnity(
  projection?: UnityNumericProjection,
): NormalizedNumericProjection {
  if (!projection) {
    return {
      kind: "binary-float",
      bits: 64,
      jsonRepresentation: "number",
      rounding: "nearest",
      overflow: "error",
    };
  }
  const type = {
    int: { kind: "signed-integer" as const, bits: 32 as const },
    long: { kind: "signed-integer" as const, bits: 64 as const },
    double: { kind: "binary-float" as const, bits: 64 as const },
  }[projection.csharpType];
  return {
    ...type,
    jsonRepresentation: projection.jsonRepresentation,
    rounding: projection.rounding,
    overflow: projection.overflow,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
