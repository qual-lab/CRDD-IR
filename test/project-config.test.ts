import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_CONFIG_PROTOCOL, validateProjectConfig } from "../src/project-config.ts";

function validConfig() {
  return {
    protocol: PROJECT_CONFIG_PROTOCOL,
    toolRoot: "tools/CRDD-IR",
    sources: ["contracts/change.md"],
    evidence: "quality/crdd-ir",
    targets: {
      typescript: { output: "generated/typescript" },
    },
  };
}

test("accepts a target-neutral project configuration", () => {
  assert.deepEqual(validateProjectConfig(validConfig()), validConfig());
});

test("accepts independent target outputs, profiles, and options", () => {
  const config = {
    ...validConfig(),
    targets: {
      typescript: { output: "generated/typescript" },
      adapter: {
        output: "generated/adapter",
        profile: "config/adapter.json",
        options: { mode: "strict" },
      },
    },
  };
  assert.deepEqual(validateProjectConfig(config), config);
});

test("rejects duplicate sources and invalid target IDs", () => {
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), sources: ["contracts/a.md", "contracts/a.md"] }),
    /must not contain duplicates/,
  );
  assert.throws(
    () => validateProjectConfig({
      ...validConfig(),
      targets: { "Invalid Target": { output: "generated/output" } },
    }),
    /invalid target ID/,
  );
});

test("rejects unknown fields and escaping paths", () => {
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), unreal: null }),
    /unknown field\(s\): unreal/,
  );
  assert.throws(
    () => validateProjectConfig({
      ...validConfig(),
      targets: { typescript: { output: "../outside" } },
    }),
    /must not escape the project root/,
  );
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), sources: ["C:/outside/spec.md"] }),
    /must be relative to the project root/,
  );
});
