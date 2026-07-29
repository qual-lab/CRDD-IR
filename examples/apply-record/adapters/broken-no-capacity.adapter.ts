import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-no-capacity-check",
  execute(request) {
    const state = structuredClone(request.state);
    const length = request.input.length as number;
    const amount = request.input.amount as number;
    if (length < 0.3) {
      return {
        ok: false,
        operation: "ApplyRecord",
        error: "RECORD_TOO_SMALL",
        failedRequirement: "minimum-record-length",
        state,
        traces: ["REQ-RECORD-001"],
      };
    }
    (state.records as unknown[]).push({ length, amount });
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
