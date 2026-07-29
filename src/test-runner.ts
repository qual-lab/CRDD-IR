import { assertSimulationResult, createReferenceAdapter } from "./adapter.ts";
import { simulate } from "./simulator.ts";
import type { CrddIr, OperationAdapter, SimulationResult, TestManifest, TestRunReport } from "./model.ts";
import { isDeepStrictEqual } from "node:util";

export async function runTestManifest(
  ir: CrddIr,
  manifest: TestManifest,
  adapter: OperationAdapter = createReferenceAdapter(ir),
): Promise<TestRunReport> {
  if (manifest.operation !== ir.operation.id) {
    throw new Error(
      `Manifest operation "${manifest.operation}" does not match IR operation "${ir.operation.id}"`,
    );
  }

  const results = await Promise.all(manifest.cases.map(async (testCase) => {
    const reference = simulate(ir, structuredClone(testCase.arrange));
    let actual: SimulationResult;
    try {
      const rawResult: unknown = await adapter.execute(structuredClone(testCase.arrange));
      assertSimulationResult(rawResult, adapter.name);
      actual = rawResult;
    } catch (error) {
      return {
        id: testCase.id,
        passed: false,
        message: `adapter threw: ${(error as Error).message}`,
        traces: manifest.traces,
      };
    }

    const failures: string[] = [];
    if (actual.ok !== testCase.expect.ok) {
      failures.push(`expected ok=${testCase.expect.ok}, got ok=${actual.ok}`);
    }
    if (!actual.ok && testCase.expect.error !== undefined && actual.error !== testCase.expect.error) {
      failures.push(`expected error=${testCase.expect.error}, got error=${actual.error}`);
    }
    if (actual.ok && reference.ok && !deepEqual(actual.state, reference.state)) {
      failures.push("final state differs from reference semantics");
    }
    if (!actual.ok && !reference.ok && actual.error !== reference.error) {
      failures.push(`reference error=${reference.error}, got error=${actual.error}`);
    }
    if (testCase.expect.stateUnchanged === true && !deepEqual(actual.state, testCase.arrange.state)) {
      failures.push("expected complete state rollback");
    }
    const missingTraces = reference.traces.filter((trace) => !actual.traces.includes(trace));
    if (missingTraces.length > 0) {
      failures.push(`missing trace IDs: ${missingTraces.join(", ")}`);
    }

    return {
      id: testCase.id,
      passed: failures.length === 0,
      message: failures.length === 0 ? "contract satisfied" : failures.join("; "),
      traces: actual.traces,
    };
  }));

  const passed = results.filter((result) => result.passed).length;
  return {
    operation: manifest.operation,
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
  };
}

function deepEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}
