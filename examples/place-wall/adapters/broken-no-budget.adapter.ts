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
        operation: "PlaceWall",
        error: "WALL_TOO_SHORT",
        failedRequirement: "minimum-wall-length",
        state,
        traces: ["REQ-WALL-001"],
      };
    }
    (state.walls as unknown[]).push({ length, cost });
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
