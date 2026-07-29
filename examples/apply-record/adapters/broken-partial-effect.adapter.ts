import correctAdapter from "./correct.adapter.ts";
import type { OperationAdapter } from "../../../src/model.ts";

const adapter: OperationAdapter = {
  name: "broken-partial-effect",
  async execute(request) {
    const result = await correctAdapter.execute(request);
    if (!result.ok) return result;
    const state = structuredClone(result.state);
    (state.capacity as { remaining: number }).remaining = (
      request.state.capacity as { remaining: number }
    ).remaining;
    return { ...result, state };
  },
};

export default adapter;
