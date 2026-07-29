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
  protocol: "crdd-ir/target-parity-v0.2";
  requirements: string[];
  operation: string;
  irSha256: string;
  conformanceSha256: string;
  portableRulesSha256: string;
  targets: Array<{
    id: "unreal" | "unity";
    profileSha256: string;
    irSha256: string;
    conformanceSha256: string;
    portableRulesSha256: string;
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
    sharedPortableRuleSemantics: boolean;
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
  const portableRulesSha256 = sha256(canonicalJson(compilation.ir.operation.portableRules ?? []));
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
    sharedPortableRuleSemantics:
      new Set(targets.map((target) => target.portableRulesSha256)).size === 1 &&
      targets[0].portableRulesSha256 === portableRulesSha256,
  };
  return {
    protocol: "crdd-ir/target-parity-v0.2",
    requirements: parityRequirements(compilation),
    operation: compilation.ir.operation.id,
    irSha256: compilation.digest,
    conformanceSha256,
    portableRulesSha256,
    targets,
    numericProjections,
    checks,
    equivalent: Object.values(checks).every(Boolean),
  };
}

function parityRequirements(compilation: CompilationResult): string[] {
  const requirements = ["IR-TARGET-001", "IR-PARITY-001"];
  const kinds = new Set((compilation.ir.operation.portableRules ?? []).map((rule) => rule.kind));
  if ([...kinds].some((kind) => kind.startsWith("collection."))) requirements.push("IR-COLLECTION-001");
  if (kinds.has("opaque.integrity")) requirements.push("IR-OPAQUE-001");
  if (
    kinds.has("opaque.immutable-when-inactive") ||
    kinds.has("opaque.reject-edit-when-inactive")
  ) requirements.push("IR-IMMUTABLE-001");
  return requirements;
}

function targetEvidence(
  id: "unreal" | "unity",
  profile: UnrealTargetProfile | UnityTargetProfile,
  files: Array<{ name: string; content: string }>,
  irSha256: string,
  conformanceSha256: string,
) {
  const portableRulesSha256 = portableSemanticsDigestFromGenerated(files);
  return {
    id,
    profileSha256: sha256(canonicalJson(profile)),
    irSha256,
    conformanceSha256,
    portableRulesSha256,
    generatedFiles: files
      .map((file) => ({ path: file.name, sha256: generatedTextSha256(file.content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function portableSemanticsDigestFromGenerated(
  files: Array<{ name: string; content: string }>,
): string {
  const markers = files.flatMap((file) =>
    [...file.content.matchAll(/CRDD-PORTABLE-SEMANTICS:\s*([A-Za-z0-9+/=]+)/g)]
      .map((match) => JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as unknown)
  );
  return sha256(canonicalJson(markers));
}

function collectNumericUnits(
  ...collections: Array<Record<string, FieldDefinition>>
): Set<string> {
  const units = new Set<string>();
  const visit = (field: FieldDefinition) => {
    if (field.type === "number" && field.unit) units.add(field.unit);
    if (field.type === "object") Object.values(field.properties).forEach(visit);
    if (field.type === "array") visit(field.items);
    if (field.type === "map") visit(field.values);
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
