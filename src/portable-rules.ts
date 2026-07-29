import { createHash } from "node:crypto";
import { getPath } from "./expression.ts";
import type { CrddIr, PortableRule } from "./model.ts";

export type PortableRuleFailure = {
  id: string;
  error: string;
};

export function evaluatePortableRules(
  ir: CrddIr,
  context: { input: Record<string, unknown>; state: Record<string, unknown> },
): PortableRuleFailure | undefined {
  for (const rule of ir.operation.portableRules ?? []) {
    if (!portableRuleSatisfied(rule, context)) return { id: rule.id, error: rule.error };
  }
  return undefined;
}

export function portableRuleSatisfied(
  rule: PortableRule,
  context: { input: Record<string, unknown>; state: Record<string, unknown> },
): boolean {
  if (rule.kind === "opaque.integrity") return validOpaque(getPath(context, rule.target));
  if (rule.kind === "opaque.immutable-when-inactive") {
    const current = getPath(context, rule.current);
    const proposed = getPath(context, rule.proposed);
    return isOpaque(current) && isOpaque(proposed) &&
      (current.active || opaqueEqual(current, proposed));
  }

  const collection = collectionValues(getPath(context, rule.collection));
  if (!collection) return false;
  if (rule.kind === "collection.unique") {
    const keys = collection.map((item) => member(item, rule.key));
    return keys.every(isPortableId) && new Set(keys).size === keys.length;
  }
  if (rule.kind === "collection.reference") {
    const target = collectionValues(getPath(context, rule.target));
    if (!target) return false;
    return collection.every((item) => target.some((candidate) =>
      Object.is(member(item, rule.reference), member(candidate, rule.targetKey)) &&
      matchesType(candidate, rule.targetType)
    ));
  }
  if (rule.kind === "collection.membership") {
    const parents = collectionValues(getPath(context, rule.parents));
    if (!parents) return false;
    return collection.every((item) => parents.some((parent) =>
      Object.is(member(item, rule.parentReference), member(parent, rule.parentKey))
    ));
  }
  const elements = collectionValues(getPath(context, rule.elements));
  if (!elements) return false;
  return collection.every((relation) =>
    endpointExists(elements, member(relation, rule.from), rule.elementKey, rule.fromType) &&
    endpointExists(elements, member(relation, rule.to), rule.elementKey, rule.toType)
  );
}

export function canonicalOpaque(value: unknown): {
  base64: string;
  sha256: string;
  active: boolean;
} | undefined {
  if (!validOpaque(value)) return undefined;
  const opaque = value as { base64: string; sha256: string; active: boolean };
  return { base64: opaque.base64, sha256: opaque.sha256, active: opaque.active };
}

function collectionValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => (value as Record<string, unknown>)[key]);
  return undefined;
}

function endpointExists(
  elements: unknown[],
  id: unknown,
  key: string,
  type: { field: string; equals: string } | undefined,
): boolean {
  return elements.some((element) => Object.is(member(element, key), id) && matchesType(element, type));
}

function matchesType(value: unknown, type?: { field: string; equals: string }): boolean {
  return !type || Object.is(member(value, type.field), type.equals);
}

function member(value: unknown, path: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return path.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)[part]
      : undefined, value);
}

function isPortableId(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

function isOpaque(value: unknown): value is { base64: string; sha256: string; active: boolean } {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).base64 === "string" &&
    typeof (value as Record<string, unknown>).sha256 === "string" &&
    typeof (value as Record<string, unknown>).active === "boolean";
}

function validOpaque(value: unknown): boolean {
  if (!isOpaque(value) || !/^[a-f0-9]{64}$/.test(value.sha256)) return false;
  try {
    const bytes = Buffer.from(value.base64, "base64");
    if (bytes.toString("base64") !== value.base64) return false;
    return createHash("sha256").update(bytes).digest("hex") === value.sha256;
  } catch {
    return false;
  }
}

function opaqueEqual(left: unknown, right: unknown): boolean {
  return isOpaque(left) && isOpaque(right) &&
    left.base64 === right.base64 && left.sha256 === right.sha256 && left.active === right.active;
}
