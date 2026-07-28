import assert from "node:assert/strict";
import test from "node:test";
import { generateUnrealReflection } from "../src/unreal-uht.ts";
import type { UnrealTargetPlan } from "../src/unreal-target.ts";

test("generates UHT-safe reflected declarations with generated include last", () => {
  const declaration = {
    kind: "UCLASS" as const,
    name: "UCrddService",
    module: "CRDDIRRuntime",
    apiMacro: "CRDDIRRUNTIME_API",
    base: "UObject",
    generatedBody: true,
    generatedHeaderLast: true,
    metadata: { BlueprintType: true },
    properties: [{
      name: "Asset",
      cppType: "TSoftObjectPtr<UObject>",
      specifiers: ["BlueprintReadOnly" as const],
      reference: "soft-object" as const,
    }],
    functions: [{
      name: "IsReady",
      returnType: "bool",
      parameters: [],
      specifiers: ["BlueprintPure" as const],
      metadata: { Category: "CRDD" },
    }],
  };
  const files = generateUnrealReflection({
    adapter: { declarations: [declaration] },
  } as UnrealTargetPlan);
  const header = files[0].content;
  assert.match(header, /UCLASS\(BlueprintType\)/);
  assert.match(header, /class CRDDIRRUNTIME_API UCrddService : public UObject/);
  assert.match(header, /UPROPERTY\(BlueprintReadOnly\)/);
  assert.match(header, /UFUNCTION\(BlueprintPure, meta=\(Category="CRDD"\)\)/);
  const includes = header.split("\n").filter((line) => line.startsWith("#include"));
  assert.match(includes.at(-1) ?? "", /\.generated\.h"$/);
});
