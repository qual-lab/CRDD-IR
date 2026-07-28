import { createHash } from "node:crypto";
import type { ConformanceBundle, CrddIr, TestManifest } from "./model.ts";
import type { GeneratedFile } from "./unreal.ts";

export type TraceabilityManifest = {
  protocol: "crdd-ir/traceability-v0.1";
  operation: string;
  source: {
    path: string;
    irSha256: string;
  };
  generatedFiles: Array<{
    path: string;
    sha256: string;
    traces: string[];
  }>;
  requirements: Array<{
    id: string;
    error: string;
    traces: string[];
    testCases: string[];
  }>;
  conformance: {
    protocol: string;
    sha256: string;
    cases: Array<{
      id: string;
      sourceRequirement?: string;
      traces: string[];
    }>;
  };
};

export function generateTraceabilityManifest(
  ir: CrddIr,
  sourcePath: string,
  irDigest: string,
  generatedFiles: GeneratedFile[],
  testManifest: TestManifest,
  bundle: ConformanceBundle,
): TraceabilityManifest {
  const errorTraces = new Map(ir.operation.errors.map((error) => [error.code, error.traces]));
  const requirementTraces = new Map(
    ir.operation.requires.map((requirement) => [
      requirement.id,
      errorTraces.get(requirement.error) ?? ir.operation.traces,
    ]),
  );

  return {
    protocol: "crdd-ir/traceability-v0.1",
    operation: ir.operation.id,
    source: { path: normalizePath(sourcePath), irSha256: irDigest },
    generatedFiles: generatedFiles.map((file) => ({
      path: `unreal/${file.name}`,
      sha256: file.sha256,
      traces: [...ir.operation.traces],
    })),
    requirements: ir.operation.requires.map((requirement) => ({
      id: requirement.id,
      error: requirement.error,
      traces: [...(requirementTraces.get(requirement.id) ?? [])],
      testCases: testManifest.cases
        .filter((testCase) => testCase.sourceRequirement === requirement.id)
        .map((testCase) => testCase.id),
    })),
    conformance: {
      protocol: bundle.protocol,
      sha256: sha256(canonicalJson(bundle)),
      cases: bundle.cases.map((testCase) => ({
        id: testCase.id,
        ...(testCase.sourceRequirement ? { sourceRequirement: testCase.sourceRequirement } : {}),
        traces: testCase.sourceRequirement
          ? [...(requirementTraces.get(testCase.sourceRequirement) ?? [])]
          : [...ir.operation.traces],
      })),
    },
  };
}

export function generateEvidenceMarkdown(manifest: TraceabilityManifest): string {
  const requirementRows = manifest.requirements
    .map(
      (requirement) =>
        `| ${requirement.id} | ${requirement.error} | ${requirement.traces.join(", ")} | ${requirement.testCases.join(", ")} |`,
    )
    .join("\n");
  const artifactRows = manifest.generatedFiles
    .map((file) => `| ${file.path} | \`${file.sha256}\` | ${file.traces.join(", ")} |`)
    .join("\n");

  return `# CRDD IR Conformance Evidence: ${manifest.operation}

- Protocol: \`${manifest.protocol}\`
- Source: \`${manifest.source.path}\`
- Internal IR SHA-256: \`${manifest.source.irSha256}\`
- Conformance Bundle SHA-256: \`${manifest.conformance.sha256}\`
- Conformance Cases: ${manifest.conformance.cases.length}

## Requirement Coverage

| Requirement | Error | CRDD IDs | Test Cases |
| --- | --- | --- | --- |
${requirementRows}

## Generated Artifacts

| Artifact | SHA-256 | CRDD IDs |
| --- | --- | --- |
${artifactRows}
`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
