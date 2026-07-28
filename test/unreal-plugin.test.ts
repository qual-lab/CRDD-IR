import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = new URL(
  "../templates/unreal/CRDDIRIntegration/",
  import.meta.url,
);

test("separates Unreal runtime and editor module dependencies", async () => {
  const descriptor = JSON.parse(await readFile(
    fileURLToPath(new URL("CRDDIRIntegration.uplugin", pluginRoot)),
    "utf8",
  ));
  assert.deepEqual(
    descriptor.Modules.map((module: { Name: string; Type: string }) => [
      module.Name,
      module.Type,
    ]),
    [
      ["CRDDIRRuntime", "Runtime"],
      ["CRDDIRIntegration", "Editor"],
    ],
  );

  const runtimeRules = await readFile(
    fileURLToPath(new URL(
      "Source/CRDDIRRuntime/CRDDIRRuntime.Build.cs",
      pluginRoot,
    )),
    "utf8",
  );
  assert.doesNotMatch(
    runtimeRules,
    /UnrealEd|PythonScriptPlugin|EditorScriptingUtilities/,
  );
});

test("guards background work with cancellation and a weak UObject owner", async () => {
  const runtime = await readFile(
    fileURLToPath(new URL(
      "Source/CRDDIRRuntime/Private/CRDDIRAsync.cpp",
      pluginRoot,
    )),
    "utf8",
  );
  assert.match(runtime, /EAsyncExecution::ThreadPool/);
  assert.match(runtime, /ENamedThreads::GameThread/);
  assert.match(runtime, /TWeakObjectPtr<UObject>/);
  assert.match(runtime, /Cancelled->Load\(\)/);
  assert.match(runtime, /WeakOwner\.IsValid\(\)/);
});

test("loads runtime assets through Unreal Asset Manager", async () => {
  const loader = await readFile(
    fileURLToPath(new URL(
      "Source/CRDDIRRuntime/Private/CRDDIRAssetLoader.cpp",
      pluginRoot,
    )),
    "utf8",
  );
  assert.match(loader, /UAssetManager::Get\(\)\.LoadPrimaryAsset/);
  assert.match(loader, /GetPrimaryAssetObject/);
  assert.match(loader, /TWeakObjectPtr<UObject>/);
  assert.match(loader, /check\(IsInGameThread\(\)\)/);
});
