import type { OperationAdapter, SimulationRequest, SimulationResult } from "../../../src/model.ts";

const traces = ["REQ-ENTITY-001", "DEC-ENTITY-003"];

const adapter: OperationAdapter = {
  name: "create-entity-correct",
  execute(request: SimulationRequest): SimulationResult {
    const length = request.input.length as number;
    const cost = request.input.cost as number;
    const state = structuredClone(request.state);
    const budget = (state.budget as { remaining: number }).remaining;

    if (length < 0.3) {
      return failure("ENTITY_TOO_SHORT", "minimum-entity-length", request.state, ["REQ-ENTITY-001"]);
    }
    if (budget < cost) {
      return failure("INSUFFICIENT_BUDGET", "sufficient-budget", request.state, ["DEC-ENTITY-003"]);
    }

    (state.entities as unknown[]).push({ length, cost });
    (state.budget as { remaining: number }).remaining -= cost;
    return { ok: true, operation: "CreateEntity", state, traces };
  },
};

export default adapter;

function failure(
  error: string,
  failedRequirement: string,
  state: Record<string, unknown>,
  failureTraces: string[],
): SimulationResult {
  return {
    ok: false,
    operation: "CreateEntity",
    error,
    failedRequirement,
    state: structuredClone(state),
    traces: failureTraces,
  };
}
