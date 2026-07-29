import type { OperationAdapter, SimulationRequest, SimulationResult } from "../../../src/model.ts";

const traces = ["REQ-RECORD-001", "DEC-CAPACITY-001"];

const adapter: OperationAdapter = {
  name: "apply-record-correct",
  execute(request: SimulationRequest): SimulationResult {
    const length = request.input.length as number;
    const amount = request.input.amount as number;
    const state = structuredClone(request.state);
    const capacity = (state.capacity as { remaining: number }).remaining;

    if (length < 0.3) {
      return failure("RECORD_TOO_SMALL", "minimum-record-length", request.state, ["REQ-RECORD-001"]);
    }
    if (capacity < amount) {
      return failure("INSUFFICIENT_CAPACITY", "sufficient-capacity", request.state, ["DEC-CAPACITY-001"]);
    }

    (state.records as unknown[]).push({ length, amount });
    (state.capacity as { remaining: number }).remaining -= amount;
    return { ok: true, operation: "ApplyRecord", state, traces };
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
    operation: "ApplyRecord",
    error,
    failedRequirement,
    state: structuredClone(state),
    traces: failureTraces,
  };
}
