import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { simulate } from "./simulator.ts";
import type { CrddIr, OperationAdapter, SimulationResult } from "./model.ts";

export function createReferenceAdapter(ir: CrddIr): OperationAdapter {
  return {
    name: "reference-simulator",
    execute(request) {
      return simulate(ir, request);
    },
  };
}

export async function loadAdapter(path: string): Promise<OperationAdapter> {
  const url = pathToFileURL(resolve(path)).href;
  const module = await import(url);
  const candidate = module.default ?? module.adapter;
  if (!isAdapter(candidate)) {
    throw new Error(
      `Adapter "${path}" must export default or named "adapter" with name and execute(request)`,
    );
  }
  return candidate;
}

export function assertSimulationResult(value: unknown, adapterName: string): asserts value is SimulationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Adapter "${adapterName}" returned a non-object result`);
  }
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== "boolean") {
    throw new Error(`Adapter "${adapterName}" result is missing boolean "ok"`);
  }
  if (typeof result.state !== "object" || result.state === null || Array.isArray(result.state)) {
    throw new Error(`Adapter "${adapterName}" result is missing object "state"`);
  }
  if (!Array.isArray(result.traces) || result.traces.some((trace) => typeof trace !== "string")) {
    throw new Error(`Adapter "${adapterName}" result is missing string array "traces"`);
  }
  if (result.ok === false && (typeof result.error !== "string" || typeof result.failedRequirement !== "string")) {
    throw new Error(`Adapter "${adapterName}" failure result is missing error information`);
  }
}

function isAdapter(value: unknown): value is OperationAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OperationAdapter).name === "string" &&
    typeof (value as OperationAdapter).execute === "function"
  );
}
