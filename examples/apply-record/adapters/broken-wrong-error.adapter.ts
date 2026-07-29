import correctAdapter from "./correct.adapter.ts";
import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-wrong-error",
  async execute(request) {
    const result = await correctAdapter.execute(request);
    if (!result.ok && result.error === "RECORD_TOO_SMALL") {
      return {
        ...result,
        error: "INSUFFICIENT_CAPACITY",
        traces: ["DEC-CAPACITY-001"],
      };
    }
    return result;
  },
};

export default adapter;
