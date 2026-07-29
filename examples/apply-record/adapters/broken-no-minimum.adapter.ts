import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-no-minimum-length",
  execute(request) {
    const state = structuredClone(request.state);
    const amount = request.input.amount as number;
    if ((state.capacity as { remaining: number }).remaining < amount) {
      return {
        ok: false,
        operation: "ApplyRecord",
        error: "INSUFFICIENT_CAPACITY",
        failedRequirement: "sufficient-capacity",
        state,
        traces: ["DEC-CAPACITY-001"],
      };
    }
    (state.records as unknown[]).push({ length: request.input.length, amount });
    (state.capacity as { remaining: number }).remaining -= amount;
    return {
      ok: true,
      operation: "ApplyRecord",
      state,
      traces: ["REQ-RECORD-001", "DEC-CAPACITY-001"],
    };
  },
};

export default adapter;
