import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-no-minimum-length",
  execute(request) {
    const state = structuredClone(request.state);
    const cost = request.input.cost as number;
    if ((state.budget as { remaining: number }).remaining < cost) {
      return {
        ok: false,
        operation: "CreateEntity",
        error: "INSUFFICIENT_BUDGET",
        failedRequirement: "sufficient-budget",
        state,
        traces: ["DEC-ENTITY-003"],
      };
    }
    (state.entities as unknown[]).push({ length: request.input.length, cost });
    (state.budget as { remaining: number }).remaining -= cost;
    return {
      ok: true,
      operation: "CreateEntity",
      state,
      traces: ["REQ-ENTITY-001", "DEC-ENTITY-003"],
    };
  },
};

export default adapter;
