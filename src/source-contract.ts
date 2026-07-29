import { readFile } from "node:fs/promises";
import { LineCounter, parseDocument } from "yaml";
import { DiagnosticError } from "./diagnostics.ts";
import type { AssetDefinition, Diagnostic, Effect, FieldDefinition, IrExtension } from "./model.ts";

export type SourceRequirement = {
  id: string;
  condition: string;
  error: string;
};

export type SourceContract = {
  schema: "crdd-source-contract/v0.1";
  operation: {
    id: string;
    traces: string[];
    input: Record<string, FieldDefinition>;
    state: Record<string, FieldDefinition>;
    requires: SourceRequirement[];
    effects: Effect[];
    errors: Array<{ code: string; traces: string[] }>;
    transaction: {
      atomic: boolean;
      rollback_on_failure: boolean;
    };
    assets?: Array<Omit<AssetDefinition, "material"> & {
      material: { base_color: [number, number, number] };
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
    ["id", "traces", "input", "state", "requires", "effects", "errors", "assets", "extensions", "transaction"],
    "$.operation",
    add,
  );
  requireString(operation.id, "$.operation.id", add);
  requireStringArray(operation.traces, "$.operation.traces", add);
  requireRecord(operation.input, "$.operation.input", add);
  requireRecord(operation.state, "$.operation.state", add);
  requireArray(operation.requires, "$.operation.requires", add);
  requireArray(operation.effects, "$.operation.effects", add);
  requireArray(operation.errors, "$.operation.errors", add);
  if (operation.assets !== undefined && !Array.isArray(operation.assets)) {
    add("CRDD_SOURCE_TYPE", "$.operation.assets", "must be an array");
  }
  if (operation.extensions !== undefined && !isRecord(operation.extensions)) {
    add("CRDD_SOURCE_TYPE", "$.operation.extensions", "must be an object");
  }
  if (!isRecord(operation.transaction)) {
    add("CRDD_SOURCE_REQUIRED", "$.operation.transaction", "must be an object");
  } else {
    rejectUnknown(operation.transaction, ["atomic", "rollback_on_failure"], "$.operation.transaction", add);
    requireBoolean(operation.transaction.atomic, "$.operation.transaction.atomic", add);
    requireBoolean(
      operation.transaction.rollback_on_failure,
      "$.operation.transaction.rollback_on_failure",
      add,
    );
  }
  if (Array.isArray(operation.requires)) {
    for (const [index, requirement] of operation.requires.entries()) {
      const base = `$.operation.requires[${index}]`;
      if (!isRecord(requirement)) {
        add("CRDD_SOURCE_TYPE", base, "must be an object");
        continue;
      }
      rejectUnknown(requirement, ["id", "condition", "error"], base, add);
      requireString(requirement.id, `${base}.id`, add);
      requireString(requirement.condition, `${base}.condition`, add);
      requireString(requirement.error, `${base}.error`, add);
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
      const allowed = action === "append"
        ? ["target", "action", "value"]
        : action === "remove"
          ? ["target", "action", "where"]
          : action === "update"
            ? ["target", "action", "where", "set"]
        : ["target", "action", "expression"];
      rejectUnknown(effect, allowed, base, add);
      requireString(effect.target, `${base}.target`, add);
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

type AddDiagnostic = (code: string, path: string, message: string) => void;

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
function requireArray(value: unknown, path: string, add: AddDiagnostic): void {
  if (!Array.isArray(value) || value.length === 0) add("CRDD_SOURCE_REQUIRED", path, "must be a non-empty array");
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
