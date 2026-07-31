import { createHash } from "node:crypto";
import type { CrddIr, Effect, FieldDefinition, Operation, PortableRule } from "./model.ts";
import { parseSourceExpression, type ExpressionNode } from "./source-expression.ts";
import { generateTestManifest } from "./test-manifest.ts";
import { simulate } from "./simulator.ts";
import type { UnrealNumericProjection } from "./unreal-target.ts";
import { generateUnrealBridge } from "./unreal-bridge.ts";
import { snapshotOwnershipMarker } from "./snapshot-ownership.ts";

export type GeneratedFile = {
  name: string;
  content: string;
  sha256: string;
};

export function generateUnreal(
  ir: CrddIr,
  metadata: {
    irSha256?: string;
    generatorVersion?: string;
    numericProjection?: Record<string, UnrealNumericProjection>;
  } = {},
): GeneratedFile[] {
  const operation = projectNumericTypes(ir.operation, metadata.numericProjection ?? {});
  const operationName = pascalIdentifier(operation.id);

  const files = [
    { name: `${operationName}.generated.h`, content: generateHeader(operation, metadata) },
    { name: `${operationName}.generated.cpp`, content: generateSource(operation, metadata.numericProjection ?? {}) },
    ...generateUnrealBridge(operation),
    ...((operation.portableRules?.length ?? 0) > 0 ||
      operation.effects.some((effect) => effect.when !== undefined) ||
      operation.requires.some((requirement) => requirement.when !== undefined)
      ? [{
          name: `${operationName}Conformance.spec.cpp`,
          content: generatePortableConformanceFixture(ir, operation),
        }]
      : []),
    ...(hasIntegerProjection(operation)
      ? [{
          name: `${operationName}.numeric.generated.spec.cpp`,
          content: generateNumericBoundaryFixture(ir, operation),
        }]
      : []),
  ];
  return files.map((file) => ({
    ...file,
    sha256: createHash("sha256").update(file.content).digest("hex"),
  }));
}

function generateHeader(
  operation: Operation,
  metadata: {
    irSha256?: string;
    generatorVersion?: string;
    numericProjection?: Record<string, UnrealNumericProjection>;
  },
): string {
  const operationName = pascalIdentifier(operation.id);
  const collectionTypes = collectionObjectTypeRegistry(operation);
  const traceComment = traces(operation);
  const errorValues = operation.errors
    .map((error) => `    ${pascalCase(error.code)},`)
    .join("\n");
  const arrayStructs = collectionTypes.definitions
    .map(({ typeName, field }) => generateCollectionElementStruct(typeName, field))
    .join("\n");
  const unionStructs = [
    ...Object.entries(operation.input)
      .filter(([, field]) => field.type === "union")
      .map(([name, field]) => generateUnionStruct(operation, "Input", name, field)),
    ...Object.entries(operation.state)
      .filter(([, field]) => field.type === "union")
      .map(([name, field]) => generateUnionStruct(operation, "State", name, field)),
  ].join("\n");
  const objectStructs = [
    ...Object.entries(operation.input)
      .filter(([, field]) => field.type === "object")
      .map(([name, field]) => generateObjectStruct(operation, "Input", name, field)),
    ...Object.entries(operation.state)
      .filter(([, field]) => field.type === "object")
      .map(([name, field]) => generateObjectStruct(operation, "State", name, field)),
  ].join("\n");
  const opaqueStruct = hasOpaque(operation) ? `struct FCrddOpaqueValue
{
    FString Base64;
    FString Sha256;
    bool bActive = false;
};
` : "";
  const inputFields = Object.entries(operation.input)
    .map(([name, field]) => {
      const type = field.type === "array"
        ? `TArray<${field.items.type === "object"
          ? collectionObjectTypeName(collectionTypes, "Input", name)
          : cppType(field.items)}>`
        : field.type === "map"
          ? `TMap<FString, ${collectionObjectTypeName(collectionTypes, "Input", name)}>`
          : field.type === "object"
            ? objectStructName(operation, "Input", name)
            : field.type === "union"
              ? unionStructName(operation, "Input", name)
            : cppType(field);
      return `    ${type} ${cppField(name, field)}${field.type === "array" || field.type === "map" ? "" : ` = ${cppDefault(field)}`};`;
    })
    .join("\n");
  const stateFields = Object.entries(operation.state)
    .map(([name, field]) => {
      const type =
        field.type === "array"
          ? `TArray<${field.items.type === "object"
            ? collectionObjectTypeName(collectionTypes, "State", name)
            : cppType(field.items)}>`
          : field.type === "map"
            ? `TMap<FString, ${collectionObjectTypeName(collectionTypes, "State", name)}>`
          : field.type === "object"
            ? objectStructName(operation, "State", name)
            : field.type === "union"
              ? unionStructName(operation, "State", name)
            : cppType(field);
      return `    ${type} ${cppField(name, field)}${field.type === "array" || field.type === "map" ? "" : ` = ${cppDefault(field)}`};`;
    })
    .join("\n");

  const generationIdentity = metadata.irSha256
    ? `// CRDD-IR Generator: ${metadata.generatorVersion ?? "unknown"}\n` +
      `// CRDD-IR Input SHA-256: ${metadata.irSha256}\n`
    : "";
  const numericIdentity = Object.entries(metadata.numericProjection ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, projection]) =>
      `// CRDD-IR Numeric Projection: ${unit} -> ${projection.cppType}, JSON=${projection.jsonRepresentation}, rounding=${projection.rounding}, overflow=${projection.overflow}`
    ).join("\n");
  return `// Generated by crdd-ir. Do not edit.
${generationIdentity}${numericIdentity ? `${numericIdentity}\n` : ""}${traceComment}
#pragma once

#include "CoreMinimal.h"

${opaqueStruct}
${arrayStructs}
${objectStructs}
${unionStructs ? `${unionStructs}\n` : ""}
struct FCrdd${operationName}Input
{
${inputFields}
};

struct FCrdd${operationName}State
{
${stateFields}
};

enum class ECrdd${operationName}Error : uint8
{
    None,
${errorValues}
};

struct FCrdd${operationName}Result
{
    bool bSucceeded = false;
    ECrdd${operationName}Error Error = ECrdd${operationName}Error::None;
    FString FailedRequirement;
    FCrdd${operationName}State State;
    TArray<FString> Traces;
};

class FCrdd${operationName}Operation
{
public:
    static FCrdd${operationName}Result Execute(
        const FCrdd${operationName}Input& Input,
        const FCrdd${operationName}State& InitialState
    );

    static FString ErrorCode(ECrdd${operationName}Error Error);
    static bool TryParseProjectedInt64(const FString& Decimal, int64& OutValue);
    static FString SerializeProjectedInt64(int64 Value);
};
`;
}

function generateObjectStruct(
  operation: Operation,
  scope: "Input" | "State",
  name: string,
  field: Extract<FieldDefinition, { type: "object" }>,
): string {
  const fields = Object.entries(field.properties)
    .map(([propertyName, property]) =>
      `    ${cppType(property)} ${cppField(propertyName, property)} = ${cppDefault(property)};`
    )
    .join("\n");
  return `struct ${objectStructName(operation, scope, name)}
{
${fields}
};`;
}

function objectStructName(operation: Operation, scope: "Input" | "State", name: string): string {
  return `FCrdd${pascalIdentifier(operation.id)}${scope}${pascalIdentifier(name)}`;
}

function generateSource(
  operation: Operation,
  _numericProjection: Record<string, UnrealNumericProjection>,
): string {
  const operationName = pascalIdentifier(operation.id);
  const checks = operation.requires
    .map((requirement, requirementIndex) => {
      const error = operation.errors.find((entry) => entry.code === requirement.error);
      if (!error) throw new Error(`Requirement "${requirement.id}" uses unknown error "${requirement.error}"`);
      const compiled = compileCheckedExpression(
        requirement.expression,
        operation,
        "InitialState",
        requirementIndex,
      );
      const guard = compiled.overflowChecks.length > 0
        ? `${compiled.overflowChecks.join(" || ")} || !(${compiled.expression})`
        : `!(${compiled.expression})`;
      const failureCheck = `    // ${requirement.id}: ${requirement.expression}
${compiled.statements.map((statement) => `    ${statement}`).join("\n")}${compiled.statements.length ? "\n" : ""}    if (${guard})
    {
        return Failure(
            ECrdd${operationName}Error::${pascalCase(requirement.error)},
            TEXT("${requirement.id}"),
            InitialState,
            {${error.traces.map((trace) => `TEXT("${trace}")`).join(", ")}}
        );
    }`;
      if (!requirement.when) return failureCheck;
      const selector = compileCheckedExpression(
        requirement.when,
        operation,
        "InitialState",
        operation.requires.length + requirementIndex,
      );
      const selectorOverflow = selector.overflowChecks.length > 0
        ? `    if (${selector.overflowChecks.join(" || ")})
    {
        return Failure(
            ECrdd${operationName}Error::${pascalCase(requirement.error)},
            TEXT("${requirement.id}"),
            InitialState,
            {${error.traces.map((trace) => `TEXT("${trace}")`).join(", ")}}
        );
    }
`
        : "";
      return `    // ${requirement.id} when ${requirement.when}
${selector.statements.map((statement) => `    ${statement}`).join("\n")}${selector.statements.length ? "\n" : ""}${selectorOverflow}    if (${selector.expression})
    {
${failureCheck.split("\n").map((line) => `    ${line}`).join("\n")}
    }`;
    })
    .join("\n\n");
  const portableChecks = (operation.portableRules ?? [])
    .map((rule) => cppPortableRule(rule, operation))
    .join("\n\n");
  const allChecks = [checks, portableChecks].filter(Boolean).join("\n\n");

  const effects = operation.effects.map((effect) => cppEffect(effect, operation)).join("\n");
  const successTraces = operation.traces.map((trace) => `TEXT("${trace}")`).join(", ");
  const errorCases = operation.errors
    .map(
      (error) => `    case ECrdd${operationName}Error::${pascalCase(error.code)}:
        return TEXT("${error.code}");`,
    )
    .join("\n");
  const opaqueHelpers = (hasOpaque(operation) || hasEvidenceHash(operation)) ? `uint32 CrddRotateRight(uint32 Value, uint32 Shift)
{
    return (Value >> Shift) | (Value << (32 - Shift));
}

FString CrddSha256(const TArray<uint8>& Input)
{
    static constexpr uint32 K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };
    TArray<uint8> Data = Input;
    const uint64 BitLength = static_cast<uint64>(Data.Num()) * 8;
    Data.Add(0x80);
    while ((Data.Num() % 64) != 56) Data.Add(0);
    for (int32 Shift = 56; Shift >= 0; Shift -= 8) Data.Add(static_cast<uint8>(BitLength >> Shift));

    uint32 H[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };
    for (int32 Offset = 0; Offset < Data.Num(); Offset += 64)
    {
        uint32 W[64] = {};
        for (int32 Index = 0; Index < 16; ++Index)
        {
            const int32 Base = Offset + Index * 4;
            W[Index] = (static_cast<uint32>(Data[Base]) << 24) |
                (static_cast<uint32>(Data[Base + 1]) << 16) |
                (static_cast<uint32>(Data[Base + 2]) << 8) |
                static_cast<uint32>(Data[Base + 3]);
        }
        for (int32 Index = 16; Index < 64; ++Index)
        {
            const uint32 S0 = CrddRotateRight(W[Index - 15], 7) ^
                CrddRotateRight(W[Index - 15], 18) ^ (W[Index - 15] >> 3);
            const uint32 S1 = CrddRotateRight(W[Index - 2], 17) ^
                CrddRotateRight(W[Index - 2], 19) ^ (W[Index - 2] >> 10);
            W[Index] = W[Index - 16] + S0 + W[Index - 7] + S1;
        }
        uint32 A = H[0], B = H[1], C = H[2], D = H[3];
        uint32 E = H[4], F = H[5], G = H[6], HH = H[7];
        for (int32 Index = 0; Index < 64; ++Index)
        {
            const uint32 S1 = CrddRotateRight(E, 6) ^ CrddRotateRight(E, 11) ^ CrddRotateRight(E, 25);
            const uint32 Choice = (E & F) ^ ((~E) & G);
            const uint32 Temp1 = HH + S1 + Choice + K[Index] + W[Index];
            const uint32 S0 = CrddRotateRight(A, 2) ^ CrddRotateRight(A, 13) ^ CrddRotateRight(A, 22);
            const uint32 Majority = (A & B) ^ (A & C) ^ (B & C);
            const uint32 Temp2 = S0 + Majority;
            HH = G; G = F; F = E; E = D + Temp1;
            D = C; C = B; B = A; A = Temp1 + Temp2;
        }
        H[0] += A; H[1] += B; H[2] += C; H[3] += D;
        H[4] += E; H[5] += F; H[6] += G; H[7] += HH;
    }
    FString Result;
    for (uint32 Part : H) Result += FString::Printf(TEXT("%08x"), Part);
    return Result;
}

${hasOpaque(operation) ? `bool CrddOpaqueValid(const FCrddOpaqueValue& Value)
{
    TArray<uint8> Bytes;
    if (!FBase64::Decode(Value.Base64, Bytes) || FBase64::Encode(Bytes) != Value.Base64)
    {
        return false;
    }
    return CrddSha256(Bytes) == Value.Sha256;
}` : ""}
` : "";
  const opaqueIncludes = hasOpaque(operation)
    ? '#include "Misc/Base64.h"\n'
    : "";
  const evidenceHelpers = cppEvidenceHelpers(operation);
  const evidenceIncludes = hasEvidenceHash(operation) ? '#include "Containers/StringConv.h"\n' : "";

  return `// Generated by crdd-ir. Do not edit.
${traces(operation)}
#include "${operationName}.generated.h"

${opaqueIncludes}${evidenceIncludes}#include <initializer_list>
#include <limits>

namespace
{
bool CrddTryAddInt64(int64 Left, int64 Right, int64& OutValue)
{
    if ((Right > 0 && Left > std::numeric_limits<int64>::max() - Right) ||
        (Right < 0 && Left < std::numeric_limits<int64>::min() - Right))
    {
        return false;
    }
    OutValue = Left + Right;
    return true;
}

bool CrddTrySubtractInt64(int64 Left, int64 Right, int64& OutValue)
{
    if ((Right < 0 && Left > std::numeric_limits<int64>::max() + Right) ||
        (Right > 0 && Left < std::numeric_limits<int64>::min() + Right))
    {
        return false;
    }
    OutValue = Left - Right;
    return true;
}

${opaqueHelpers}${evidenceHelpers}FCrdd${operationName}Result Failure(
    ECrdd${operationName}Error Error,
    const TCHAR* FailedRequirement,
    const FCrdd${operationName}State& InitialState,
    std::initializer_list<const TCHAR*> FailureTraces
)
{
    FCrdd${operationName}Result Result;
    Result.Error = Error;
    Result.FailedRequirement = FailedRequirement;
    Result.State = InitialState;
    for (const TCHAR* Trace : FailureTraces)
    {
        Result.Traces.Add(Trace);
    }
    return Result;
}
}

FCrdd${operationName}Result FCrdd${operationName}Operation::Execute(
    const FCrdd${operationName}Input& Input,
    const FCrdd${operationName}State& InitialState
)
{
${allChecks}

    FCrdd${operationName}Result Result;
    Result.bSucceeded = true;
    Result.State = InitialState;
    Result.Traces = {${successTraces}};
${effects}
    return Result;
}

FString FCrdd${operationName}Operation::ErrorCode(ECrdd${operationName}Error Error)
{
    switch (Error)
    {
    case ECrdd${operationName}Error::None:
        return TEXT("");
${errorCases}
    default:
        return TEXT("UNKNOWN");
    }
}

bool FCrdd${operationName}Operation::TryParseProjectedInt64(
    const FString& Decimal,
    int64& OutValue
)
{
    if (Decimal.IsEmpty() || Decimal.TrimStartAndEnd() != Decimal)
    {
        return false;
    }
    if (!LexTryParseString(OutValue, *Decimal))
    {
        return false;
    }
    return LexToString(OutValue) == Decimal;
}

FString FCrdd${operationName}Operation::SerializeProjectedInt64(int64 Value)
{
    return LexToString(Value);
}
`;
}

function cppPortableRule(rule: PortableRule, operation: Operation): string {
  const operationName = pascalIdentifier(operation.id);
  const error = operation.errors.find((entry) => entry.code === rule.error);
  if (!error) throw new Error(`Portable rule "${rule.id}" uses unknown error "${rule.error}"`);
  const failure = `return Failure(
            ECrdd${operationName}Error::${pascalCase(rule.error)},
            TEXT("${rule.id}"),
            InitialState,
            {${error.traces.map((trace) => `TEXT("${trace}")`).join(", ")}}
        );`;
  const marker = portableSemanticsMarker(rule);
  if (rule.kind === "evidence.canonical-hash") {
    const hash = cppPortablePath(rule.hash, operation);
    const source = rule.source === "input" ? "Input" : "InitialState";
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    if (CrddCanonical${rule.source === "input" ? "Input" : "State"}Sha256(${source}) != ${hash})
    {
        ${failure}
    }`;
  }
  if (rule.kind === "opaque.integrity") {
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    if (!CrddOpaqueValid(${cppPortablePath(rule.target, operation)}))
    {
        ${failure}
    }`;
  }
  if (rule.kind === "opaque.immutable-when-inactive") {
    const current = cppPortablePath(rule.current, operation);
    const proposed = cppPortablePath(rule.proposed, operation);
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    if (!CrddOpaqueValid(${current}) || !CrddOpaqueValid(${proposed}) ||
        (!${current}.bActive &&
        (${current}.Base64 != ${proposed}.Base64 ||
         ${current}.Sha256 != ${proposed}.Sha256 ||
         ${current}.bActive != ${proposed}.bActive)))
    {
        ${failure}
    }`;
  }
  if (rule.kind === "opaque.reject-edit-when-inactive") {
    const current = cppPortablePath(rule.current, operation);
    const intent = cppPortablePath(rule.intent, operation);
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    if (!CrddOpaqueValid(${current}) || (!${current}.bActive && ${intent}))
    {
        ${failure}
    }`;
  }
  if (rule.kind === "collection.not-contains") {
    const item = collectionItem(operation, rule.collection);
    const key = cppField(rule.targetKey, item.properties[rule.targetKey]);
    const value = cppPortablePath(rule.value, operation);
    const loop = cppCollectionLoop(rule.collection, operation, "Item");
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
${loop.open}
        if (Item.${key} == ${value})
        {
            ${failure}
        }
${loop.close}`;
  }
  if (rule.kind === "collection.prospective-unique") {
    const candidateItem = collectionItem(operation, rule.candidates);
    const existingItem = collectionItem(operation, rule.existing);
    const candidateKey = cppField(rule.candidateKey, candidateItem.properties[rule.candidateKey]);
    const existingKey = cppField(rule.existingKey, existingItem.properties[rule.existingKey]);
    const candidatesLoop = cppCollectionLoop(rule.candidates, operation, "Candidate");
    const existingLoop = cppCollectionLoop(rule.existing, operation, "Current", 2);
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    {
        TSet<FString> CrddProposed;
${candidatesLoop.open}
            const FString CrddKey = LexToString(Candidate.${candidateKey});
            if (CrddKey.IsEmpty() || CrddProposed.Contains(CrddKey))
            {
                ${failure}
            }
            CrddProposed.Add(CrddKey);
${existingLoop.open}
                if (Current.${existingKey} == Candidate.${candidateKey})
                {
                    ${failure}
                }
${existingLoop.close}
${candidatesLoop.close}
    }`;
  }
  const collection = cppPortablePath(rule.collection, operation);
  const loop = cppCollectionLoop(rule.collection, operation, "Item");
  if (rule.kind === "collection.unique") {
    const collectionField = portablePathField(operation, rule.collection);
    const itemField = collectionField.type === "array" ? collectionField.items : collectionField.values;
    const keyExpression = itemField.type === "object"
      ? `Item.${cppField(rule.key!, itemField.properties[rule.key!])}`
      : "Item";
    return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
    {
        TSet<FString> CrddSeen;
${loop.open}
            const FString CrddKey = LexToString(${keyExpression});
            if (CrddKey.IsEmpty() || CrddSeen.Contains(CrddKey))
            {
                ${failure}
            }
            CrddSeen.Add(CrddKey);
${loop.close}
    }`;
  }
  const item = collectionItem(operation, rule.collection);
  if (rule.kind === "collection.membership") {
    return cppReferenceRule(rule, collection, item, rule.parentReference,
      rule.parents, rule.parentKey, undefined, failure, operation);
  }
  if (rule.kind === "collection.reference") {
    return cppReferenceRule(rule, collection, item, rule.reference,
      rule.target, rule.targetKey, rule.targetType, failure, operation);
  }
  const elements = cppPortablePath(rule.elements, operation);
  const elementItem = collectionItem(operation, rule.elements);
  const from = cppField(rule.from, item.properties[rule.from]);
  const to = cppField(rule.to, item.properties[rule.to]);
  const key = cppField(rule.elementKey, elementItem.properties[rule.elementKey]);
  const fromType = cppTypePredicate("Element", elementItem, rule.fromType);
  const toType = cppTypePredicate("Element", elementItem, rule.toType);
  return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${marker}
${cppCollectionLoop(rule.collection, operation, "Relation").open}
        bool bFromFound = false;
        bool bToFound = false;
${cppCollectionLoop(rule.elements, operation, "Element", 2).open}
            bFromFound = bFromFound || (Element.${key} == Relation.${from}${fromType});
            bToFound = bToFound || (Element.${key} == Relation.${to}${toType});
${cppCollectionLoop(rule.elements, operation, "Element", 2).close}
        if (!bFromFound || !bToFound)
        {
            ${failure}
        }
${cppCollectionLoop(rule.collection, operation, "Relation").close}`;
}

function cppReferenceRule(
  rule: PortableRule,
  collection: string,
  item: Extract<FieldDefinition, { type: "object" }>,
  reference: string,
  targetPath: string,
  targetKey: string,
  type: { field: string; equals: string } | undefined,
  failure: string,
  operation: Operation,
): string {
  const target = cppPortablePath(targetPath, operation);
  const targetItem = collectionItem(operation, targetPath);
  const ref = cppField(reference, item.properties[reference]);
  const key = cppField(targetKey, targetItem.properties[targetKey]);
  const predicate = cppTypePredicate("Candidate", targetItem, type);
  return `    // ${rule.id}: ${rule.kind}
    // CRDD-PORTABLE-SEMANTICS: ${portableSemanticsMarker(rule)}
${cppCollectionLoop(ruleCollectionPath(rule, targetPath), operation, "Item").open}
        bool bCrddFound = false;
${cppCollectionLoop(targetPath, operation, "Candidate", 2).open}
            bCrddFound = bCrddFound || (Candidate.${key} == Item.${ref}${predicate});
${cppCollectionLoop(targetPath, operation, "Candidate", 2).close}
        if (!bCrddFound)
        {
            ${failure}
        }
${cppCollectionLoop(ruleCollectionPath(rule, targetPath), operation, "Item").close}`;
}

function portableSemanticsMarker(rule: PortableRule): string {
  return Buffer.from(canonicalJson(rule), "utf8").toString("base64");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function ruleCollectionPath(rule: PortableRule, fallback: string): string {
  return "collection" in rule ? rule.collection : fallback;
}

function cppTypePredicate(
  variable: string,
  item: Extract<FieldDefinition, { type: "object" }>,
  type?: { field: string; equals: string },
): string {
  if (!type) return "";
  return ` && ${variable}.${cppField(type.field, item.properties[type.field])} == TEXT(${JSON.stringify(type.equals)})`;
}

function cppPortablePath(path: string, operation: Operation): string {
  const [scope, name] = path.split(".");
  const field = (scope === "input" ? operation.input : operation.state)[name];
  if (!field || path.split(".").length !== 2) {
    throw new Error(`Portable Unreal paths must address top-level input/state fields: "${path}"`);
  }
  return `${scope === "input" ? "Input" : "InitialState"}.${cppField(name, field)}`;
}

function hasEvidenceHash(operation: Operation): boolean {
  return (operation.portableRules ?? []).some((rule) => rule.kind === "evidence.canonical-hash");
}

function cppEvidenceHelpers(operation: Operation): string {
  if (!hasEvidenceHash(operation)) return "";
  const name = pascalIdentifier(operation.id);
  const sources = (["input", "state"] as const).map((source) => {
    const fields = source === "input" ? operation.input : operation.state;
    const type = `FCrdd${name}${source === "input" ? "Input" : "State"}`;
    const value = source === "input" ? "Input" : "State";
    const hashFields = new Set((operation.portableRules ?? [])
      .filter((rule) => rule.kind === "evidence.canonical-hash" && rule.source === source)
      .map((rule) => rule.hash.split(".").slice(1).join(".")));
    const entries = Object.entries(fields).filter(([field]) => !hashFields.has(field)).sort(([a], [b]) => a.localeCompare(b))
      .map(([field, definition]) =>
        `TEXT("${field}"): + ${cppCanonicalValue(definition, `${value}.${cppField(field, definition)}`, `${name}${source}${pascalIdentifier(field)}`)}`
      );
    const body = entries.length
      ? entries.map((entry, index) => `${index ? ` + TEXT(",") + ` : ""}CrddJsonString(${entry.split(": + ")[0]}) + TEXT(":") + ${entry.split(": + ")[1]}`).join("")
      : 'TEXT("")';
    return `FString CrddCanonical${source === "input" ? "Input" : "State"}Json(const ${type}& ${value})
{
    return TEXT("{") + ${body} + TEXT("}");
}

FString CrddCanonical${source === "input" ? "Input" : "State"}Sha256(const ${type}& ${value})
{
    FTCHARToUTF8 Utf8(*CrddCanonical${source === "input" ? "Input" : "State"}Json(${value}));
    TArray<uint8> Bytes(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
    return CrddSha256(Bytes);
}`;
  }).join("\n\n");
  return `FString CrddJsonString(const FString& Value)
{
    FString Escaped;
    Escaped.Reserve(Value.Len() + 2);
    for (int32 Index = 0; Index < Value.Len(); ++Index)
    {
        const TCHAR Character = Value[Index];
        switch (Character)
        {
        case TEXT('"'): Escaped.AppendChar(TEXT('\\\\')); Escaped.AppendChar(TEXT('"')); break;
        case TEXT('\\\\'): Escaped += TEXT("\\\\\\\\"); break;
        case TEXT('\\b'): Escaped += TEXT("\\\\b"); break;
        case TEXT('\\f'): Escaped += TEXT("\\\\f"); break;
        case TEXT('\\n'): Escaped += TEXT("\\\\n"); break;
        case TEXT('\\r'): Escaped += TEXT("\\\\r"); break;
        case TEXT('\\t'): Escaped += TEXT("\\\\t"); break;
        default:
            if (static_cast<uint32>(Character) <= 0x1f)
            {
                Escaped += FString::Printf(TEXT("\\\\u%04x"), static_cast<uint32>(Character));
            }
            else if (Character >= 0xd800 && Character <= 0xdbff &&
                Index + 1 < Value.Len() && Value[Index + 1] >= 0xdc00 && Value[Index + 1] <= 0xdfff)
            {
                Escaped.AppendChar(Character);
                Escaped.AppendChar(Value[++Index]);
            }
            else if (Character >= 0xd800 && Character <= 0xdfff)
            {
                Escaped += FString::Printf(TEXT("\\\\u%04x"), static_cast<uint32>(Character));
            }
            else
            {
                Escaped.AppendChar(Character);
            }
            break;
        }
    }
    return TEXT("\\\"") + Escaped + TEXT("\\\"");
}

template<typename T, typename F>
FString CrddJsonArray(const TArray<T>& Values, F Serialize)
{
    FString Result = TEXT("[");
    for (int32 Index = 0; Index < Values.Num(); ++Index)
    {
        if (Index > 0) Result += TEXT(",");
        Result += Serialize(Values[Index]);
    }
    return Result + TEXT("]");
}

${sources}
`;
}

function cppCanonicalValue(field: FieldDefinition, access: string, context: string): string {
  if (field.type === "string") return `CrddJsonString(${access})`;
  if (field.type === "boolean") return `(${access} ? TEXT("true") : TEXT("false"))`;
  if (field.type === "integer") return `LexToString(${access})`;
  if (field.type === "number") {
    throw new Error("Canonical Evidence cannot contain binary floating-point fields; use a decimal string");
  }
  if (field.type === "array") {
    return `CrddJsonArray(${access}, [](const auto& Item) { return ${cppCanonicalValue(field.items, "Item", `${context}Item`)}; })`;
  }
  if (field.type === "object") {
    const entries = Object.entries(field.properties).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => `CrddJsonString(TEXT("${name}")) + TEXT(":") + ${cppCanonicalValue(child, `${access}.${cppField(name, child)}`, `${context}${pascalIdentifier(name)}`)}`);
    return `TEXT("{") + ${entries.join(' + TEXT(",") + ')} + TEXT("}")`;
  }
  if (field.type === "union") {
    const variants = field.variants.map((variant) => {
      const variantName = pascalIdentifier(unionVariant(field, variant));
      const payload = `${access}.${variantName}`;
      const entries = Object.entries(variant.properties).sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) =>
        name === field.discriminator
          ? `CrddJsonString(TEXT("${name}")) + TEXT(":") + CrddJsonString(TEXT("${unionVariant(field, variant)}"))`
          : `CrddJsonString(TEXT("${name}")) + TEXT(":") + ${cppCanonicalValue(child, `${payload}.${cppField(name, child)}`, `${context}${variantName}${pascalIdentifier(name)}`)}`
      );
      return `${access}.Variant == decltype(${access}.Variant)::${variantName} ? TEXT("{") + ${entries.join(' + TEXT(",") + ')} + TEXT("}") : `;
    }).join("");
    return `(${variants}TEXT("null"))`;
  }
  return `TEXT("null")`;
}

function generateUnionStruct(
  operation: Operation,
  scope: "Input" | "State",
  name: string,
  field: Extract<FieldDefinition, { type: "union" }>,
): string {
  const base = unionStructName(operation, scope, name);
  const variants = field.variants.map((variant) => unionVariant(field, variant));
  const payloads = field.variants.map((variant, index) => {
    const variantName = pascalIdentifier(variants[index]);
    const fields = Object.entries(variant.properties)
      .filter(([property]) => property !== field.discriminator)
      .map(([property, definition]) =>
        `    ${cppType(definition)} ${cppField(property, definition)} = ${cppDefault(definition)};`
      ).join("\n");
    return `struct ${base}${variantName}Payload
{
${fields}
};`;
  }).join("\n\n");
  const enumValues = variants.map((variant) => `    ${pascalIdentifier(variant)},`).join("\n");
  const members = variants.map((variant) => {
    const variantName = pascalIdentifier(variant);
    return `    ${base}${variantName}Payload ${variantName};`;
  }).join("\n");
  return `${payloads}

enum class E${base.slice(1)}Variant : uint8
{
    Unknown,
${enumValues}
};

struct ${base}
{
    E${base.slice(1)}Variant Variant = E${base.slice(1)}Variant::Unknown;
${members}
};`;
}

function unionStructName(operation: Operation, scope: "Input" | "State", name: string): string {
  return `FCrdd${pascalIdentifier(operation.id)}${scope}${pascalIdentifier(name)}Union`;
}

function unionVariant(
  union: Extract<FieldDefinition, { type: "union" }>,
  variant: Extract<FieldDefinition, { type: "object" }>,
): string {
  const discriminator = variant.properties[union.discriminator];
  if (discriminator.type !== "string" || discriminator.enum?.length !== 1) {
    throw new Error(`Union discriminator "${union.discriminator}" must have one string value`);
  }
  return discriminator.enum[0];
}

function portablePathField(operation: Operation, path: string): Extract<FieldDefinition, { type: "array" | "map" }> {
  const [scope, name, ...rest] = path.split(".");
  const field = (scope === "input" ? operation.input : operation.state)[name];
  if (rest.length || (field?.type !== "array" && field?.type !== "map")) {
    throw new Error(`Portable collection path must be a top-level array or map: "${path}"`);
  }
  return field;
}

function collectionItem(
  operation: Operation,
  path: string,
): Extract<FieldDefinition, { type: "object" }> {
  const [scope, name] = path.split(".");
  const field = (scope === "input" ? operation.input : operation.state)[name];
  const item = field?.type === "array" ? field.items : field?.type === "map" ? field.values : undefined;
  if (item?.type !== "object") {
    throw new Error(`Portable collection "${path}" must be an array or map of objects`);
  }
  return item;
}

function cppCollectionLoop(
  path: string,
  operation: Operation,
  variable: string,
  indentLevel = 1,
): { open: string; close: string } {
  const [scope, name] = path.split(".");
  const field = (scope === "input" ? operation.input : operation.state)[name];
  const collection = cppPortablePath(path, operation);
  const indent = "    ".repeat(indentLevel);
  if (field?.type === "map") {
    return {
      open: `${indent}for (const auto& Crdd${variable}Pair : ${collection})\n${indent}{\n${indent}    const auto& ${variable} = Crdd${variable}Pair.Value;`,
      close: `${indent}}`,
    };
  }
  return {
    open: `${indent}for (const auto& ${variable} : ${collection})\n${indent}{`,
    close: `${indent}}`,
  };
}

function hasOpaque(operation: Operation): boolean {
  const visit = (field: FieldDefinition): boolean =>
    field.type === "opaque" ||
    (field.type === "object" && Object.values(field.properties).some(visit)) ||
    (field.type === "array" && visit(field.items)) ||
    (field.type === "map" && visit(field.values)) ||
    (field.type === "union" && field.variants.some(visit));
  return [...Object.values(operation.input), ...Object.values(operation.state)].some(visit);
}

function hasIntegerProjection(operation: Operation): boolean {
  const contains = (field: FieldDefinition): boolean => {
    if (field.type === "object") return Object.values(field.properties).some(contains);
    if (field.type === "array") return contains(field.items);
    const projected = (field as FieldDefinition & { _crddCppType?: string })._crddCppType;
    return projected === "int32" || projected === "int64";
  };
  return [...Object.values(operation.input), ...Object.values(operation.state)].some(contains);
}

function generateNumericBoundaryFixture(ir: CrddIr, operation: Operation): string {
  const operationName = pascalIdentifier(operation.id);
  const baseline = generateTestManifest(ir).cases.find((item) => item.expect.ok)?.arrange;
  if (!baseline) throw new Error(`Cannot generate numeric fixture for "${operation.id}" without a success baseline`);
  const overflowRequirement = operation.requires
    .map((requirement) => ({
      requirement,
      operands: firstCheckedAddition(parseSourceExpression(requirement.expression), operation),
    }))
    .find((entry) => entry.operands);
  const baselineAssignments = [
    ...primitiveAssignments(baseline.input, "input", operation, "Input"),
    ...primitiveAssignments(baseline.state, "state", operation, "State"),
  ].map((line) => `    ${line}`).join("\n");
  const overflowBlock = overflowRequirement?.operands
    ? `
    ${cppReference(overflowRequirement.operands[0], operation, "State")} =
        std::numeric_limits<int64>::max();
    ${cppReference(overflowRequirement.operands[1], operation, "State")} = 1;
    const FCrdd${operationName}Result Overflow =
        FCrdd${operationName}Operation::Execute(Input, State);
    TestFalse(TEXT("Overflow must not satisfy its requirement"), Overflow.bSucceeded);
    TestEqual(
        TEXT("Overflow identifies its requirement"),
        Overflow.FailedRequirement,
        FString(TEXT("${overflowRequirement.requirement.id}"))
    );
`
    : "";
  return `// Generated by crdd-ir. Do not edit.
#if WITH_DEV_AUTOMATION_TESTS

#include "${operationName}.generated.h"

#include "Misc/AutomationTest.h"
#include <limits>

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrdd${operationName}NumericBoundaryTest,
    "CRDD.${operationName}.NumericBoundary.Generated",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

bool FCrdd${operationName}NumericBoundaryTest::RunTest(const FString& Parameters)
{
    FCrdd${operationName}Input Input;
    FCrdd${operationName}State State;
${baselineAssignments}
${overflowBlock}
    int64 Parsed = 0;
    TestTrue(
        TEXT("Maximum int64 decimal string parses"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(
            TEXT("9223372036854775807"), Parsed
        )
    );
    TestEqual(TEXT("Maximum int64 is preserved"), Parsed, std::numeric_limits<int64>::max());
    TestEqual(
        TEXT("Maximum int64 round trips"),
        FCrdd${operationName}Operation::SerializeProjectedInt64(Parsed),
        FString(TEXT("9223372036854775807"))
    );
    TestTrue(
        TEXT("Minimum int64 decimal string parses"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(
            TEXT("-9223372036854775808"), Parsed
        )
    );
    TestFalse(
        TEXT("Overflowing decimal string is rejected"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(
            TEXT("9223372036854775808"), Parsed
        )
    );
    TestFalse(
        TEXT("Underflowing decimal string is rejected"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(
            TEXT("-9223372036854775809"), Parsed
        )
    );
    TestFalse(
        TEXT("Lossy decimal value is rejected"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(TEXT("1.5"), Parsed)
    );
    TestFalse(
        TEXT("Non-canonical whitespace is rejected"),
        FCrdd${operationName}Operation::TryParseProjectedInt64(TEXT(" 1"), Parsed)
    );
    return true;
}
#endif
`;
}

function generatePortableConformanceFixture(ir: CrddIr, operation: Operation): string {
  const operationName = pascalIdentifier(operation.id);
  const cases = generateTestManifest(ir).cases.map((testCase, index) => {
    const expected = simulateForGeneration(ir, testCase.arrange);
    const inputAssignments = cppFixtureAssignments(
      testCase.arrange.input,
      operation.input,
      "Input",
      operation,
    );
    const stateAssignments = cppFixtureAssignments(
      testCase.arrange.state,
      operation.state,
      "State",
      operation,
    );
    const traceAssertions = expected.traces.map((trace) =>
      `        TestTrue(TEXT("case ${index + 1}: ${testCase.id} trace ${escapeCpp(trace)}"), Result.Traces.Contains(TEXT("${escapeCpp(trace)}")));`
    ).join("\n");
    return `    {
        FCrdd${operationName}Input Input;
        FCrdd${operationName}State State;
${[...inputAssignments, ...stateAssignments].map((line) => `        ${line}`).join("\n")}
        const FCrdd${operationName}Result Result = FCrdd${operationName}Operation::Execute(Input, State);
        Test${expected.ok ? "True" : "False"}(TEXT("case ${index + 1}: ${testCase.id} success"), Result.bSucceeded);
        TestEqual(
            TEXT("case ${index + 1}: ${testCase.id} error"),
            FCrdd${operationName}Operation::ErrorCode(Result.Error),
            TEXT("${expected.ok ? "" : escapeCpp(expected.error)}")
        );
        if (!Result.bSucceeded)
        {
            TestEqual(TEXT("case ${index + 1}: rollback"), Result.FailedRequirement, TEXT("${escapeCpp(expected.ok ? "" : expected.failedRequirement)}"));
        }
${traceAssertions}
    }`;
  }).join("\n\n");
  const snapshotOwnership = cppSnapshotOwnershipTest(operation);
  const snapshotMarker = snapshotOwnership
    ? `// CRDD-SNAPSHOT-OWNERSHIP: ${snapshotOwnershipMarker()}\n`
    : "";
  return `// Generated by crdd-ir. Do not edit.
${snapshotMarker}#if WITH_DEV_AUTOMATION_TESTS
#include "${operationName}.generated.h"
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrdd${operationName}PortableConformanceTest,
    "CRDD.Conformance.${operationName}.Portable",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

bool FCrdd${operationName}PortableConformanceTest::RunTest(const FString&)
{
${cases}
${snapshotOwnership ? `\n${snapshotOwnership}` : ""}
    return true;
}
#endif
`;
}

function cppSnapshotOwnershipTest(operation: Operation): string {
  const inputEntry = Object.entries(operation.input).find(([, field]) =>
    field.type === "array" && field.items.type === "object" &&
    Object.values(field.items.properties).some((child) =>
      child.type === "array" && child.items.type !== "object"
    )
  );
  if (!inputEntry) return "";
  const [inputName, inputField] = inputEntry;
  if (inputField.type !== "array" || inputField.items.type !== "object") return "";
  const nestedEntry = Object.entries(inputField.items.properties).find(([, child]) =>
    child.type === "array" && child.items.type !== "object"
  );
  if (!nestedEntry) return "";
  const [nestedName, nestedField] = nestedEntry;
  if (nestedField.type !== "array") return "";
  const effect = operation.effects.find((candidate) =>
    candidate.action === "assign" && candidate.expression === `input.${inputName}` &&
    /^state\.[A-Za-z_]\w*$/.test(candidate.target)
  );
  if (!effect || effect.action !== "assign") return "";
  const assignedName = effect.target.slice("state.".length);
  const assignedField = operation.state[assignedName];
  if (assignedField?.type !== "array" || assignedField.items.type !== "object") return "";
  const stateEntry = Object.entries(operation.state).find(([, field]) =>
    field.type === "array" && field.items.type === "object" &&
    Object.values(field.items.properties).some((child) => child.type === "array")
  );
  if (!stateEntry) return "";
  const [stateName, stateField] = stateEntry;
  if (stateField.type !== "array" || stateField.items.type !== "object") return "";
  const stateNestedEntry = Object.entries(stateField.items.properties).find(([, child]) =>
    child.type === "array" && child.items.type !== "object"
  );
  if (!stateNestedEntry) return "";
  const [stateNestedName, stateNestedField] = stateNestedEntry;
  if (stateNestedField.type !== "array") return "";
  const mutation = cppLiteral(sampleCppOwnershipScalar(nestedField.items), nestedField.items);
  const inputCollection = `Input.${cppField(inputName, inputField)}`;
  const assignedCollection = `Assigned.${cppField(assignedName, assignedField)}`;
  const initialCollection = `Initial.${cppField(stateName, stateField)}`;
  const copiedCollection = `Copied.${cppField(stateName, stateField)}`;
  const inputNested = `${inputCollection}[0].${cppField(nestedName, nestedField)}`;
  const assignedNested = `${assignedCollection}[0].${cppField(nestedName, nestedField)}`;
  const initialNested = `${initialCollection}[0].${cppField(stateNestedName, stateNestedField)}`;
  const copiedNested = `${copiedCollection}[0].${cppField(stateNestedName, stateNestedField)}`;
  return `    {
        FCrdd${pascalIdentifier(operation.id)}Input Input;
        auto& InputItem = ${inputCollection}.AddDefaulted_GetRef();
        ${inputNested}.Add(${mutation});
        ${inputNested}.Add(${mutation});
        ${inputCollection}.AddDefaulted();
        FCrdd${pascalIdentifier(operation.id)}State Assigned;
        ${assignedCollection} = ${inputCollection};
        TestEqual(TEXT("snapshot input order"), ${assignedNested}.Num(), 2);
        TestEqual(TEXT("snapshot empty nested collection"), ${assignedCollection}[1].${cppField(nestedName, nestedField)}.Num(), 0);
        const int32 AssignedCount = ${assignedNested}.Num();
        ${inputNested}.Add(${mutation});
        TestEqual(TEXT("input mutation isolated"), ${assignedNested}.Num(), AssignedCount);

        FCrdd${pascalIdentifier(operation.id)}State Initial;
        auto& InitialItem = ${initialCollection}.AddDefaulted_GetRef();
        ${initialNested}.Add(${cppLiteral(sampleCppOwnershipScalar(stateNestedField.items), stateNestedField.items)});
        FCrdd${pascalIdentifier(operation.id)}State Copied = Initial;
        const int32 CopiedCount = ${copiedNested}.Num();
        ${initialNested}.Add(${cppLiteral(sampleCppOwnershipScalar(stateNestedField.items), stateNestedField.items)});
        TestEqual(TEXT("initial mutation isolated"), ${copiedNested}.Num(), CopiedCount);
        const int32 InitialCount = ${initialNested}.Num();
        ${copiedNested}.Add(${cppLiteral(sampleCppOwnershipScalar(stateNestedField.items), stateNestedField.items)});
        TestEqual(TEXT("result mutation isolated"), ${initialNested}.Num(), InitialCount);
    }`;
}

function sampleCppOwnershipScalar(field: FieldDefinition): unknown {
  if (field.type === "string") return field.enum?.[0] ?? "ownership";
  if (field.type === "integer" || field.type === "number") return field.minimum ?? 1;
  if (field.type === "boolean") return true;
  return "ownership";
}

function simulateForGeneration(
  ir: CrddIr,
  request: import("./model.ts").SimulationRequest,
): import("./model.ts").SimulationResult {
  return simulate(ir, request);
}

function cppFixtureAssignments(
  values: Record<string, unknown>,
  fields: Record<string, FieldDefinition>,
  root: string,
  operation: Operation,
): string[] {
  return Object.entries(fields).flatMap(([name, field]) =>
    cppFixtureValue(`${root}.${cppField(name, field)}`, values[name], field, operation)
  );
}

function cppFixtureValue(
  target: string,
  value: unknown,
  field: FieldDefinition,
  operation: Operation,
): string[] {
  if (field.type === "object") {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return Object.entries(field.properties).flatMap(([name, child]) =>
      cppFixtureValue(`${target}.${cppField(name, child)}`, record[name], child, operation)
    );
  }
  if (field.type === "array") {
    if (field.items.type !== "object") {
      return (Array.isArray(value) ? value : []).map((item) =>
        `${target}.Add(${cppLiteral(item, field.items)});`
      );
    }
    return (Array.isArray(value) ? value : []).flatMap((item, index) => {
      const variable = `CrddItem${fixtureIdentifier(target)}${index}`;
      return [
        `auto& ${variable} = ${target}.AddDefaulted_GetRef();`,
        ...cppFixtureValue(variable, item, field.items, operation),
      ];
    });
  }
  if (field.type === "map") {
    if (field.values.type !== "object") throw new Error(`Unreal fixture map must contain objects`);
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return Object.keys(record).sort().flatMap((key, index) => {
      const variable = `CrddMapItem${fixtureIdentifier(target)}${index}`;
      return [
        `auto& ${variable} = ${target}.Add(TEXT("${escapeCpp(key)}"));`,
        ...cppFixtureValue(variable, record[key], field.values, operation),
      ];
    });
  }
  if (field.type === "opaque") {
    const opaque = value as Record<string, unknown> | undefined;
    return [
      `${target}.Base64 = TEXT("${escapeCpp(String(opaque?.base64 ?? ""))}");`,
      `${target}.Sha256 = TEXT("${escapeCpp(String(opaque?.sha256 ?? ""))}");`,
      `${target}.bActive = ${opaque?.active ? "true" : "false"};`,
    ];
  }
  if (field.type === "union") {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const discriminator = String(record[field.discriminator] ?? "");
    const variantIndex = field.variants.findIndex((candidate) =>
      unionVariant(field, candidate) === discriminator
    );
    if (variantIndex < 0) {
      return [`${target}.Variant = decltype(${target}.Variant)::Unknown;`];
    }
    const variant = field.variants[variantIndex];
    const variantName = pascalIdentifier(discriminator);
    return [
      `${target}.Variant = decltype(${target}.Variant)::${variantName};`,
      ...Object.entries(variant.properties)
        .filter(([property]) => property !== field.discriminator)
        .flatMap(([property, child]) =>
          cppFixtureValue(
            `${target}.${variantName}.${cppField(property, child)}`,
            record[property],
            child,
            operation,
          )
        ),
    ];
  }
  return [`${target} = ${cppLiteral(value, field)};`];
}

function cppLiteral(value: unknown, field: FieldDefinition): string {
  if (field.type === "string") return `TEXT("${escapeCpp(String(value ?? ""))}")`;
  if (field.type === "boolean") return value ? "true" : "false";
  if (field.type === "number" || field.type === "integer") return String(value ?? 0);
  throw new Error(`Unsupported Unreal fixture literal "${field.type}"`);
}

function fixtureIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

function escapeCpp(value: string): string {
  let escaped = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\") escaped += "\\\\";
    else if (character === '"') escaped += '\\"';
    else if (character === "\b") escaped += "\\b";
    else if (character === "\f") escaped += "\\f";
    else if (character === "\n") escaped += "\\n";
    else if (character === "\r") escaped += "\\r";
    else if (character === "\t") escaped += "\\t";
    else if (code <= 0x1f) escaped += `\\${code.toString(8).padStart(3, "0")}`;
    else escaped += character;
  }
  return escaped;
}

function firstCheckedAddition(
  node: ExpressionNode,
  operation: Operation,
): [string, string] | undefined {
  if (node.kind !== "binary") return undefined;
  if (
    (node.operator === "+" || node.operator === "-") &&
    node.left.kind === "reference" &&
    node.right.kind === "reference" &&
    ["int32", "int64"].includes(cppType(referenceField(node.left.path, operation))) &&
    ["int32", "int64"].includes(cppType(referenceField(node.right.path, operation)))
  ) {
    return [node.left.path, node.right.path];
  }
  return firstCheckedAddition(node.left, operation) ??
    firstCheckedAddition(node.right, operation);
}

function primitiveAssignments(
  values: Record<string, unknown>,
  scope: "input" | "state",
  operation: Operation,
  stateRoot: string,
): string[] {
  const result: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      if (Array.isArray(value)) return;
      for (const [name, child] of Object.entries(value)) visit(child, `${path}.${name}`);
      return;
    }
    const literal = typeof value === "string"
      ? `TEXT(${JSON.stringify(value)})`
      : typeof value === "boolean"
        ? (value ? "true" : "false")
        : String(value);
    result.push(`${cppReference(path, operation, stateRoot)} = ${literal};`);
  };
  for (const [name, value] of Object.entries(values)) visit(value, `${scope}.${name}`);
  return result;
}

type CheckedCppExpression = {
  expression: string;
  statements: string[];
  overflowChecks: string[];
  integer: boolean;
};

function compileCheckedExpression(
  expression: string,
  operation: Operation,
  stateRoot: string,
  requirementIndex: number,
): CheckedCppExpression {
  let temporaryIndex = 0;
  const compile = (node: ExpressionNode): CheckedCppExpression => {
    if (node.kind === "reference") {
      const field = referenceField(node.path, operation);
      return {
        expression: cppReference(node.path, operation, stateRoot),
        statements: [],
        overflowChecks: [],
        integer: cppType(field) === "int32" || cppType(field) === "int64",
      };
    }
    if (node.kind === "literal") {
      return {
        expression: typeof node.value === "string"
          ? `TEXT(${JSON.stringify(node.value)})`
          : String(node.value),
        statements: [],
        overflowChecks: [],
        integer: typeof node.value === "number" && Number.isInteger(node.value),
      };
    }
    if (node.kind === "unary") {
      const operand = compile(node.operand);
      return { ...operand, expression: `(${node.operator}${operand.expression})` };
    }
    const left = compile(node.left);
    const right = compile(node.right);
    const statements = [...left.statements, ...right.statements];
    const overflowChecks = [...left.overflowChecks, ...right.overflowChecks];
    if ((node.operator === "+" || node.operator === "-") && left.integer && right.integer) {
      const name = `CrddChecked${requirementIndex}_${temporaryIndex++}`;
      const overflow = `bCrddOverflow${requirementIndex}_${temporaryIndex}`;
      statements.push(`int64 ${name} = 0;`);
      statements.push(
        `const bool ${overflow} = !${node.operator === "+" ? "CrddTryAddInt64" : "CrddTrySubtractInt64"}(` +
        `${left.expression}, ${right.expression}, ${name});`,
      );
      overflowChecks.push(overflow);
      return { expression: name, statements, overflowChecks, integer: true };
    }
    return {
      expression: `(${left.expression} ${node.operator} ${right.expression})`,
      statements,
      overflowChecks,
      integer: false,
    };
  };
  return compile(parseSourceExpression(expression));
}

function cppEffect(effect: Effect, operation: Operation): string {
  const body = cppEffectBody(effect, operation);
  const trace = effect.traces?.map((item) =>
    `    Result.Traces.Add(TEXT("${escape(item)}"));`
  ).join("\n") ?? "";
  const statements = [body, trace].filter(Boolean).join("\n");
  if (!effect.when) return statements;
  return `    if (${cppExpression(effect.when, operation, "Result.State")})
    {
${statements.split("\n").map((line) => `    ${line}`).join("\n")}
    }`;
}

function cppEffectBody(effect: Effect, operation: Operation): string {
  if (effect.action === "assign") {
    const crossScope = cppCrossScopeAssignment(effect, operation);
    if (crossScope) return crossScope;
    return `    ${cppReference(effect.target, operation, "Result.State")} = ${cppExpression(
      effect.expression,
      operation,
      "Result.State",
    )};`;
  }
  if (effect.action === "increment") {
    return `    ${cppReference(effect.target, operation, "Result.State")} += ${cppExpression(
      effect.expression,
      operation,
      "Result.State",
    )};`;
  }

  if (!effect.target.startsWith("state.")) throw new Error("Unreal array effect target must be state");
  const stateName = effect.target.slice("state.".length);
  if (operation.state[stateName]?.type !== "array") {
    throw new Error(`Unreal ${effect.action} target "${effect.target}" is not an array`);
  }
  const arrayField = operation.state[stateName];
  if (arrayField.type !== "array") throw new Error(`Unreal ${effect.action} target is not an array`);
  const collection = `Result.State.${cppField(stateName, arrayField)}`;
  const itemType = collectionObjectTypeName(
    collectionObjectTypeRegistry(operation),
    "State",
    stateName,
  );
  if (effect.action === "remove" || effect.action === "update") {
    const condition = cppItemMatch(effect.where, arrayField.items.properties, operation);
    if (effect.action === "remove") {
      return `    ${collection}.RemoveAll([&](const ${itemType}& Item)
    {
        return ${condition};
    });`;
    }
    const assignments = Object.entries(effect.set)
      .map(([name, value]) =>
        `            Item.${cppField(name, arrayField.items.properties[name])} = ` +
        `${cppEffectValue(value, operation)};`
      )
      .join("\n");
    return `    for (${itemType}& Item : ${collection})
    {
        if (${condition})
        {
${assignments}
        }
    }`;
  }

  const value = effect.value as Record<string, unknown>;
  const values = Object.keys(arrayField.items.properties)
    .map((name) => cppEffectValue(value[name], operation))
    .join(", ");
  return `    ${collection}.Add({${values}});`;
}

function cppCrossScopeAssignment(effect: Effect, operation: Operation): string | undefined {
  const targetMatch = effect.target.match(/^state\.([A-Za-z_]\w*)$/);
  const sourceMatch = effect.expression.match(/^input\.([A-Za-z_]\w*)$/);
  if (!targetMatch || !sourceMatch) return undefined;
  const target = operation.state[targetMatch[1]];
  const source = operation.input[sourceMatch[1]];
  if (!target || !source || target.type !== source.type) return undefined;
  const left = `Result.State.${cppField(targetMatch[1], target)}`;
  const right = `Input.${cppField(sourceMatch[1], source)}`;
  if (target.type === "object" && source.type === "object") {
    return Object.keys(target.properties).map((name) =>
      `    ${left}.${cppField(name, target.properties[name])} = ${right}.${cppField(name, source.properties[name])};`
    ).join("\n");
  }
  if (target.type === "union" && source.type === "union") {
    const stateType = `ECrdd${pascalIdentifier(operation.id)}State${pascalIdentifier(targetMatch[1])}Union`;
    const inputType = `ECrdd${pascalIdentifier(operation.id)}Input${pascalIdentifier(sourceMatch[1])}Union`;
    const cases = target.variants.map((variant) => {
      const variantName = pascalIdentifier(unionVariant(target, variant));
      const sourceVariant = source.variants.find((item) => unionVariant(source, item) === unionVariant(target, variant));
      if (!sourceVariant) throw new Error(`Union effect variant "${unionVariant(target, variant)}" is missing from input`);
      const assignments = Object.keys(variant.properties).filter((name) => name !== target.discriminator)
        .map((name) => `        ${left}.${variantName}.${cppField(name, variant.properties[name])} = ${right}.${variantName}.${cppField(name, sourceVariant.properties[name])};`)
        .join("\n");
      return `    case ${inputType}Variant::${variantName}:
        ${left}.Variant = ${stateType}Variant::${variantName};
${assignments}
        break;`;
    }).join("\n");
    return `    switch (${right}.Variant)
    {
${cases}
    default:
        ${left}.Variant = ${stateType}Variant::Unknown;
        break;
    }`;
  }
  return undefined;
}

function cppItemMatch(
  where: Record<string, unknown>,
  properties: Record<string, FieldDefinition>,
  operation: Operation,
): string {
  return Object.entries(where)
    .map(([name, value]) =>
      `Item.${cppField(name, properties[name])} == ${cppEffectValue(value, operation)}`
    )
    .join(" && ");
}

function generateCollectionElementStruct(
  typeName: string,
  collectionField: FieldDefinition,
): string {
  const item = collectionField.type === "array"
    ? collectionField.items
    : collectionField.type === "map"
      ? collectionField.values
      : undefined;
  if (item?.type !== "object") throw new Error(`Unreal collection element type must be object`);
  const fields = Object.entries(item.properties)
    .map(([name, field]) => {
      return `    ${cppType(field)} ${cppField(name, field)} = ${cppDefault(field)};`;
    })
    .join("\n");
  return `struct ${typeName}
{
${fields}
};`;
}

type CollectionObjectTypeRegistry = {
  byPath: Map<string, string>;
  definitions: Array<{ typeName: string; field: FieldDefinition }>;
};

function collectionObjectTypeRegistry(operation: Operation): CollectionObjectTypeRegistry {
  const entries = ([
    ...Object.entries(operation.input).map(([name, field]) => ({ scope: "Input" as const, name, field })),
    ...Object.entries(operation.state).map(([name, field]) => ({ scope: "State" as const, name, field })),
  ]).filter(({ field }) =>
    (field.type === "array" && field.items.type === "object") ||
    (field.type === "map" && field.values.type === "object")
  ).sort((left, right) =>
    `${left.scope}:${left.name}`.localeCompare(`${right.scope}:${right.name}`)
  );
  const operationName = pascalIdentifier(operation.id);
  const byPath = new Map<string, string>();
  const byShape = new Map<string, string>();
  const definitions: Array<{ typeName: string; field: FieldDefinition }> = [];
  const usedNames = new Set<string>();
  for (const entry of entries) {
    const item = entry.field.type === "array" ? entry.field.items : entry.field.values;
    const shape = generatedFieldShape(item);
    let typeName = byShape.get(shape);
    if (!typeName) {
      const base = `FCrdd${operationName}${pascalIdentifier(entry.name)}Item`;
      typeName = base;
      if (usedNames.has(typeName)) {
        typeName = `FCrdd${operationName}${entry.scope}${pascalIdentifier(entry.name)}Item`;
      }
      let suffix = 2;
      const unsuffixed = typeName;
      while (usedNames.has(typeName)) typeName = `${unsuffixed}${suffix++}`;
      usedNames.add(typeName);
      byShape.set(shape, typeName);
      definitions.push({ typeName, field: entry.field });
    }
    byPath.set(`${entry.scope}.${entry.name}`, typeName);
  }
  return { byPath, definitions };
}

function collectionObjectTypeName(
  registry: CollectionObjectTypeRegistry,
  scope: "Input" | "State",
  name: string,
): string {
  const typeName = registry.byPath.get(`${scope}.${name}`);
  if (!typeName) throw new Error(`Unreal collection "${scope}.${name}" must contain objects`);
  return typeName;
}

function generatedFieldShape(field: FieldDefinition): string {
  const projected = (field as FieldDefinition & { _crddCppType?: string })._crddCppType;
  if (projected) return `projected:${projected}`;
  if (field.type === "object") {
    return `object:{${Object.entries(field.properties).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => `${name}:${generatedFieldShape(child)}`).join(",")}}`;
  }
  if (field.type === "array") return `array:<${generatedFieldShape(field.items)}>`;
  if (field.type === "map") return `map:<${generatedFieldShape(field.values)}>`;
  if (field.type === "union") {
    return `union:${field.discriminator}:[${field.variants.map(generatedFieldShape).join("|")}]`;
  }
  return `${field.type}:${field.unit ?? ""}`;
}

function cppExpression(expression: string, operation: Operation, stateRoot: string): string {
  return expression
    .replace(/"(?:[^"\\]|\\.)*"/g, (literal) => `TEXT(${literal})`)
    .replace(/\b(?:input|state)\.[A-Za-z_][A-Za-z0-9_.]*/g, (reference) =>
      cppReference(reference, operation, stateRoot),
    );
}

function cppEffectValue(value: unknown, operation: Operation): string {
  if (typeof value === "string" && value.startsWith("$")) {
    return cppReference(value.slice(1), operation, "Result.State");
  }
  if (typeof value === "string") return `TEXT(${JSON.stringify(value)})`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  throw new Error(`Unsupported Unreal append value "${JSON.stringify(value)}"`);
}

function cppReference(reference: string, operation: Operation, stateRoot: string): string {
  if (reference.startsWith("input.")) {
    const relative = reference.slice("input.".length);
    const exact = operation.input[relative];
    if (exact) return `Input.${cppField(relative, exact)}`;
    const [name, ...properties] = relative.split(".");
    let field = operation.input[name];
    if (!field) throw new Error(`Unknown Unreal input reference "${reference}"`);
    let result = `Input.${cppField(name, field)}`;
    for (const propertyName of properties) {
      if (field.type !== "object" || !field.properties[propertyName]) {
        throw new Error(`Unknown Unreal input reference "${reference}"`);
      }
      field = field.properties[propertyName];
      result += `.${cppField(propertyName, field)}`;
    }
    return result;
  }
  if (reference.startsWith("state.")) {
    const relative = reference.slice("state.".length);
    const exact = operation.state[relative];
    if (exact) return `${stateRoot}.${cppField(relative, exact)}`;
    const [name, ...properties] = relative.split(".");
    let field = operation.state[name];
    if (!field) throw new Error(`Unknown Unreal state reference "${reference}"`);
    let result = `${stateRoot}.${cppField(name, field)}`;
    for (const propertyName of properties) {
      if (field.type !== "object" || !field.properties[propertyName]) {
        throw new Error(`Unknown Unreal state reference "${reference}"`);
      }
      field = field.properties[propertyName];
      result += `.${cppField(propertyName, field)}`;
    }
    return result;
  }
  throw new Error(`Unsupported Unreal reference "${reference}"`);
}

function cppField(name: string, field: FieldDefinition): string {
  const base = name.split(".").map(pascalCase).join("");
  return field.unit ? `${base}${pascalCase(field.unit)}` : base;
}

function cppType(field: FieldDefinition): string {
  const projected = (field as FieldDefinition & { _crddCppType?: string })._crddCppType;
  if (projected) return projected;
  if (field.type === "number") return "double";
  if (field.type === "integer") return "int64";
  if (field.type === "boolean") return "bool";
  if (field.type === "string") return "FString";
  if (field.type === "opaque") return "FCrddOpaqueValue";
  if (field.type === "array") return `TArray<${cppType(field.items)}>`;
  throw new Error(`Unsupported generated field type "${field.type}"`);
}

function cppDefault(field: FieldDefinition): string {
  if (field.type !== "array" && field.default !== undefined) {
    if (typeof field.default === "string") return `TEXT(${JSON.stringify(field.default)})`;
    if (typeof field.default === "boolean") return field.default ? "true" : "false";
    return field.default.toString();
  }
  const projected = (field as FieldDefinition & { _crddCppType?: string })._crddCppType;
  if (field.type === "number" && projected?.startsWith("int")) return "0";
  if (field.type === "number") return "0.0";
  if (field.type === "integer") return "0";
  if (field.type === "boolean") return "false";
  if (field.type === "string") return 'TEXT("")';
  return "{}";
}

function referenceField(reference: string, operation: Operation): FieldDefinition {
  const [scope, ...segments] = reference.split(".");
  const fields = scope === "input"
    ? operation.input
    : scope === "state"
      ? operation.state
      : undefined;
  if (!fields) throw new Error(`Unknown Unreal reference "${reference}"`);
  const relative = segments.join(".");
  if (fields[relative]) return fields[relative];
  const [name, ...properties] = segments;
  let field = fields[name];
  if (!field) throw new Error(`Unknown Unreal reference "${reference}"`);
  for (const property of properties) {
    if (field.type !== "object" || !field.properties[property]) {
      throw new Error(`Unknown Unreal reference "${reference}"`);
    }
    field = field.properties[property];
  }
  return field;
}

function projectNumericTypes(
  operation: Operation,
  projections: Record<string, UnrealNumericProjection>,
): Operation {
  const result = structuredClone(operation);
  const visit = (field: FieldDefinition): void => {
    if (field.type === "object") {
      Object.values(field.properties).forEach(visit);
    } else if (field.type === "array") {
      visit(field.items);
    } else if (field.type === "map") {
      visit(field.values);
    } else if (field.type === "union") {
      field.variants.forEach(visit);
    } else if (field.type === "number" && field.unit && projections[field.unit]) {
      (field as FieldDefinition & { _crddCppType?: string })._crddCppType =
        projections[field.unit].cppType;
    }
  };
  Object.values(result.input).forEach(visit);
  Object.values(result.state).forEach(visit);
  return result;
}

function traces(operation: Operation): string {
  return operation.traces.map((trace) => `// CRDD-TRACE: ${trace}`).join("\n");
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function pascalIdentifier(value: string): string {
  if (!/[^A-Za-z0-9]/.test(value)) {
    return value[0].toUpperCase() + value.slice(1);
  }
  return pascalCase(value);
}
