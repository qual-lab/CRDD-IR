import { simulate } from "./simulator.ts";
import type { ConformanceBundle, CrddIr, TestManifest } from "./model.ts";

export function generateConformanceBundle(ir: CrddIr, manifest: TestManifest): ConformanceBundle {
  if (manifest.operation !== ir.operation.id) {
    throw new Error(
      `Manifest operation "${manifest.operation}" does not match IR operation "${ir.operation.id}"`,
    );
  }

  return {
    protocol: "crdd-ir/conformance-v0.1",
    operation: ir.operation.id,
    traces: ir.operation.traces,
    cases: manifest.cases.map((testCase) => ({
      id: testCase.id,
      description: testCase.description,
      ...(testCase.sourceRequirement ? { sourceRequirement: testCase.sourceRequirement } : {}),
      request: structuredClone(testCase.arrange),
      expected: simulate(ir, structuredClone(testCase.arrange)),
    })),
  };
}
