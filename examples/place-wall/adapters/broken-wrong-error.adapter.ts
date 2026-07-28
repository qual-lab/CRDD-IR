import correctAdapter from "./correct.adapter.ts";
import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-wrong-error",
  async execute(request) {
    const result = await correctAdapter.execute(request);
    if (!result.ok && result.error === "WALL_TOO_SHORT") {
      return {
        ...result,
        error: "INSUFFICIENT_BUDGET",
        traces: ["DEC-WALL-003"],
      };
    }
    return result;
  },
};

export default adapter;
