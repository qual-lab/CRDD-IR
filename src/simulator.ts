import { evaluateExpression, getPath } from "./expression.ts";
import type { CrddIr, SimulationRequest, SimulationResult } from "./model.ts";

export function simulate(ir: CrddIr, request: SimulationRequest): SimulationResult {
  validateRequest(ir, request);
  const originalState = structuredClone(request.state);
  const workingState = structuredClone(request.state);
  const context = { input: request.input, state: workingState };

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

function validateRequest(ir: CrddIr, request: SimulationRequest): void {
  for (const [name, definition] of Object.entries(ir.operation.input)) {
    const value = request.input[name];
    if (value === undefined) throw new Error(`Missing input "${name}"`);
    if (definition.type === "number" && typeof value !== "number") {
      throw new Error(`Input "${name}" must be a number`);
    }
    if (definition.minimum !== undefined && typeof value === "number" && value < definition.minimum) {
      throw new Error(`Input "${name}" must be >= ${definition.minimum}`);
    }
  }
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
