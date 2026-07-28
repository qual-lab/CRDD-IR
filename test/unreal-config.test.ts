import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUnrealConfigPatches,
  removeUnrealConfigOwner,
  renderUnrealConfigEdits,
} from "../src/unreal-config.ts";

const patches = [{
  file: "DefaultGame.ini",
  section: "/Script/Engine.AssetManagerSettings",
  key: "PrimaryAssetTypesToScan",
  operation: "add" as const,
  value: "(PrimaryAssetType=\"CRDD\")",
  owner: "CRDDIRIntegration",
}];

test("owns only a deterministic Unreal Config block", () => {
  const current = "[/Script/Game.UserSettings]\nUserValue=Keep\n";
  const first = applyUnrealConfigPatches(current, patches);
  const second = applyUnrealConfigPatches(first, patches);
  assert.equal(first, second);
  assert.match(first, /UserValue=Keep/);
  assert.match(first, /; CRDD-IR:CRDDIRIntegration:BEGIN/);
  assert.match(first, /\+PrimaryAssetTypesToScan=/);
  assert.equal(removeUnrealConfigOwner(first, "CRDDIRIntegration"), current);
});

test("rejects unmanaged Config keys instead of silently overriding them", () => {
  assert.throws(
    () => applyUnrealConfigPatches(
      "[/Script/Engine.AssetManagerSettings]\nPrimaryAssetTypesToScan=UserOwned\n",
      patches,
    ),
    /Unmanaged Unreal Config conflict/,
  );
});

test("routes platform-specific Config patches without owning whole files", () => {
  assert.deepEqual(
    renderUnrealConfigEdits({}, [{
      ...patches[0],
      platform: "Windows",
    }]).map((edit) => edit.file),
    ["Config/Windows/DefaultGame.ini"],
  );
});
