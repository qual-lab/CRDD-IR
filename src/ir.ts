import { readFile } from "node:fs/promises";
import { extractReferences } from "./expression.ts";
import { DiagnosticError, formatDiagnosticText } from "./diagnostics.ts";
import type { CrddIr, Diagnostic, FieldDefinition } from "./model.ts";

const allowedFieldTypes = new Set([
  "number", "integer", "string", "boolean", "array", "object", "map", "union", "opaque",
]);
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
  const kind = operation.kind;
  if (!["command", "query"].includes(String(kind))) {
    diagnostics.push(error("$.operation.kind", 'must be "command" or "query"'));
  }
  const traces = requireStringArray(operation, "traces", "$.operation", diagnostics);
  if (traces && traces.length === 0) {
    diagnostics.push(error("$.operation.traces", "must contain at least one CRDD ID"));
  }

  validateFields(operation.input, "$.operation.input", diagnostics);
  validateFields(operation.state, "$.operation.state", diagnostics);
  if (operation.output !== undefined) {
    if (!isRecord(operation.output)) diagnostics.push(error("$.operation.output", "must be a field definition"));
    else validateField(operation.output, "$.operation.output", diagnostics);
  }

  if (!Array.isArray(operation.requires)) {
    diagnostics.push(error("$.operation.requires", "must be an array"));
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

  if (!Array.isArray(operation.effects) || (kind !== "query" && operation.effects.length === 0)) {
    diagnostics.push(error("$.operation.effects", kind === "query" ? "must be an array" : "must be a non-empty array"));
  } else {
    if (kind === "query" && operation.effects.length > 0) {
      diagnostics.push(error("$.operation.effects", "query operations must not declare state effects"));
    }
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
  if (!Array.isArray(operation.errors)) {
    diagnostics.push(error("$.operation.errors", "must be an array"));
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
  validatePortableRules(operation.portableRules, errorCodes, diagnostics);

  if (kind !== "query" && !isRecord(operation.transaction)) {
    diagnostics.push(error("$.operation.transaction", "must be an object"));
  } else if (isRecord(operation.transaction)) {
    requireBoolean(operation.transaction, "atomic", "$.operation.transaction", diagnostics);
    requireBoolean(operation.transaction, "rollbackOnFailure", "$.operation.transaction", diagnostics);
    if (operation.transaction.atomic === true && operation.transaction.rollbackOnFailure !== true) {
      diagnostics.push(
        error("$.operation.transaction.rollbackOnFailure", "must be true when the operation is atomic"),
      );
    }
  }

  validateExecution(operation.execution, diagnostics);
  validateEvents(operation.emits, diagnostics);
  warnForDuplicates(operation.traces, "$.operation.traces", diagnostics);
  validateExtensions(operation.extensions, diagnostics);
  validateSemantics(operation, diagnostics);
  return diagnostics;
}

function validatePortableRules(
  value: unknown,
  errorCodes: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(error("$.operation.portableRules", "must be an array"));
    return;
  }
  const ids: string[] = [];
  const requiredByKind: Record<string, string[]> = {
    "collection.unique": ["collection", "key"],
    "collection.reference": ["collection", "reference", "target", "targetKey"],
    "collection.membership": ["collection", "parentReference", "parents", "parentKey"],
    "collection.relation": ["collection", "from", "to", "elements", "elementKey"],
    "collection.not-contains": ["value", "collection", "targetKey"],
    "collection.prospective-unique": ["candidates", "candidateKey", "existing", "existingKey"],
    "opaque.integrity": ["target"],
    "opaque.immutable-when-inactive": ["current", "proposed"],
    "opaque.reject-edit-when-inactive": ["current", "intent"],
  };
  value.forEach((rule, index) => {
    const path = `$.operation.portableRules[${index}]`;
    if (!isRecord(rule)) {
      diagnostics.push(error(path, "must be an object"));
      return;
    }
    const id = requireString(rule, "id", path, diagnostics);
    if (id) ids.push(id);
    const errorCode = requireString(rule, "error", path, diagnostics);
    if (errorCode && !errorCodes.has(errorCode)) {
      diagnostics.push(error(`${path}.error`, `references undeclared error "${errorCode}"`));
    }
    const required = requiredByKind[String(rule.kind)];
    if (!required) {
      diagnostics.push(error(`${path}.kind`, "has an unsupported portable rule kind"));
      return;
    }
    for (const key of required) requireString(rule, key, path, diagnostics);
    for (const key of ["targetType", "fromType", "toType"]) {
      if (rule[key] === undefined) continue;
      if (!isRecord(rule[key])) {
        diagnostics.push(error(`${path}.${key}`, "must be an object"));
      } else {
        requireString(rule[key], "field", `${path}.${key}`, diagnostics);
        requireString(rule[key], "equals", `${path}.${key}`, diagnostics);
      }
    }
  });
  reportDuplicateIds(ids, "$.operation.portableRules", "portable rule ID", diagnostics);
}

function validateExecution(value: unknown, diagnostics: Diagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push(error("$.operation.execution", "must be an object"));
    return;
  }
  if (!["sync", "async"].includes(String(value.mode))) {
    diagnostics.push(error("$.operation.execution.mode", 'must be "sync" or "async"'));
  }
  if (value.cancelable !== undefined && typeof value.cancelable !== "boolean") {
    diagnostics.push(error("$.operation.execution.cancelable", "must be a boolean"));
  }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0)) {
    diagnostics.push(error("$.operation.execution.timeoutMs", "must be a positive integer"));
  }
  if (value.idempotency !== undefined &&
      !["none", "optional", "required"].includes(String(value.idempotency))) {
    diagnostics.push(error("$.operation.execution.idempotency",
      'must be "none", "optional", or "required"'));
  }
  if (value.mode === "sync" && value.cancelable === true) {
    diagnostics.push(error("$.operation.execution.cancelable", "is supported only for async execution"));
  }
}

function validateEvents(value: unknown, diagnostics: Diagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(error("$.operation.emits", "must be an array"));
    return;
  }
  const types: string[] = [];
  value.forEach((event, index) => {
    const path = `$.operation.emits[${index}]`;
    if (!isRecord(event)) {
      diagnostics.push(error(path, "must be an object"));
      return;
    }
    const type = requireString(event, "type", path, diagnostics);
    if (type) types.push(type);
    requireStringArray(event, "traces", path, diagnostics);
    if (event.delivery !== undefined &&
        !["at-most-once", "at-least-once"].includes(String(event.delivery))) {
      diagnostics.push(error(`${path}.delivery`, 'must be "at-most-once" or "at-least-once"'));
    }
    if (event.payload !== undefined) {
      if (!isRecord(event.payload)) diagnostics.push(error(`${path}.payload`, "must be a field definition"));
      else validateField(event.payload, `${path}.payload`, diagnostics);
    }
  });
  reportDuplicateIds(types, "$.operation.emits", "event type", diagnostics);
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
  if (Array.isArray(operation.portableRules)) {
    operation.portableRules.forEach((candidate, index) => {
      if (!isRecord(candidate)) return;
      validatePortableRuleReferences(
        candidate,
        `$.operation.portableRules[${index}]`,
        input,
        state,
        diagnostics,
      );
    });
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
      if (effect.action === "increment" && !["number", "integer"].includes(targetField.type)) {
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
        if (targetField.items.type !== "object") {
          diagnostics.push(error(
            `${path}.target`,
            `${effect.action} requires an array with object items`,
          ));
          return;
        }
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

function validatePortableRuleReferences(
  rule: Record<string, unknown>,
  path: string,
  input: Record<string, FieldDefinition>,
  state: Record<string, FieldDefinition>,
  diagnostics: Diagnostic[],
): void {
  const field = (key: string) => {
    const reference = rule[key];
    if (typeof reference !== "string") return undefined;
    const resolved = fieldForReference(reference, input, state);
    if (!resolved) diagnostics.push(error(`${path}.${key}`, `references undefined field "${reference}"`));
    return resolved;
  };
  if (rule.kind === "opaque.integrity") {
    const target = field("target");
    if (target && target.type !== "opaque") diagnostics.push(error(`${path}.target`, "must reference an opaque field"));
    return;
  }
  if (rule.kind === "opaque.immutable-when-inactive") {
    const current = field("current");
    const proposed = field("proposed");
    if (current && current.type !== "opaque") diagnostics.push(error(`${path}.current`, "must reference an opaque field"));
    if (proposed && proposed.type !== "opaque") diagnostics.push(error(`${path}.proposed`, "must reference an opaque field"));
    return;
  }
  if (rule.kind === "opaque.reject-edit-when-inactive") {
    const current = field("current");
    const intent = field("intent");
    if (current && current.type !== "opaque") diagnostics.push(error(`${path}.current`, "must reference an opaque field"));
    if (intent && intent.type !== "boolean") diagnostics.push(error(`${path}.intent`, "must reference a boolean field"));
    return;
  }
  if (rule.kind === "collection.not-contains") {
    const value = field("value");
    const collection = field("collection");
    const item = collectionObjectItem(collection);
    if (!item) {
      diagnostics.push(error(`${path}.collection`, "must reference an array or map of objects"));
      return;
    }
    requirePortableIdDefinition(value, `${path}.value`, diagnostics);
    const targetKey = String(rule.targetKey ?? "");
    const target = item.properties[targetKey];
    if (!target) diagnostics.push(error(`${path}.targetKey`, `references undefined collection member "${targetKey}"`));
    requirePortableIdDefinition(target, `${path}.targetKey`, diagnostics);
    if (value && target && value.type !== target.type) {
      diagnostics.push(error(`${path}.value`, "must have the same type as targetKey"));
    }
    return;
  }
  if (rule.kind === "collection.prospective-unique") {
    const candidates = field("candidates");
    const existing = field("existing");
    const candidateItem = collectionObjectItem(candidates);
    const existingItem = collectionObjectItem(existing);
    if (!candidateItem) diagnostics.push(error(`${path}.candidates`, "must reference an array or map of objects"));
    if (!existingItem) diagnostics.push(error(`${path}.existing`, "must reference an array or map of objects"));
    if (!candidateItem || !existingItem) return;
    const candidateKey = String(rule.candidateKey ?? "");
    const existingKey = String(rule.existingKey ?? "");
    const candidate = candidateItem.properties[candidateKey];
    const current = existingItem.properties[existingKey];
    if (!candidate) diagnostics.push(error(`${path}.candidateKey`, `references undefined collection member "${candidateKey}"`));
    if (!current) diagnostics.push(error(`${path}.existingKey`, `references undefined collection member "${existingKey}"`));
    requirePortableIdDefinition(candidate, `${path}.candidateKey`, diagnostics);
    requirePortableIdDefinition(current, `${path}.existingKey`, diagnostics);
    if (candidate && current && candidate.type !== current.type) {
      diagnostics.push(error(`${path}.candidateKey`, "must have the same type as existingKey"));
    }
    return;
  }
  const collection = field("collection");
  const collectionItem = collectionObjectItem(collection);
  if (!collectionItem) {
    diagnostics.push(error(`${path}.collection`, "must reference an array or map of objects"));
    return;
  }
  const requireMember = (
    item: Extract<FieldDefinition, { type: "object" }>,
    key: string,
  ) => {
    const member = rule[key];
    if (typeof member === "string" && !item.properties[member]) {
      diagnostics.push(error(`${path}.${key}`, `references undefined collection member "${member}"`));
    }
  };
  const requireTypeFilter = (
    item: Extract<FieldDefinition, { type: "object" }>,
    key: string,
  ) => {
    const filter = rule[key];
    if (isRecord(filter) && typeof filter.field === "string" && !item.properties[filter.field]) {
      diagnostics.push(error(`${path}.${key}.field`, `references undefined type field "${filter.field}"`));
    }
  };
  if (rule.kind === "collection.unique") {
    requirePortableIdMember(collectionItem, "key");
    return;
  }
  if (rule.kind === "collection.reference" || rule.kind === "collection.membership") {
    const referenceKey = rule.kind === "collection.reference" ? "reference" : "parentReference";
    const targetKey = rule.kind === "collection.reference" ? "target" : "parents";
    const memberKey = rule.kind === "collection.reference" ? "targetKey" : "parentKey";
    requirePortableIdMember(collectionItem, referenceKey);
    const target = field(targetKey);
    const targetItem = collectionObjectItem(target);
    if (!targetItem) {
      diagnostics.push(error(`${path}.${targetKey}`, "must reference an array or map of objects"));
    } else {
      requirePortableIdMember(targetItem, memberKey);
      requireCompatibleMembers(collectionItem, referenceKey, targetItem, memberKey);
      if (rule.kind === "collection.reference") requireTypeFilter(targetItem, "targetType");
    }
    return;
  }
  if (rule.kind === "collection.relation") {
    requirePortableIdMember(collectionItem, "from");
    requirePortableIdMember(collectionItem, "to");
    const elements = field("elements");
    const elementItem = collectionObjectItem(elements);
    if (!elementItem) {
      diagnostics.push(error(`${path}.elements`, "must reference an array or map of objects"));
    } else {
      requirePortableIdMember(elementItem, "elementKey");
      requireCompatibleMembers(collectionItem, "from", elementItem, "elementKey");
      requireCompatibleMembers(collectionItem, "to", elementItem, "elementKey");
      requireTypeFilter(elementItem, "fromType");
      requireTypeFilter(elementItem, "toType");
    }
  }

  function requirePortableIdMember(
    item: Extract<FieldDefinition, { type: "object" }>,
    key: string,
  ): void {
    requireMember(item, key);
    const memberName = rule[key];
    if (typeof memberName !== "string") return;
    const definition = item.properties[memberName];
    if (definition && definition.type !== "string" && definition.type !== "integer") {
      diagnostics.push(error(`${path}.${key}`, "must reference a string or integer member"));
    }
  }

  function requireCompatibleMembers(
    left: Extract<FieldDefinition, { type: "object" }>,
    leftKey: string,
    right: Extract<FieldDefinition, { type: "object" }>,
    rightKey: string,
  ): void {
    const leftName = rule[leftKey];
    const rightName = rule[rightKey];
    if (typeof leftName !== "string" || typeof rightName !== "string") return;
    const leftField = left.properties[leftName];
    const rightField = right.properties[rightName];
    if (leftField && rightField && leftField.type !== rightField.type) {
      diagnostics.push(error(`${path}.${leftKey}`, `must have the same type as ${rightKey}`));
    }
  }
}

function requirePortableIdDefinition(
  field: FieldDefinition | undefined,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (field && field.type !== "string" && field.type !== "integer") {
    diagnostics.push(error(path, "must reference a string or integer field"));
  }
}

function collectionObjectItem(
  field: FieldDefinition | undefined,
): Extract<FieldDefinition, { type: "object" }> | undefined {
  if (field?.type === "array" && field.items.type === "object") return field.items;
  if (field?.type === "map" && field.values.type === "object") return field.values;
  return undefined;
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
      ((expected.type === "number" || expected.type === "integer") && typeof candidate !== "number") ||
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
  if (rawField.maximum !== undefined && typeof rawField.maximum !== "number") {
    diagnostics.push(error(`${path}.maximum`, "must be a number"));
  }
  if (typeof rawField.minimum === "number" && typeof rawField.maximum === "number" &&
      rawField.minimum > rawField.maximum) {
    diagnostics.push(error(path, "minimum must be <= maximum"));
  }
  if (!["number", "integer"].includes(String(rawField.type)) &&
      (rawField.minimum !== undefined || rawField.maximum !== undefined)) {
    diagnostics.push(error(path, "minimum and maximum are supported only for numeric fields"));
  }
  for (const key of ["minLength", "maxLength"] as const) {
    if (rawField[key] !== undefined && (!Number.isInteger(rawField[key]) || rawField[key] < 0)) {
      diagnostics.push(error(`${path}.${key}`, "must be a non-negative integer"));
    }
  }
  if (typeof rawField.minLength === "number" && typeof rawField.maxLength === "number" &&
      rawField.minLength > rawField.maxLength) {
    diagnostics.push(error(path, "minLength must be <= maxLength"));
  }
  if (rawField.type !== "string" &&
      (rawField.minLength !== undefined || rawField.maxLength !== undefined || rawField.pattern !== undefined)) {
    diagnostics.push(error(path, "length and pattern constraints are supported only for string fields"));
  }
  if (rawField.pattern !== undefined) {
    if (typeof rawField.pattern !== "string") {
      diagnostics.push(error(`${path}.pattern`, "must be a string"));
    } else {
      try {
        new RegExp(rawField.pattern, "u");
      } catch {
        diagnostics.push(error(`${path}.pattern`, "must be a valid regular expression"));
      }
    }
  }
  if (rawField.nullable !== undefined && typeof rawField.nullable !== "boolean") {
    diagnostics.push(error(`${path}.nullable`, "must be a boolean"));
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
  const scalarType = ["number", "integer", "string", "boolean"].includes(String(rawField.type));
  if (scalarType && rawField.optional === true && rawField.default === undefined) {
    diagnostics.push(error(`${path}.default`, "is required when optional is true"));
  }
  if (rawField.optional !== true && rawField.default !== undefined) {
    diagnostics.push(error(`${path}.default`, "requires optional to be true"));
  }
  if (!scalarType && rawField.default !== undefined) {
    diagnostics.push(error(`${path}.default`, "is supported only for scalar fields"));
  }
  if (rawField.default !== undefined) {
    const expected = rawField.type;
    if (
      ((expected === "number" || expected === "integer") && typeof rawField.default !== "number") ||
      (expected === "string" && typeof rawField.default !== "string") ||
      (expected === "boolean" && typeof rawField.default !== "boolean")
    ) {
      diagnostics.push(error(`${path}.default`, `must have type "${expected}"`));
    }
    if (rawField.type === "string" && Array.isArray(rawField.enum) &&
        !rawField.enum.includes(rawField.default)) {
      diagnostics.push(error(`${path}.default`, "must be one of the declared enum values"));
    }
    if ((rawField.type === "number" || rawField.type === "integer") && typeof rawField.default === "number" &&
        typeof rawField.minimum === "number" && rawField.default < rawField.minimum) {
      diagnostics.push(error(`${path}.default`, `must be >= ${rawField.minimum}`));
    }
    if (rawField.type === "integer" && typeof rawField.default === "number" &&
        !Number.isInteger(rawField.default)) {
      diagnostics.push(error(`${path}.default`, "must be an integer"));
    }
  }
  if (rawField.type === "array") {
    if (!isRecord(rawField.items)) {
      diagnostics.push(error(`${path}.items`, "must define an object item schema or another field schema"));
      return;
    }
    validateField(rawField.items, `${path}.items`, diagnostics);
    for (const key of ["minItems", "maxItems"] as const) {
      if (rawField[key] !== undefined && (!Number.isInteger(rawField[key]) || rawField[key] < 0)) {
        diagnostics.push(error(`${path}.${key}`, "must be a non-negative integer"));
      }
    }
    if (typeof rawField.minItems === "number" && typeof rawField.maxItems === "number" &&
        rawField.minItems > rawField.maxItems) {
      diagnostics.push(error(path, "minItems must be <= maxItems"));
    }
  } else if (rawField.type === "map") {
    if (!isRecord(rawField.values)) {
      diagnostics.push(error(`${path}.values`, "must define a field schema"));
      return;
    }
    validateField(rawField.values, `${path}.values`, diagnostics);
  } else if (rawField.type === "object") {
    if (!isRecord(rawField.properties) || Object.keys(rawField.properties).length === 0) {
      diagnostics.push(error(`${path}.properties`, "must be a non-empty object"));
      return;
    }
    validateFields(rawField.properties, `${path}.properties`, diagnostics);
  } else if (rawField.type === "opaque") {
    if (rawField.encoding !== "base64") {
      diagnostics.push(error(`${path}.encoding`, 'must equal "base64"'));
    }
    if (rawField.digest !== "sha256") {
      diagnostics.push(error(`${path}.digest`, 'must equal "sha256"'));
    }
  } else if (rawField.type === "union") {
    if (typeof rawField.discriminator !== "string" || rawField.discriminator.length === 0) {
      diagnostics.push(error(`${path}.discriminator`, "must be a non-empty string"));
    }
    if (!Array.isArray(rawField.variants) || rawField.variants.length < 2) {
      diagnostics.push(error(`${path}.variants`, "must contain at least two object variants"));
      return;
    }
    rawField.variants.forEach((variant, index) => {
      if (!isRecord(variant) || variant.type !== "object") {
        diagnostics.push(error(`${path}.variants[${index}]`, "must define an object field"));
        return;
      }
      validateField(variant, `${path}.variants[${index}]`, diagnostics);
      if (typeof rawField.discriminator === "string" && isRecord(variant.properties)) {
        const discriminator = variant.properties[rawField.discriminator];
        if (!isRecord(discriminator) || discriminator.type !== "string" ||
            !Array.isArray(discriminator.enum) || discriminator.enum.length !== 1) {
          diagnostics.push(error(
            `${path}.variants[${index}].properties.${rawField.discriminator}`,
            "must be a string field with exactly one enum value",
          ));
        }
      }
    });
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
