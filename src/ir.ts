import { readFile } from "node:fs/promises";
import type { CrddIr, Diagnostic, FieldDefinition } from "./model.ts";

const allowedFieldTypes = new Set(["number", "string", "boolean", "array"]);
const allowedEffectActions = new Set(["assign", "append"]);

export async function loadIr(path: string): Promise<CrddIr> {
  const source = await readFile(path, "utf8");
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`);
  }

  const diagnostics = validateIr(value);
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(formatDiagnostics(errors));
  }

  return value as CrddIr;
}

export function validateIr(value: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return [error("$", "IR must be an object")];
  }

  if (value.irVersion !== "0.1") {
    diagnostics.push(error("$.irVersion", 'must equal "0.1"'));
  }
  if (!isRecord(value.operation)) {
    diagnostics.push(error("$.operation", "must be an object"));
    return diagnostics;
  }

  const operation = value.operation;
  requireString(operation, "id", "$.operation", diagnostics);
  const traces = requireStringArray(operation, "traces", "$.operation", diagnostics);
  if (traces && traces.length === 0) {
    diagnostics.push(error("$.operation.traces", "must contain at least one CRDD ID"));
  }

  validateFields(operation.input, "$.operation.input", diagnostics);
  validateFields(operation.state, "$.operation.state", diagnostics);

  if (!Array.isArray(operation.requires) || operation.requires.length === 0) {
    diagnostics.push(error("$.operation.requires", "must be a non-empty array"));
  } else {
    operation.requires.forEach((requirement, index) => {
      const path = `$.operation.requires[${index}]`;
      if (!isRecord(requirement)) {
        diagnostics.push(error(path, "must be an object"));
        return;
      }
      requireString(requirement, "id", path, diagnostics);
      requireString(requirement, "expression", path, diagnostics);
      requireString(requirement, "error", path, diagnostics);
    });
  }

  if (!Array.isArray(operation.effects) || operation.effects.length === 0) {
    diagnostics.push(error("$.operation.effects", "must be a non-empty array"));
  } else {
    operation.effects.forEach((effect, index) => {
      const path = `$.operation.effects[${index}]`;
      if (!isRecord(effect)) {
        diagnostics.push(error(path, "must be an object"));
        return;
      }
      requireString(effect, "target", path, diagnostics);
      if (typeof effect.action !== "string" || !allowedEffectActions.has(effect.action)) {
        diagnostics.push(error(`${path}.action`, 'must be "assign" or "append"'));
      } else if (effect.action === "assign") {
        requireString(effect, "expression", path, diagnostics);
      } else if (!("value" in effect)) {
        diagnostics.push(error(`${path}.value`, "is required for append"));
      }
    });
  }

  const errorCodes = new Set<string>();
  if (!Array.isArray(operation.errors) || operation.errors.length === 0) {
    diagnostics.push(error("$.operation.errors", "must be a non-empty array"));
  } else {
    operation.errors.forEach((entry, index) => {
      const path = `$.operation.errors[${index}]`;
      if (!isRecord(entry)) {
        diagnostics.push(error(path, "must be an object"));
        return;
      }
      const code = requireString(entry, "code", path, diagnostics);
      if (code) errorCodes.add(code);
      requireStringArray(entry, "traces", path, diagnostics);
    });
  }

  if (Array.isArray(operation.requires)) {
    for (const [index, requirement] of operation.requires.entries()) {
      if (isRecord(requirement) && typeof requirement.error === "string" && !errorCodes.has(requirement.error)) {
        diagnostics.push(
          error(`$.operation.requires[${index}].error`, `references undeclared error "${requirement.error}"`),
        );
      }
    }
  }

  if (!isRecord(operation.transaction)) {
    diagnostics.push(error("$.operation.transaction", "must be an object"));
  } else {
    requireBoolean(operation.transaction, "atomic", "$.operation.transaction", diagnostics);
    requireBoolean(operation.transaction, "rollbackOnFailure", "$.operation.transaction", diagnostics);
    if (operation.transaction.atomic === true && operation.transaction.rollbackOnFailure !== true) {
      diagnostics.push(
        error("$.operation.transaction.rollbackOnFailure", "must be true when the operation is atomic"),
      );
    }
  }

  warnForDuplicates(operation.traces, "$.operation.traces", diagnostics);
  return diagnostics;
}

function validateFields(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push(error(path, "must be an object"));
    return;
  }

  for (const [name, rawField] of Object.entries(value)) {
    const fieldPath = `${path}.${name}`;
    if (!isRecord(rawField)) {
      diagnostics.push(error(fieldPath, "must be an object"));
      continue;
    }
    const field = rawField as FieldDefinition;
    if (typeof field.type !== "string" || !allowedFieldTypes.has(field.type)) {
      diagnostics.push(error(`${fieldPath}.type`, "has an unsupported field type"));
    }
    if (field.minimum !== undefined && typeof field.minimum !== "number") {
      diagnostics.push(error(`${fieldPath}.minimum`, "must be a number"));
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    diagnostics.push(error(`${path}.${key}`, "must be a non-empty string"));
    return undefined;
  }
  return value[key];
}

function requireStringArray(
  value: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
): string[] | undefined {
  const candidate = value[key];
  if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string" || item.length === 0)) {
    diagnostics.push(error(`${path}.${key}`, "must be an array of non-empty strings"));
    return undefined;
  }
  return candidate;
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof value[key] !== "boolean") {
    diagnostics.push(error(`${path}.${key}`, "must be a boolean"));
  }
}

function warnForDuplicates(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!Array.isArray(value)) return;
  if (new Set(value).size !== value.length) {
    diagnostics.push({ severity: "warning", path, message: "contains duplicate values" });
  }
}

function error(path: string, message: string): Diagnostic {
  return { severity: "error", path, message };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.path}: ${item.message}`).join("\n");
}
