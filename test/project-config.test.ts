import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_CONFIG_PROTOCOL,
  validateProjectConfig,
} from "../src/project-config.ts";

function validConfig() {
  return {
    protocol: PROJECT_CONFIG_PROTOCOL,
    toolRoot: "tools/CRDD-IR",
    source: "05_SPEC/01_Behavior_Specification.md",
    generatedSource: "40_Develop/Generated/Source",
    generatedAssets: "40_Develop/Generated/Assets",
    evidence: "07_Quality/CRDD_IR",
    unreal: null,
  };
}

test("accepts a complete project configuration", () => {
  assert.deepEqual(validateProjectConfig(validConfig()), validConfig());
});

test("accepts multiple sources with an explicit asset source", () => {
  const config = {
    ...validConfig(),
    source: ["05_SPEC/create.md", "05_SPEC/update.md"],
    assetSource: "05_SPEC/create.md",
  };
  assert.deepEqual(validateProjectConfig(config), config);
});

test("rejects duplicate sources and an asset source outside the source set", () => {
  assert.throws(
    () => validateProjectConfig({
      ...validConfig(),
      source: ["05_SPEC/spec.md", "05_SPEC/spec.md"],
    }),
    /must not contain duplicates/,
  );
  assert.throws(
    () => validateProjectConfig({
      ...validConfig(),
      source: ["05_SPEC/create.md", "05_SPEC/update.md"],
      assetSource: "05_SPEC/assets.md",
    }),
    /must also be listed/,
  );
});

test("rejects unknown project configuration fields", () => {
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), typo: true }),
    /unknown field\(s\): typo/,
  );
});

test("rejects project paths that escape the project root", () => {
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), generatedAssets: "../outside" }),
    /must not escape the project root/,
  );
  assert.throws(
    () => validateProjectConfig({ ...validConfig(), source: "C:/outside/spec.md" }),
    /must be relative to the project root/,
  );
});

test("validates Unreal configuration fields", () => {
  assert.throws(
    () => validateProjectConfig({
      ...validConfig(),
      unreal: {
        project: "Game/Game.uproject",
        engineRoot: "C:/Program Files/Epic Games/UE_5.8",
        editorTarget: "GameEditor",
        configuration: "Fast",
        integrationPlugin: "CRDDIRIntegration",
      },
    }),
    /configuration is not supported/,
  );
});
