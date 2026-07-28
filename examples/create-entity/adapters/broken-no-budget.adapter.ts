import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-no-budget-check",
  execute(request) {
    const state = structuredClone(request.state);
    const length = request.input.length as number;
    const cost = request.input.cost as number;
    if (length < 0.3) {
      return {
        ok: false,
        operation: "CreateEntity",
        error: "ENTITY_TOO_SHORT",
        failedRequirement: "minimum-entity-length",
        state,
        traces: ["REQ-ENTITY-001"],
      };
    }
    (state.entities as unknown[]).push({ length, cost });
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
