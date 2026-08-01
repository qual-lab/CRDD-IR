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
      kind: contract.operation.kind,
      traces: contract.operation.traces,
      input: contract.operation.input,
      state: contract.operation.state,
      ...(contract.operation.output ? { output: contract.operation.output } : {}),
      requires: contract.operation.requires.map((requirement) => ({
        id: requirement.id,
        expression: normalizeWithContext(requirement.condition, fields, requirement.id),
        error: requirement.error,
        ...(requirement.when
          ? { when: normalizeWithContext(requirement.when, fields, `${requirement.id}.when`) }
          : {}),
      })),
      ...(contract.operation.portable_rules
        ? { portableRules: structuredClone(contract.operation.portable_rules) }
        : {}),
      effects: contract.operation.effects.map((effect) =>
        effect.action === "assign" || effect.action === "increment"
          ? {
              ...effect,
              expression: normalizeWithContext(effect.expression, fields, effect.target),
              ...(effect.when
                ? { when: normalizeWithContext(effect.when, fields, `${effect.target}.when`) }
                : {}),
            }
          : {
              ...structuredClone(effect),
              ...(effect.when
                ? { when: normalizeWithContext(effect.when, fields, `${effect.target}.when`) }
                : {}),
            },
      ),
      errors: contract.operation.errors,
      ...(contract.operation.conformance ? {
        conformance: {
          ...(contract.operation.conformance.baseline
            ? { baseline: structuredClone(contract.operation.conformance.baseline) }
            : {}),
          ...(contract.operation.conformance.seeds ? {
            seeds: contract.operation.conformance.seeds.map((seed) => ({
              ...structuredClone(seed),
              when: normalizeWithContext(seed.when, fields, `conformance seed ${seed.id}`),
            })),
          } : {}),
        },
      } : {}),
      ...(contract.operation.transaction ? {
        transaction: {
          atomic: contract.operation.transaction.atomic,
          rollbackOnFailure: contract.operation.transaction.rollback_on_failure,
        },
      } : {}),
      ...(contract.operation.execution ? {
        execution: {
          mode: contract.operation.execution.mode,
          ...(contract.operation.execution.cancelable === undefined
            ? {} : { cancelable: contract.operation.execution.cancelable }),
          ...(contract.operation.execution.timeout_ms === undefined
            ? {} : { timeoutMs: contract.operation.execution.timeout_ms }),
          ...(contract.operation.execution.idempotency === undefined
            ? {} : { idempotency: contract.operation.execution.idempotency }),
        },
      } : {}),
      ...(contract.operation.emits ? { emits: structuredClone(contract.operation.emits) } : {}),
      ...(contract.operation.extensions
        ? {
            extensions: structuredClone(contract.operation.extensions),
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
    ...flattenFields("input", input),
    ...flattenFields("state", state),
  ]);
}

function flattenFields(
  prefix: string,
  fields: Record<string, FieldDefinition>,
): Array<[string, FieldDefinition]> {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = `${prefix}.${name}`;
    return [
      [path, field] as [string, FieldDefinition],
      ...(field.type === "object" ? flattenFields(path, field.properties) : []),
    ];
  });
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
