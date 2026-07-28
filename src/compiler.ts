import { createHash } from "node:crypto";
import { DiagnosticError } from "./diagnostics.ts";
import { normalizeSourceExpression } from "./source-expression.ts";
import { loadSourceContract } from "./source-contract.ts";
import { validateIr } from "./ir.ts";
import type { CrddIr, Diagnostic, FieldDefinition } from "./model.ts";

export type CompilationResult = {
  ir: CrddIr;
  canonicalJson: string;
  digest: string;
  sourceMap: {
    sourcePath: string;
    contractStartLine: number;
    contractEndLine: number;
  };
};

export async function compileMarkdown(path: string): Promise<CompilationResult> {
  const { contract, fence } = await loadSourceContract(path);
  const fields = fieldIndex(contract.operation.input, contract.operation.state);
  const ir: CrddIr = {
    irVersion: "0.1",
    operation: {
      id: contract.operation.id,
      traces: contract.operation.traces,
      input: contract.operation.input,
      state: contract.operation.state,
      requires: contract.operation.requires.map((requirement) => ({
        id: requirement.id,
        expression: normalizeWithContext(requirement.condition, fields, requirement.id),
        error: requirement.error,
      })),
      effects: contract.operation.effects.map((effect) =>
        effect.action === "assign" || effect.action === "increment"
          ? {
              ...effect,
              expression: normalizeWithContext(effect.expression, fields, effect.target),
            }
          : structuredClone(effect),
      ),
      errors: contract.operation.errors,
      transaction: {
        atomic: contract.operation.transaction.atomic,
        rollbackOnFailure: contract.operation.transaction.rollback_on_failure,
      },
      ...(contract.operation.assets
        ? {
            assets: contract.operation.assets.map((asset) => ({
              id: asset.id,
              type: asset.type,
              dimensions: structuredClone(asset.dimensions),
              material: { baseColor: [...asset.material.base_color] as [number, number, number] },
              collision: structuredClone(asset.collision),
              lod: structuredClone(asset.lod),
              placement: structuredClone(asset.placement),
              traces: [...asset.traces],
            })),
          }
        : {}),
    },
  };

  const diagnostics = validateIr(ir);
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) throw new DiagnosticError(errors, path);

  const canonicalJson = `${stableStringify(ir)}\n`;
  return {
    ir,
    canonicalJson,
    digest: createHash("sha256").update(canonicalJson).digest("hex"),
    sourceMap: {
      sourcePath: path,
      contractStartLine: fence.startLine,
      contractEndLine: fence.endLine,
    },
  };
}

function fieldIndex(
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
): Record<string, FieldDefinition> {
  return Object.fromEntries([
    ...Object.entries(input).map(([name, field]) => [`input.${name}`, field]),
    ...Object.entries(state).map(([name, field]) => [`state.${name}`, field]),
  ]);
}

function normalizeWithContext(
  expression: string,
  fields: Record<string, FieldDefinition>,
  context: string,
): string {
  try {
    return normalizeSourceExpression(expression, fields);
  } catch (error) {
    throw new Error(`${context}: ${(error as Error).message}`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
