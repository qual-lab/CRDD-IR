import { evaluateExpression, getPath } from "./expression.ts";
import type { CrddIr, SimulationRequest, SimulationResult } from "./model.ts";
import { evaluatePortableRules } from "./portable-rules.ts";

export function simulate(ir: CrddIr, request: SimulationRequest): SimulationResult {
  const input = validateRequest(ir, request);
  const originalState = structuredClone(request.state);
  const workingState = structuredClone(request.state);
  const context = { input, state: workingState };

  for (const requirement of ir.operation.requires) {
    const satisfied = evaluateExpression(requirement.expression, context);
    if (satisfied !== true) {
      return {
        ok: false,
        operation: ir.operation.id,
        error: requirement.error,
        failedRequirement: requirement.id,
        state: originalState,
        traces: tracesForError(ir, requirement.error),
      };
    }
  }

  const portableFailure = evaluatePortableRules(ir, context);
  if (portableFailure) {
    return {
      ok: false,
      operation: ir.operation.id,
      error: portableFailure.error,
      failedRequirement: portableFailure.id,
      state: originalState,
      traces: tracesForError(ir, portableFailure.error),
    };
  }

  try {
    for (const effect of ir.operation.effects) {
      const target = stripStatePrefix(effect.target);
      if (effect.action === "assign") {
        setPath(workingState, target, evaluateExpression(effect.expression, context));
      } else if (effect.action === "increment") {
        const current = getPath(workingState, target);
        const delta = evaluateExpression(effect.expression, context);
        if (typeof current !== "number" || typeof delta !== "number") {
          throw new Error(`Increment target and expression must be numbers: "${effect.target}"`);
        }
        setPath(workingState, target, current + delta);
      } else if (effect.action === "append") {
        const collection = getPath(workingState, target);
        if (!Array.isArray(collection)) throw new Error(`Append target "${effect.target}" is not an array`);
        collection.push(resolveValue(effect.value, context));
      } else {
        const collection = getPath(workingState, target);
        if (!Array.isArray(collection)) throw new Error(`${effect.action} target "${effect.target}" is not an array`);
        const where = resolveValue(effect.where, context) as Record<string, unknown>;
        if (effect.action === "remove") {
          const retained = collection.filter((item) => !matches(item, where));
          setPath(workingState, target, retained);
        } else {
          const updates = resolveValue(effect.set, context) as Record<string, unknown>;
          for (const item of collection) {
            if (matches(item, where)) Object.assign(item as object, structuredClone(updates));
          }
        }
      }
    }
  } catch (error) {
    if (ir.operation.transaction.atomic && ir.operation.transaction.rollbackOnFailure) {
      throw new Error(`Atomic operation rolled back: ${(error as Error).message}`);
    }
    throw error;
  }

  return {
    ok: true,
    operation: ir.operation.id,
    state: workingState,
    traces: ir.operation.traces,
  };
}

function matches(value: unknown, where: Record<string, unknown>): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(where).every(([key, expected]) =>
    Object.is((value as Record<string, unknown>)[key], expected)
  );
}

function validateRequest(ir: CrddIr, request: SimulationRequest): Record<string, unknown> {
  const input = structuredClone(request.input);
  for (const [name, definition] of Object.entries(ir.operation.input)) {
    input[name] = validateFieldValue(input[name], definition, `Input "${name}"`);
  }
  return input;
}

function validateFieldValue(
  candidate: unknown,
  definition: import("./model.ts").FieldDefinition,
  label: string,
): unknown {
  let value = candidate;
  if (value === undefined && definition.type !== "array" && definition.type !== "object" && definition.optional) {
    value = structuredClone(definition.default);
  }
  if (value === undefined) throw new Error(`Missing ${label.toLowerCase()}`);
  if (definition.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    const result = structuredClone(value) as Record<string, unknown>;
    for (const [name, property] of Object.entries(definition.properties)) {
      result[name] = validateFieldValue(result[name], property, `${label}.${name}`);
    }
    for (const name of Object.keys(result)) {
      if (!definition.properties[name]) throw new Error(`${label}.${name} is not declared`);
    }
    return result;
  }
  if (definition.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value.map((item, index) => validateFieldValue(item, definition.items, `${label}[${index}]`));
  }
  if (definition.type === "map") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be a map`);
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, validateFieldValue(item, definition.values, `${label}.${key}`)]));
  }
  if (definition.type === "opaque") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an opaque value`);
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.base64 !== "string" || typeof candidate.sha256 !== "string" ||
        typeof candidate.active !== "boolean" || Object.keys(candidate).some((key) =>
          !["base64", "sha256", "active"].includes(key))) {
      throw new Error(`${label} must contain base64, sha256, and active`);
    }
    return structuredClone(value);
  }
    if ((definition.type === "number" || definition.type === "integer") && typeof value !== "number") {
      throw new Error(`${label} must be a number`);
    }
    if (definition.type === "integer") {
      if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
      if (Object.is(value, -0)) value = 0;
    }
    if (definition.type === "string" && typeof value !== "string") {
      throw new Error(`${label} must be a string`);
    }
    if (definition.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${label} must be a boolean`);
    }
    if (definition.type === "string" && definition.enum && !definition.enum.includes(value as string)) {
      throw new Error(`${label} must be one of: ${definition.enum.join(", ")}`);
    }
    if (definition.minimum !== undefined && typeof value === "number" && value < definition.minimum) {
      throw new Error(`${label} must be >= ${definition.minimum}`);
    }
  return value;
}

function resolveValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    return structuredClone(getPath(context, value.slice(1)));
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]),
    );
  }
  return value;
}

function stripStatePrefix(path: string): string {
  if (!path.startsWith("state.")) throw new Error(`Effect target must start with "state.": ${path}`);
  return path.slice("state.".length);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  const leaf = parts.pop();
  if (!leaf) throw new Error("Effect target cannot be empty");
  let current: Record<string, unknown> = root;
  for (const part of parts) {
    const next = current[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new Error(`Cannot assign through "${path}"`);
    }
    current = next as Record<string, unknown>;
  }
  current[leaf] = value;
}

function tracesForError(ir: CrddIr, code: string): string[] {
  return ir.operation.errors.find((entry) => entry.code === code)?.traces ?? ir.operation.traces;
}
