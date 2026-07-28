import type { OperationAdapter, SimulationRequest, SimulationResult } from "../../../src/model.ts";

const traces = ["REQ-WALL-001", "DEC-WALL-003"];

const adapter: OperationAdapter = {
  name: "place-wall-correct",
  execute(request: SimulationRequest): SimulationResult {
    const length = request.input.length as number;
    const cost = request.input.cost as number;
    const state = structuredClone(request.state);
    const budget = (state.budget as { remaining: number }).remaining;

    if (length < 0.3) {
      return failure("WALL_TOO_SHORT", "minimum-wall-length", request.state, ["REQ-WALL-001"]);
    }
    if (budget < cost) {
      return failure("INSUFFICIENT_BUDGET", "sufficient-budget", request.state, ["DEC-WALL-003"]);
    }

    (state.walls as unknown[]).push({ length, cost });
    (state.budget as { remaining: number }).remaining -= cost;
    return { ok: true, operation: "PlaceWall", state, traces };
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
    operation: "PlaceWall",
    error,
    failedRequirement,
    state: structuredClone(state),
    traces: failureTraces,
  };
}
