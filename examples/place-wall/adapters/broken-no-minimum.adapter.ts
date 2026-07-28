import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-no-minimum-length",
  execute(request) {
    const state = structuredClone(request.state);
    const cost = request.input.cost as number;
    if ((state.budget as { remaining: number }).remaining < cost) {
      return {
        ok: false,
        operation: "PlaceWall",
        error: "INSUFFICIENT_BUDGET",
        failedRequirement: "sufficient-budget",
        state,
        traces: ["DEC-WALL-003"],
      };
    }
    (state.walls as unknown[]).push({ length: request.input.length, cost });
    (state.budget as { remaining: number }).remaining -= cost;
    return {
      ok: true,
      operation: "PlaceWall",
      state,
      traces: ["REQ-WALL-001", "DEC-WALL-003"],
    };
  },
};

export default adapter;
