import { readFile } from "node:fs/promises";
import { LineCounter, parseDocument } from "yaml";
import { DiagnosticError } from "./diagnostics.ts";
import type { Diagnostic, Effect, FieldDefinition, IrExtension, PortableRule } from "./model.ts";

export type SourceRequirement = {
  id: string;
  condition: string;
  error: string;
  when?: string;
};

export type SourceContract = {
  schema: "crdd-source-contract/v0.1";
  operation: {
    id: string;
    kind: "command" | "query";
    traces: string[];
    input: Record<string, FieldDefinition>;
    state: Record<string, FieldDefinition>;
    output?: FieldDefinition;
    returns?: unknown;
    requires: SourceRequirement[];
    portable_rules?: PortableRule[];
    effects: Effect[];
    errors: Array<{ code: string; traces: string[] }>;
    conformance?: {
      baseline?: Partial<{ input: Record<string, unknown>; state: Record<string, unknown> }>;
      seeds?: Array<{
        id: string;
        when: string;
        input?: Record<string, unknown>;
        state?: Record<string, unknown>;
      }>;
      coverage?: Array<{
        id: string;
        strategy: "pairwise" | "exhaustive";
        fields: string[];
        when?: string;
      }>;
    };
    transaction?: {
      atomic: boolean;
      rollback_on_failure: boolean;
    };
    execution?: {
      mode: "sync" | "async";
      cancelable?: boolean;
      timeout_ms?: number;
      idempotency?: "none" | "optional" | "required";
    };
    emits?: Array<{
      type: string;
      payload?: FieldDefinition;
      when?: string;
      value?: unknown;
      delivery?: "at-most-once" | "at-least-once";
      traces: string[];
    }>;
    extensions?: Record<string, IrExtension>;
  };
};

export type ContractFence = {
  sourcePath: string;
  startLine: number;
  endLine: number;
  content: string;
};

export async function loadSourceContract(path: string): Promise<{
  contract: SourceContract;
  fence: ContractFence;
}> {
  const markdown = await readFile(path, "utf8");
  const fences = extractContractFences(markdown, path);
  if (fences.length === 0) throw new Error(`${path}: no crdd-contract fence found`);
  if (fences.length > 1) {
    throw new Error(`${path}: expected one crdd-contract fence, found ${fences.length}`);
  }

  const fence = fences[0];
  const lineCounter = new LineCounter();
  const document = parseDocument(fence.content, {
    lineCounter,
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new DiagnosticError(document.errors.map((problem) => {
      const position = problem.linePos?.[0];
      return {
        code: "CRDD_SOURCE_YAML",
        severity: "error",
        path: "$",
        message: problem.message,
        location: {
          line: position ? fence.startLine + position.line - 1 : fence.startLine,
          column: position?.col ?? 1,
        },
      };
    }), path);
  }

  const value = document.toJS() as unknown;
  const diagnostics = validateSourceContract(value, document, lineCounter, fence);
  if (diagnostics.length > 0) throw new DiagnosticError(diagnostics, path);
  return { contract: value as SourceContract, fence };
}

export function extractContractFences(markdown: string, sourcePath = "<memory>"): ContractFence[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const fences: ContractFence[] = [];
  let start: number | undefined;
  let content: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (start === undefined && /^```crdd-contract\s*$/.test(line)) {
      start = index + 2;
      content = [];
      continue;
    }
    if (start !== undefined && /^```\s*$/.test(line)) {
      fences.push({
        sourcePath,
        startLine: start,
        endLine: index,
        content: content.join("\n"),
      });
      start = undefined;
      content = [];
      continue;
    }
    if (start !== undefined) content.push(line);
  }

  if (start !== undefined) throw new Error(`${sourcePath}:${start - 1}: unterminated crdd-contract fence`);
  return fences;
}

function validateSourceContract(
  value: unknown,
  document: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  fence: ContractFence,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push(
    located(code, path, message, document, lineCounter, fence),
  );
  if (!isRecord(value)) {
    add("CRDD_SOURCE_TYPE", "$", "contract must be an object");
    return diagnostics;
  }
  rejectUnknown(value, ["schema", "operation"], "$", add);
  if (value.schema !== "crdd-source-contract/v0.1") {
    add("CRDD_SOURCE_VERSION", "$.schema", 'must equal "crdd-source-contract/v0.1"');
  }
  if (!isRecord(value.operation)) {
    add("CRDD_SOURCE_REQUIRED", "$.operation", "must be an object");
    return diagnostics;
  }
  const operation = value.operation;
  rejectUnknown(
    operation,
    ["id", "kind", "traces", "input", "state", "output", "returns", "requires", "effects", "errors",
      "extensions", "transaction", "execution", "emits", "portable_rules", "conformance"],
    "$.operation",
    add,
  );
  requireString(operation.id, "$.operation.id", add);
  if (!["command", "query"].includes(String(operation.kind))) {
    add("CRDD_SOURCE_TYPE", "$.operation.kind", 'must be "command" or "query"');
  }
  requireStringArray(operation.traces, "$.operation.traces", add);
  requireRecord(operation.input, "$.operation.input", add);
  requireRecord(operation.state, "$.operation.state", add);
  requireArray(operation.requires, "$.operation.requires", add, true);
  requireArray(operation.effects, "$.operation.effects", add, operation.kind === "query");
  requireArray(operation.errors, "$.operation.errors", add, true);
  if (operation.portable_rules !== undefined) {
    requireArray(operation.portable_rules, "$.operation.portable_rules", add, true);
    validatePortableRules(operation.portable_rules, add);
  }
  validateConformance(operation.conformance, add);
  if (operation.extensions !== undefined && !isRecord(operation.extensions)) {
    add("CRDD_SOURCE_TYPE", "$.operation.extensions", "must be an object");
  }
  if (operation.kind !== "query" && !isRecord(operation.transaction)) {
    add("CRDD_SOURCE_REQUIRED", "$.operation.transaction", "must be an object");
  } else if (isRecord(operation.transaction)) {
    rejectUnknown(operation.transaction, ["atomic", "rollback_on_failure"], "$.operation.transaction", add);
    requireBoolean(operation.transaction.atomic, "$.operation.transaction.atomic", add);
    requireBoolean(
      operation.transaction.rollback_on_failure,
      "$.operation.transaction.rollback_on_failure",
      add,
    );
  }
  if (operation.kind === "query" && Array.isArray(operation.effects) && operation.effects.length > 0) {
    add("CRDD_SOURCE_EFFECT", "$.operation.effects", "query operations must not declare state effects");
  }
  if (operation.execution !== undefined) {
    if (!isRecord(operation.execution)) {
      add("CRDD_SOURCE_TYPE", "$.operation.execution", "must be an object");
    } else {
      rejectUnknown(operation.execution, ["mode", "cancelable", "timeout_ms", "idempotency"],
        "$.operation.execution", add);
      if (!["sync", "async"].includes(String(operation.execution.mode))) {
        add("CRDD_SOURCE_TYPE", "$.operation.execution.mode", 'must be "sync" or "async"');
      }
      if (operation.execution.cancelable !== undefined) {
        requireBoolean(operation.execution.cancelable, "$.operation.execution.cancelable", add);
      }
      if (operation.execution.timeout_ms !== undefined &&
          (!Number.isInteger(operation.execution.timeout_ms) || operation.execution.timeout_ms <= 0)) {
        add("CRDD_SOURCE_TYPE", "$.operation.execution.timeout_ms", "must be a positive integer");
      }
      if (operation.execution.idempotency !== undefined &&
          !["none", "optional", "required"].includes(String(operation.execution.idempotency))) {
        add("CRDD_SOURCE_TYPE", "$.operation.execution.idempotency",
          'must be "none", "optional", or "required"');
      }
    }
  }
  if (operation.emits !== undefined && !Array.isArray(operation.emits)) {
    add("CRDD_SOURCE_TYPE", "$.operation.emits", "must be an array");
  }
  if (operation.returns !== undefined && operation.output === undefined) {
    add("CRDD_SOURCE_REQUIRED", "$.operation.output", "output is required when returns is declared");
  }
  if (operation.returns !== undefined) validateExpressionMapping(operation.returns, "$.operation.returns", add);
  if (Array.isArray(operation.emits)) {
    for (const [index, event] of operation.emits.entries()) {
      const base = `$.operation.emits[${index}]`;
      if (!isRecord(event)) { add("CRDD_SOURCE_TYPE", base, "must be an object"); continue; }
      rejectUnknown(event, ["type", "payload", "when", "value", "delivery", "traces"], base, add);
      requireString(event.type, `${base}.type`, add);
      requireStringArray(event.traces, `${base}.traces`, add);
      if (event.when !== undefined) requireString(event.when, `${base}.when`, add);
      if (event.value !== undefined && event.payload === undefined) {
        add("CRDD_SOURCE_REQUIRED", `${base}.payload`, "payload is required when value is declared");
      }
      if (event.value !== undefined) validateExpressionMapping(event.value, `${base}.value`, add);
    }
  }
  if (Array.isArray(operation.requires)) {
    for (const [index, requirement] of operation.requires.entries()) {
      const base = `$.operation.requires[${index}]`;
      if (!isRecord(requirement)) {
        add("CRDD_SOURCE_TYPE", base, "must be an object");
        continue;
      }
      rejectUnknown(requirement, ["id", "condition", "error", "when"], base, add);
      requireString(requirement.id, `${base}.id`, add);
      requireString(requirement.condition, `${base}.condition`, add);
      requireString(requirement.error, `${base}.error`, add);
      if (requirement.when !== undefined) requireString(requirement.when, `${base}.when`, add);
    }
  }
  if (Array.isArray(operation.effects)) {
    for (const [index, effect] of operation.effects.entries()) {
      const base = `$.operation.effects[${index}]`;
      if (!isRecord(effect)) {
        add("CRDD_SOURCE_TYPE", base, "must be an object");
        continue;
      }
      const action = effect.action;
      const branchFields = ["when", "traces"];
      const allowed = action === "append"
        ? ["target", "action", "value", ...branchFields]
        : action === "remove"
          ? ["target", "action", "where", ...branchFields]
          : action === "update"
            ? ["target", "action", "where", "set", ...branchFields]
        : ["target", "action", "expression", ...branchFields];
      rejectUnknown(effect, allowed, base, add);
      requireString(effect.target, `${base}.target`, add);
      if (effect.when !== undefined) requireString(effect.when, `${base}.when`, add);
      if (effect.traces !== undefined) requireStringArray(effect.traces, `${base}.traces`, add);
      if (!["assign", "append", "increment", "remove", "update"].includes(String(action))) {
        add(
          "CRDD_SOURCE_EFFECT",
          `${base}.action`,
          'must be "assign", "append", "increment", "remove", or "update"',
        );
      } else if (action === "append") {
        if (!Object.hasOwn(effect, "value")) add("CRDD_SOURCE_REQUIRED", `${base}.value`, "is required");
      } else if (action === "remove") {
        requireRecord(effect.where, `${base}.where`, add);
      } else if (action === "update") {
        requireRecord(effect.where, `${base}.where`, add);
        requireRecord(effect.set, `${base}.set`, add);
      } else {
        requireString(effect.expression, `${base}.expression`, add);
      }
    }
  }
  if (Array.isArray(operation.errors)) {
    for (const [index, error] of operation.errors.entries()) {
      const base = `$.operation.errors[${index}]`;
      if (!isRecord(error)) {
        add("CRDD_SOURCE_TYPE", base, "must be an object");
        continue;
      }
      rejectUnknown(error, ["code", "traces"], base, add);
      requireString(error.code, `${base}.code`, add);
      requireStringArray(error.traces, `${base}.traces`, add);
    }
  }
  return diagnostics;
}

function validateConformance(value: unknown, add: AddDiagnostic): void {
  if (value === undefined) return;
  const path = "$.operation.conformance";
  if (!isRecord(value)) {
    add("CRDD_SOURCE_TYPE", path, "must be an object");
    return;
  }
  rejectUnknown(value, ["baseline", "seeds", "coverage"], path, add);
  if (value.baseline !== undefined) validateFixtureValues(value.baseline, `${path}.baseline`, add);
  if (value.seeds !== undefined && !Array.isArray(value.seeds)) {
    add("CRDD_SOURCE_TYPE", `${path}.seeds`, "must be an array");
  } else if (Array.isArray(value.seeds)) {
    const ids = new Set<string>();
    value.seeds.forEach((seed, index) => {
      const seedPath = `${path}.seeds[${index}]`;
      if (!isRecord(seed)) {
        add("CRDD_SOURCE_TYPE", seedPath, "must be an object");
        return;
      }
      rejectUnknown(seed, ["id", "when", "input", "state"], seedPath, add);
      requireString(seed.id, `${seedPath}.id`, add);
      requireString(seed.when, `${seedPath}.when`, add);
      if (typeof seed.id === "string" && ids.has(seed.id)) {
        add("CRDD_SOURCE_DUPLICATE", `${seedPath}.id`, `duplicate conformance seed ID "${seed.id}"`);
      }
      if (typeof seed.id === "string") ids.add(seed.id);
      validateFixtureValues(seed, seedPath, add);
      if (seed.input === undefined && seed.state === undefined) {
        add("CRDD_SOURCE_REQUIRED", seedPath, "must define input or state values");
      }
    });
  }
  if (value.coverage !== undefined && !Array.isArray(value.coverage)) {
    add("CRDD_SOURCE_TYPE", `${path}.coverage`, "must be an array");
  } else if (Array.isArray(value.coverage)) {
    const ids = new Set<string>();
    value.coverage.forEach((coverage, index) => {
      const coveragePath = `${path}.coverage[${index}]`;
      if (!isRecord(coverage)) {
        add("CRDD_SOURCE_TYPE", coveragePath, "must be an object");
        return;
      }
      rejectUnknown(coverage, ["id", "strategy", "fields", "when"], coveragePath, add);
      requireString(coverage.id, `${coveragePath}.id`, add);
      if (!['pairwise', 'exhaustive'].includes(String(coverage.strategy))) {
        add("CRDD_SOURCE_TYPE", `${coveragePath}.strategy`, 'must be "pairwise" or "exhaustive"');
      }
      requireStringArray(coverage.fields, `${coveragePath}.fields`, add);
      if (Array.isArray(coverage.fields) && coverage.fields.length < 2) {
        add("CRDD_SOURCE_TYPE", `${coveragePath}.fields`, "must contain at least two fields");
      }
      if (coverage.when !== undefined) requireString(coverage.when, `${coveragePath}.when`, add);
      if (typeof coverage.id === "string" && ids.has(coverage.id)) {
        add("CRDD_SOURCE_DUPLICATE", `${coveragePath}.id`, `duplicate coverage ID "${coverage.id}"`);
      }
      if (typeof coverage.id === "string") ids.add(coverage.id);
    });
  }
}

function validateFixtureValues(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) {
    add("CRDD_SOURCE_TYPE", path, "must be an object");
    return;
  }
  for (const key of ["input", "state"] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) {
      add("CRDD_SOURCE_TYPE", `${path}.${key}`, "must be an object");
    }
  }
}

function validatePortableRules(value: unknown, add: AddDiagnostic): void {
  if (!Array.isArray(value)) return;
  const shapes: Record<string, string[]> = {
    "collection.all": ["kind", "id", "error", "collection", "predicates"],
    "collection.any": ["kind", "id", "error", "collection", "predicates"],
    "collection.unique": ["kind", "id", "error", "collection", "key"],
    "collection.reference": [
      "kind", "id", "error", "collection", "reference", "target", "targetKey", "targetType",
    ],
    "collection.membership": [
      "kind", "id", "error", "collection", "parentReference", "parents", "parentKey",
    ],
    "collection.relation": [
      "kind", "id", "error", "collection", "from", "to", "elements", "elementKey",
      "fromType", "toType",
    ],
    "collection.not-contains": ["kind", "id", "error", "value", "collection", "targetKey"],
    "collection.prospective-unique": [
      "kind", "id", "error", "candidates", "candidateKey", "existing", "existingKey",
    ],
    "opaque.integrity": ["kind", "id", "error", "target"],
    "opaque.immutable-when-inactive": ["kind", "id", "error", "current", "proposed"],
    "opaque.reject-edit-when-inactive": ["kind", "id", "error", "current", "intent"],
    "evidence.canonical-hash": ["kind", "id", "error", "source", "hash"],
  };
  value.forEach((rule, index) => {
    const path = `$.operation.portable_rules[${index}]`;
    if (!isRecord(rule)) {
      add("CRDD_SOURCE_TYPE", path, "must be an object");
      return;
    }
    const allowed = shapes[String(rule.kind)];
    if (!allowed) {
      add("CRDD_SOURCE_PORTABLE_RULE", `${path}.kind`, "uses an unsupported portable rule kind");
      return;
    }
    rejectUnknown(rule, allowed, path, add);
    if (rule.kind === "collection.all" || rule.kind === "collection.any") {
      requireString(rule.kind, `${path}.kind`, add);
      requireString(rule.id, `${path}.id`, add);
      requireString(rule.error, `${path}.error`, add);
      requireString(rule.collection, `${path}.collection`, add);
      if (!Array.isArray(rule.predicates) || rule.predicates.length === 0) {
        add("CRDD_SOURCE_PORTABLE_RULE", `${path}.predicates`, "must be a non-empty array");
      } else {
        rule.predicates.forEach((predicate, predicateIndex) => {
          const predicatePath = `${path}.predicates[${predicateIndex}]`;
          if (!isRecord(predicate)) {
            add("CRDD_SOURCE_TYPE", predicatePath, "must be an object");
            return;
          }
          rejectUnknown(predicate, ["field", "operator", "reference", "value"], predicatePath, add);
          requireString(predicate.field, `${predicatePath}.field`, add);
          if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(String(predicate.operator))) {
            add("CRDD_SOURCE_PORTABLE_RULE", `${predicatePath}.operator`, "uses an unsupported comparison operator");
          }
          const hasReference = predicate.reference !== undefined;
          const hasValue = predicate.value !== undefined;
          if (hasReference === hasValue) {
            add("CRDD_SOURCE_PORTABLE_RULE", predicatePath, "must declare exactly one of reference or value");
          }
          if (hasReference) requireString(predicate.reference, `${predicatePath}.reference`, add);
          if (hasValue && !["string", "number", "boolean"].includes(typeof predicate.value)) {
            add("CRDD_SOURCE_TYPE", `${predicatePath}.value`, "must be a string, number, or boolean");
          }
        });
      }
      return;
    }
    for (const key of allowed.filter((key) => !["targetType", "fromType", "toType"].includes(key))) {
      if (rule.kind === "collection.unique" && key === "key" && rule[key] === undefined) continue;
      requireString(rule[key], `${path}.${key}`, add);
    }
    for (const key of ["targetType", "fromType", "toType"]) {
      if (rule[key] === undefined) continue;
      if (!isRecord(rule[key])) {
        add("CRDD_SOURCE_TYPE", `${path}.${key}`, "must be an object");
      } else {
        rejectUnknown(rule[key], ["field", "equals"], `${path}.${key}`, add);
        requireString(rule[key].field, `${path}.${key}.field`, add);
        requireString(rule[key].equals, `${path}.${key}.equals`, add);
      }
    }
  });
}

type AddDiagnostic = (code: string, path: string, message: string) => void;

function validateExpressionMapping(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value === "string") {
    if (value.length === 0) add("CRDD_SOURCE_REQUIRED", path, "expression must not be empty");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateExpressionMapping(item, `${path}[${index}]`, add));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) validateExpressionMapping(item, `${path}.${key}`, add);
    return;
  }
  add("CRDD_SOURCE_TYPE", path, "must be an expression string or a mapping of expression strings");
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  add: AddDiagnostic,
): void {
  for (const key of Object.keys(value).filter((key) => !allowed.includes(key))) {
    add("CRDD_SOURCE_UNKNOWN_FIELD", `${path}.${key}`, "field is not allowed");
  }
}

function requireString(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value !== "string" || value.length === 0) add("CRDD_SOURCE_REQUIRED", path, "must be a non-empty string");
}
function requireStringArray(value: unknown, path: string, add: AddDiagnostic): void {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((item) => typeof item !== "string" || item.length === 0)) {
    add("CRDD_SOURCE_TYPE", path, "must be a non-empty string array");
  }
}
function requireRecord(value: unknown, path: string, add: AddDiagnostic): void {
  if (!isRecord(value)) add("CRDD_SOURCE_TYPE", path, "must be an object");
}
function requireArray(value: unknown, path: string, add: AddDiagnostic, allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    add("CRDD_SOURCE_REQUIRED", path, allowEmpty ? "must be an array" : "must be a non-empty array");
  }
}
function requireBoolean(value: unknown, path: string, add: AddDiagnostic): void {
  if (typeof value !== "boolean") add("CRDD_SOURCE_TYPE", path, "must be a boolean");
}

function located(
  code: string,
  path: string,
  message: string,
  document: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  fence: ContractFence,
): Diagnostic {
  const segments = [...path.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g)]
    .map((match) => match[1] ?? Number(match[2]));
  let node: any;
  for (let length = segments.length; length >= 0 && !node; length -= 1) {
    node = document.getIn(segments.slice(0, length), true);
  }
  const position = node?.range ? lineCounter.linePos(node.range[0]) : undefined;
  return {
    code,
    severity: "error",
    path,
    message,
    location: {
      line: position ? fence.startLine + position.line - 1 : fence.startLine,
      column: position?.col ?? 1,
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
