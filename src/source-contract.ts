import { readFile } from "node:fs/promises";
import { LineCounter, parseDocument } from "yaml";
import type { AssetDefinition, Effect, FieldDefinition } from "./model.ts";

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
    const problem = document.errors[0];
    const position = problem.linePos?.[0];
    const line = position ? fence.startLine + position.line : fence.startLine;
    throw new Error(`${path}:${line}:${position?.col ?? 1}: ${problem.message}`);
  }

  const value = document.toJS() as unknown;
  validateSourceContract(value, path, fence.startLine);
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

function validateSourceContract(value: unknown, path: string, line: number): void {
  if (!isRecord(value)) fail(path, line, "contract must be an object");
  if (value.schema !== "crdd-source-contract/v0.1") {
    fail(path, line, 'schema must equal "crdd-source-contract/v0.1"');
  }
  if (!isRecord(value.operation)) fail(path, line, "operation must be an object");
  const operation = value.operation;
  requireString(operation, "id", path, line);
  requireStringArray(operation, "traces", path, line);
  requireRecord(operation, "input", path, line);
  requireRecord(operation, "state", path, line);
  requireArray(operation, "requires", path, line);
  requireArray(operation, "effects", path, line);
  requireArray(operation, "errors", path, line);
  if (operation.assets !== undefined && !Array.isArray(operation.assets)) {
    fail(path, line, "assets must be an array");
  }
  if (!isRecord(operation.transaction)) fail(path, line, "transaction must be an object");
  if (typeof operation.transaction.atomic !== "boolean") fail(path, line, "transaction.atomic must be boolean");
  if (typeof operation.transaction.rollback_on_failure !== "boolean") {
    fail(path, line, "transaction.rollback_on_failure must be boolean");
  }

  for (const [index, requirement] of operation.requires.entries()) {
    if (!isRecord(requirement)) fail(path, line, `requires[${index}] must be an object`);
    requireString(requirement, "id", path, line);
    requireString(requirement, "condition", path, line);
    requireString(requirement, "error", path, line);
  }
}

function requireString(value: Record<string, unknown>, key: string, path: string, line: number): void {
  if (typeof value[key] !== "string" || value[key].length === 0) fail(path, line, `${key} must be a string`);
}

function requireStringArray(value: Record<string, unknown>, key: string, path: string, line: number): void {
  if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((item) => typeof item !== "string")) {
    fail(path, line, `${key} must be a string array`);
  }
}

function requireRecord(value: Record<string, unknown>, key: string, path: string, line: number): void {
  if (!isRecord(value[key])) fail(path, line, `${key} must be an object`);
}

function requireArray(value: Record<string, unknown>, key: string, path: string, line: number): void {
  if (!Array.isArray(value[key]) || (value[key] as unknown[]).length === 0) {
    fail(path, line, `${key} must be a non-empty array`);
  }
}

function fail(path: string, line: number, message: string): never {
  throw new Error(`${path}:${line}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
