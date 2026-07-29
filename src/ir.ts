import { readFile } from "node:fs/promises";
import { extractReferences } from "./expression.ts";
import { DiagnosticError, formatDiagnosticText } from "./diagnostics.ts";
import type { CrddIr, Diagnostic, FieldDefinition } from "./model.ts";

const allowedFieldTypes = new Set(["number", "string", "boolean", "array", "object"]);
const allowedEffectActions = new Set(["assign", "append", "increment", "remove", "update"]);

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
    throw new DiagnosticError(errors, path);
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
        diagnostics.push(error(
          `${path}.action`,
          'must be "assign", "append", "increment", "remove", or "update"',
        ));
      } else if (effect.action === "assign" || effect.action === "increment") {
        requireString(effect, "expression", path, diagnostics);
      } else if (effect.action === "append" && !("value" in effect)) {
        diagnostics.push(error(`${path}.value`, "is required for append"));
      } else if (effect.action === "remove" && !isRecord(effect.where)) {
        diagnostics.push(error(`${path}.where`, "is required for remove"));
      } else if (effect.action === "update") {
        if (!isRecord(effect.where)) diagnostics.push(error(`${path}.where`, "is required for update"));
        if (!isRecord(effect.set)) diagnostics.push(error(`${path}.set`, "is required for update"));
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
  validateExtensions(operation.extensions, diagnostics);
  validateSemantics(operation, diagnostics);
  return diagnostics;
}

function validateExtensions(value: unknown, diagnostics: Diagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(error("$.operation.extensions", "must be an object"));
    return;
  }
  for (const [id, extension] of Object.entries(value)) {
    const path = `$.operation.extensions.${id}`;
    if (!/^[a-z][a-z0-9.-]*$/.test(id)) {
      diagnostics.push(error(path, "extension ID must use reverse-domain-style lowercase characters"));
    }
    if (!isRecord(extension)) {
      diagnostics.push(error(path, "must be an object"));
      continue;
    }
    requireString(extension, "protocol", path, diagnostics);
    if (!("data" in extension)) diagnostics.push(error(`${path}.data`, "is required"));
  }
}

function validateSemantics(operation: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  if (!isRecord(operation.input) || !isRecord(operation.state)) return;

  const input = operation.input as Record<string, FieldDefinition>;
  const state = operation.state as Record<string, FieldDefinition>;

  if (Array.isArray(operation.requires)) {
    const requirementIds: string[] = [];
    operation.requires.forEach((requirement, index) => {
      if (!isRecord(requirement)) return;
      if (typeof requirement.id === "string") requirementIds.push(requirement.id);
      if (typeof requirement.expression !== "string") return;
      const path = `$.operation.requires[${index}].expression`;
      validateExpressionReferences(requirement.expression, path, input, state, diagnostics);
      validateComparisonUnits(requirement.expression, path, input, state, diagnostics);
    });
    reportDuplicateIds(requirementIds, "$.operation.requires", "requirement ID", diagnostics);
  }

  if (Array.isArray(operation.errors)) {
    const errorCodes = operation.errors
      .filter(isRecord)
      .map((entry) => entry.code)
      .filter((code): code is string => typeof code === "string");
    reportDuplicateIds(errorCodes, "$.operation.errors", "error code", diagnostics);
  }

  if (Array.isArray(operation.effects)) {
    operation.effects.forEach((effect, index) => {
      if (!isRecord(effect) || typeof effect.target !== "string") return;
      const path = `$.operation.effects[${index}]`;
      const target = effect.target.startsWith("state.") ? effect.target.slice(6) : undefined;
      if (!target) {
        diagnostics.push(error(`${path}.target`, 'must start with "state."'));
        return;
      }
      const targetField = fieldForReference(effect.target, input, state);
      if (!targetField) {
        diagnostics.push(error(`${path}.target`, `references undefined state field "${target}"`));
        return;
      }
      if (["append", "remove", "update"].includes(String(effect.action)) &&
          targetField.type !== "array") {
        diagnostics.push(error(
          `${path}.target`,
          `${effect.action} requires an array target, got "${targetField.type}"`,
        ));
      }
      if (effect.action === "increment" && targetField.type !== "number") {
        diagnostics.push(error(`${path}.target`, `increment requires a number target, got "${targetField.type}"`));
      }
      if ((effect.action === "assign" || effect.action === "increment") &&
          typeof effect.expression === "string") {
        validateExpressionReferences(effect.expression, `${path}.expression`, input, state, diagnostics);
        validateAssignmentUnits(effect.expression, targetField, `${path}.expression`, input, state, diagnostics);
      }
      if (effect.action === "append") {
        validateValueReferences(effect.value, `${path}.value`, input, state, diagnostics);
        if (
          targetField.type === "array" &&
          isRecord(targetField.items) &&
          isRecord(targetField.items.properties)
        ) {
          validateAppendValue(
            effect.value,
            targetField.items.properties as Record<string, FieldDefinition>,
            `${path}.value`,
            input,
            state,
            diagnostics,
          );
        }
      }
      if ((effect.action === "remove" || effect.action === "update") &&
          targetField.type === "array") {
        validateObjectValue(
          effect.where,
          targetField.items.properties,
          `${path}.where`,
          input,
          state,
          diagnostics,
          false,
        );
        if (effect.action === "update") {
          validateObjectValue(
            effect.set,
            targetField.items.properties,
            `${path}.set`,
            input,
            state,
            diagnostics,
            false,
          );
        }
      }
    });

    if (operation.effects.length > 0 && isRecord(operation.transaction)) {
      if (operation.transaction.atomic !== true) {
        diagnostics.push(error("$.operation.transaction.atomic", "must be true when effects modify state"));
      }
      if (operation.transaction.rollbackOnFailure !== true) {
        diagnostics.push(
          error("$.operation.transaction.rollbackOnFailure", "must be true when effects modify state"),
        );
      }
    }
  }
}

function validateAppendValue(
  value: unknown,
  properties: Record<string, FieldDefinition>,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  validateObjectValue(value, properties, path, input, state, diagnostics, true);
}

function validateObjectValue(
  value: unknown,
  properties: Record<string, FieldDefinition>,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
  requireAll: boolean,
): void {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    diagnostics.push(error(path, "must be a non-empty object matching the array item schema"));
    return;
  }
  for (const key of Object.keys(value)) {
    if (!properties[key]) diagnostics.push(error(`${path}.${key}`, "is not declared in the array item schema"));
  }
  for (const [key, expected] of Object.entries(properties)) {
    if (!(key in value)) {
      if (requireAll) diagnostics.push(error(`${path}.${key}`, "is required by the array item schema"));
      continue;
    }
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.startsWith("$")) {
      const source = fieldForReference(candidate.slice(1), input, state);
      if (!source) continue;
      if (source.type !== expected.type) {
        diagnostics.push(error(`${path}.${key}`, `has type "${source.type}", expected "${expected.type}"`));
      } else if ((source.unit ?? null) !== (expected.unit ?? null)) {
        diagnostics.push(error(
          `${path}.${key}`,
          `has unit "${source.unit ?? "none"}", expected "${expected.unit ?? "none"}"`,
        ));
      }
    } else if (
      (expected.type === "number" && typeof candidate !== "number") ||
      (expected.type === "string" && typeof candidate !== "string") ||
      (expected.type === "boolean" && typeof candidate !== "boolean")
    ) {
      diagnostics.push(error(`${path}.${key}`, `must have type "${expected.type}"`));
    }
  }
}

function validateExpressionReferences(
  expression: string,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  for (const reference of extractReferences(expression)) {
    if (!fieldForReference(reference, input, state)) {
      diagnostics.push(error(path, `references undefined field "${reference}"`));
    }
  }
}

function validateValueReferences(
  value: unknown,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  if (typeof value === "string" && value.startsWith("$")) {
    const reference = value.slice(1);
    if (!fieldForReference(reference, input, state)) {
      diagnostics.push(error(path, `references undefined field "${reference}"`));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateValueReferences(item, `${path}[${index}]`, input, state, diagnostics));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateValueReferences(item, `${path}.${key}`, input, state, diagnostics);
    }
  }
}

function validateComparisonUnits(
  expression: string,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  const comparison = expression.match(
    /^\s*((?:input|state)\.[A-Za-z_][\w.]*)\s*(?:>=|<=|==|!=|>|<)\s*((?:input|state)\.[A-Za-z_][\w.]*)\s*$/,
  );
  if (!comparison) return;
  const left = fieldForReference(comparison[1], input, state);
  const right = fieldForReference(comparison[2], input, state);
  if (!left || !right) return;
  if (left.type !== right.type) {
    diagnostics.push(error(path, `compares incompatible types "${left.type}" and "${right.type}"`));
  } else if ((left.unit ?? null) !== (right.unit ?? null)) {
    diagnostics.push(error(path, `compares incompatible units "${left.unit ?? "none"}" and "${right.unit ?? "none"}"`));
  }
}

function validateAssignmentUnits(
  expression: string,
  target: FieldDefinition,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  for (const reference of extractReferences(expression)) {
    const source = fieldForReference(reference, input, state);
    if (!source) continue;
    if (source.type !== target.type) {
      diagnostics.push(error(path, `uses "${reference}" of type "${source.type}" for "${target.type}" target`));
    } else if ((source.unit ?? null) !== (target.unit ?? null)) {
      diagnostics.push(
        error(path, `uses "${reference}" with unit "${source.unit ?? "none"}" for "${target.unit ?? "none"}" target`),
      );
    }
  }
}

function fieldForReference(
  reference: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
): FieldDefinition | undefined {
  const root = reference.startsWith("input.") ? input : reference.startsWith("state.") ? state : undefined;
  if (!root) return undefined;
  const relative = reference.slice(reference.indexOf(".") + 1);
  if (root[relative]) return root[relative];
  const parts = relative.split(".");
  let field = root[parts.shift() ?? ""];
  for (const part of parts) {
    if (field?.type !== "object") return undefined;
    field = field.properties[part];
  }
  return field;
}

function reportDuplicateIds(
  values: string[],
  path: string,
  label: string,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) diagnostics.push(error(path, `contains duplicate ${label} "${value}"`));
    seen.add(value);
  }
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
    validateField(rawField, fieldPath, diagnostics);
  }
}

function validateField(rawField: Record<string, unknown>, path: string, diagnostics: Diagnostic[]): void {
  if (typeof rawField.type !== "string" || !allowedFieldTypes.has(rawField.type)) {
    diagnostics.push(error(`${path}.type`, "has an unsupported field type"));
    return;
  }
  if (rawField.minimum !== undefined && typeof rawField.minimum !== "number") {
    diagnostics.push(error(`${path}.minimum`, "must be a number"));
  }
  if (rawField.enum !== undefined) {
    if (rawField.type !== "string") {
      diagnostics.push(error(`${path}.enum`, "is supported only for string fields"));
    } else if (!Array.isArray(rawField.enum) || rawField.enum.length === 0 ||
        rawField.enum.some((item) => typeof item !== "string" || item.length === 0) ||
        new Set(rawField.enum).size !== rawField.enum.length) {
      diagnostics.push(error(`${path}.enum`, "must be a non-empty array of unique non-empty strings"));
    }
  }
  if (rawField.optional !== undefined && typeof rawField.optional !== "boolean") {
    diagnostics.push(error(`${path}.optional`, "must be a boolean"));
  }
  if (rawField.optional === true && rawField.default === undefined) {
    diagnostics.push(error(`${path}.default`, "is required when optional is true"));
  }
  if (rawField.optional !== true && rawField.default !== undefined) {
    diagnostics.push(error(`${path}.default`, "requires optional to be true"));
  }
  if (rawField.default !== undefined) {
    const expected = rawField.type;
    if (
      (expected === "number" && typeof rawField.default !== "number") ||
      (expected === "string" && typeof rawField.default !== "string") ||
      (expected === "boolean" && typeof rawField.default !== "boolean")
    ) {
      diagnostics.push(error(`${path}.default`, `must have type "${expected}"`));
    }
    if (rawField.type === "string" && Array.isArray(rawField.enum) &&
        !rawField.enum.includes(rawField.default)) {
      diagnostics.push(error(`${path}.default`, "must be one of the declared enum values"));
    }
    if (rawField.type === "number" && typeof rawField.default === "number" &&
        typeof rawField.minimum === "number" && rawField.default < rawField.minimum) {
      diagnostics.push(error(`${path}.default`, `must be >= ${rawField.minimum}`));
    }
  }
  if (rawField.type === "array") {
    if (!isRecord(rawField.items) || rawField.items.type !== "object") {
      diagnostics.push(error(`${path}.items`, 'must define an object item schema'));
      return;
    }
    if (!isRecord(rawField.items.properties) || Object.keys(rawField.items.properties).length === 0) {
      diagnostics.push(error(`${path}.items.properties`, "must be a non-empty object"));
      return;
    }
    validateFields(rawField.items.properties, `${path}.items.properties`, diagnostics);
  } else if (rawField.type === "object") {
    if (!isRecord(rawField.properties) || Object.keys(rawField.properties).length === 0) {
      diagnostics.push(error(`${path}.properties`, "must be a non-empty object"));
      return;
    }
    validateFields(rawField.properties, `${path}.properties`, diagnostics);
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
    diagnostics.push({
      code: "CRDD_IR_DUPLICATE",
      severity: "warning",
      path,
      message: "contains duplicate values",
    });
  }
}

function error(path: string, message: string): Diagnostic {
  return { code: diagnosticCode(path, message), severity: "error", path, message };
}

function diagnosticCode(path: string, message: string): string {
  if (path === "$.irVersion") return "CRDD_IR_VERSION";
  if (/duplicate/i.test(message)) return "CRDD_IR_DUPLICATE";
  if (/reference|undeclared|unknown/i.test(message)) return "CRDD_IR_REFERENCE";
  if (/required|must contain|non-empty/i.test(message)) return "CRDD_IR_REQUIRED";
  if (/type|array|object|string|boolean|number/i.test(message)) return "CRDD_IR_TYPE";
  if (/unit|atomic|rollback|effect|target|append|assign/i.test(`${path} ${message}`)) {
    return "CRDD_IR_SEMANTIC";
  }
  return "CRDD_IR_INVALID";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return formatDiagnosticText(diagnostics);
}
