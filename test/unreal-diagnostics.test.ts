import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUnrealDiagnostics } from "../src/unreal-diagnostics.ts";

test("normalizes compiler and Cook diagnostics without machine identity", () => {
  const diagnostics = normalizeUnrealDiagnostics(
    [
      "C:\\project\\Generated\\Operation.cpp(42): error C2039: member is missing",
      "LogCook: Error: Package /Game/Missing was not found on DESKTOP-ABC123",
    ].join("\n"),
    "contracts/operation.md",
  );
  assert.equal(diagnostics[0].stableCode, "CRDD_UNREAL_COMPILER_C2039");
  assert.equal(diagnostics[0].generated?.path, "Operation.cpp");
  assert.equal(diagnostics[0].sourceContract?.path, "contracts/operation.md");
  assert.equal(diagnostics[1].stableCode, "CRDD_UNREAL_COOK_ASSET");
  assert.doesNotMatch(JSON.stringify(diagnostics), /C:\\project|DESKTOP-ABC123/);
});
