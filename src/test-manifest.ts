import type { CrddIr, SimulationRequest, TestCase, TestManifest } from "./model.ts";
import { evaluateExpression, extractReferences, getPath } from "./expression.ts";

export function generateTestManifest(ir: CrddIr): TestManifest {
  const baseline = satisfyRequirements(ir, createBaseline(ir));
  const cases: TestCase[] = [
    {
      id: `${slug(ir.operation.id)}-success`,
      description: `${ir.operation.id} succeeds when every precondition is satisfied`,
      arrange: structuredClone(baseline),
      expect: { ok: true },
    },
  ];

  for (const requirement of ir.operation.requires) {
    const literalBoundary = requirement.expression.match(/^input\.([A-Za-z_]\w*)\s*>=\s*(\d+(?:\.\d+)?)$/);
    if (literalBoundary) {
      const [, field, rawBoundary] = literalBoundary;
      const boundary = Number(rawBoundary);
      const epsilon = decimalEpsilon(rawBoundary);

      const atBoundary = structuredClone(baseline);
      atBoundary.input[field] = boundary;
      cases.push({
        id: `${slug(requirement.id)}-at-boundary`,
        sourceRequirement: requirement.id,
        description: `${field} equal to ${boundary} is accepted`,
        arrange: atBoundary,
        expect: { ok: true },
      });

      const belowBoundary = structuredClone(baseline);
      const precision = Math.max(3, decimalPlaces(rawBoundary) + 1);
      belowBoundary.input[field] = Number((boundary - epsilon).toFixed(precision));
      cases.push({
        id: `${slug(requirement.id)}-below-boundary`,
        sourceRequirement: requirement.id,
        description: `${field} below ${boundary} is rejected without state changes`,
        arrange: belowBoundary,
        expect: { ok: false, error: requirement.error, stateUnchanged: true },
      });
      continue;
    }

    const stateVsInput = requirement.expression.match(
      /^state\.([A-Za-z_][\w.]*)\s*>=\s*input\.([A-Za-z_]\w*)$/,
    );
    if (stateVsInput) {
      const [, statePath, inputField] = stateVsInput;
      const required = Number(baseline.input[inputField]);

      const exact = structuredClone(baseline);
      setPath(exact.state, statePath, required);
      cases.push({
        id: `${slug(requirement.id)}-exact`,
        sourceRequirement: requirement.id,
        description: `${statePath} equal to ${inputField} is accepted`,
        arrange: exact,
        expect: { ok: true },
      });

      const insufficient = structuredClone(baseline);
      setPath(insufficient.state, statePath, required - 1);
      cases.push({
        id: `${slug(requirement.id)}-insufficient`,
        sourceRequirement: requirement.id,
        description: `${statePath} one unit below ${inputField} is rejected without state changes`,
        arrange: insufficient,
        expect: { ok: false, error: requirement.error, stateUnchanged: true },
      });
    }
  }

  for (const requirement of ir.operation.requires) {
    if (cases.some((testCase) =>
      testCase.sourceRequirement === requirement.id && testCase.expect.ok === false
    )) continue;
    const falsified = falsifyRequirement(ir, requirement.id, baseline);
    if (!falsified) {
      throw new Error(
        `Cannot derive a failing conformance case for requirement "${requirement.id}"`,
      );
    }
    cases.push({
      id: `${slug(requirement.id)}-falsified`,
      sourceRequirement: requirement.id,
      description: `${requirement.id} is rejected by a deterministic counterexample`,
      arrange: falsified,
      expect: { ok: false, error: requirement.error, stateUnchanged: true },
    });
  }

  return {
    version: "0.1",
    operation: ir.operation.id,
    traces: ir.operation.traces,
    cases,
  };
}

export function analyzeTestCoverage(ir: CrddIr, manifest: TestManifest): {
  requirements: number;
  covered: number;
  uncovered: string[];
} {
  const uncovered = ir.operation.requires
    .filter((requirement) => !manifest.cases.some((testCase) =>
      testCase.sourceRequirement === requirement.id && testCase.expect.ok === false
    ))
    .map((requirement) => requirement.id);
  return {
    requirements: ir.operation.requires.length,
    covered: ir.operation.requires.length - uncovered.length,
    uncovered,
  };
}

function falsifyRequirement(
  ir: CrddIr,
  requirementId: string,
  baseline: SimulationRequest,
): SimulationRequest | undefined {
  const requirement = ir.operation.requires.find((item) => item.id === requirementId)!;
  const numericSeeds = numericCandidates(ir);
  for (const reference of extractReferences(requirement.expression)) {
    const request = structuredClone(baseline);
    const current = getPath(request, reference);
    for (const candidate of mutationCandidates(current, numericSeeds)) {
      const mutated = structuredClone(request);
      setPath(mutated as unknown as Record<string, unknown>, reference, candidate);
      try {
        if (fieldAllows(ir, reference, candidate) &&
            evaluateExpression(requirement.expression, mutated as unknown as Record<string, unknown>) === false &&
            ir.operation.requires
              .filter((item) => item.id !== requirementId)
              .every((item) =>
                evaluateExpression(item.expression, mutated as unknown as Record<string, unknown>) === true
              )) {
          return mutated;
        }
      } catch {
        // A candidate that violates expression typing is not a valid counterexample.
      }
    }
  }
  return undefined;
}

function mutationCandidates(value: unknown, numericSeeds: number[] = []): unknown[] {
  if (typeof value === "number") {
    return [...new Set([
      0, -1, value - 1, value + 1,
      ...numericSeeds.flatMap((candidate) => [candidate, candidate - epsilon(candidate), candidate + epsilon(candidate)]),
    ])];
  }
  if (typeof value === "boolean") return [!value];
  if (typeof value === "string") return ["", "__crdd_counterexample__"];
  return [];
}

function satisfyRequirements(ir: CrddIr, initial: SimulationRequest): SimulationRequest {
  let request = structuredClone(initial);
  const requirements = ir.operation.requires;
  const satisfied = (candidate: SimulationRequest) => requirements.filter((requirement) =>
    evaluateExpression(requirement.expression, candidate as unknown as Record<string, unknown>) === true
  ).length;
  if (satisfied(request) === requirements.length) return request;

  const references = [...new Set(requirements.flatMap((requirement) =>
    extractReferences(requirement.expression)
  ))].sort();
  const numericSeeds = numericCandidates(ir);
  let frontier = [{ request, score: satisfied(request), key: canonicalRequest(request) }];
  const visited = new Set(frontier.map((item) => item.key));
  for (let pass = 0; pass < Math.max(4, references.length); pass += 1) {
    const next: typeof frontier = [];
    for (const entry of frontier) {
      for (const reference of references) {
        const current = getPath(entry.request, reference);
        for (const value of mutationCandidates(current, numericSeeds)) {
          if (!fieldAllows(ir, reference, value)) continue;
          const candidate = structuredClone(entry.request);
          setPath(candidate as unknown as Record<string, unknown>, reference, value);
          const key = canonicalRequest(candidate);
          if (visited.has(key)) continue;
          visited.add(key);
          let score: number;
          try {
            score = satisfied(candidate);
          } catch {
            continue;
          }
          if (score === requirements.length) return candidate;
          next.push({ request: candidate, score, key });
        }
      }
    }
    if (next.length === 0) break;
    next.sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
    frontier = next.slice(0, 64);
    request = frontier[0].request;
  }
  const failed = requirements.filter((requirement) =>
    evaluateExpression(requirement.expression, request as unknown as Record<string, unknown>) !== true
  ).map((requirement) => requirement.id);
  throw new Error(
    `Cannot derive a satisfying conformance baseline; unsatisfied requirement(s): ${failed.join(", ")}`,
  );
}

function canonicalRequest(request: SimulationRequest): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, sort(child)]),
          )
        : value;
  return JSON.stringify(sort(request));
}

function numericCandidates(ir: CrddIr): number[] {
  const values = ir.operation.requires.flatMap((requirement) =>
    [...requirement.expression.matchAll(/(?:^|[^\w.])(-?\d+(?:\.\d+)?)(?:$|[^\w.])/g)]
      .map((match) => Number(match[1]))
  );
  return [...new Set([0, 1, ...values])].sort((a, b) => a - b);
}

function fieldAllows(ir: CrddIr, reference: string, value: unknown): boolean {
  const [root, ...parts] = reference.split(".");
  let field: import("./model.ts").FieldDefinition | undefined =
    root === "input"
      ? ir.operation.input[parts.shift() ?? ""]
      : root === "state"
        ? ir.operation.state[parts.shift() ?? ""]
        : undefined;
  for (const part of parts) {
    if (field?.type !== "object") return true;
    field = field.properties[part];
  }
  if (!field || field.type === "array" || field.type === "object") return true;
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) &&
      (field.minimum === undefined || value >= field.minimum);
  }
  if (field.type === "string") {
    return typeof value === "string" && (!field.enum || field.enum.includes(value));
  }
  return typeof value === "boolean";
}

function epsilon(value: number): number {
  return Number.isInteger(value) ? 0.001 : 10 ** -(Math.min(9, decimalPlaces(String(value)) + 1));
}

function createBaseline(ir: CrddIr): SimulationRequest {
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(ir.operation.input)) {
    input[name] = baselineFieldValue(field);
  }

  const state: Record<string, unknown> = {};
  for (const [path, field] of Object.entries(ir.operation.state)) {
    const value = field.type === "number" ? 1_000_000 : baselineFieldValue(field);
    setPath(state, path, value);
  }
  for (const effect of ir.operation.effects) {
    if (effect.action !== "remove" && effect.action !== "update") continue;
    const statePath = effect.target.startsWith("state.") ? effect.target.slice(6) : "";
    const field = ir.operation.state[statePath];
    const collection = getPath({ state }, effect.target);
    if (field?.type !== "array" || !Array.isArray(collection)) continue;
    const item = Object.fromEntries(Object.entries(field.items.properties).map(([name, definition]) => [
      name,
      definition.type === "number" ? 0 : definition.type === "boolean" ? false : "",
    ]));
    Object.assign(item, resolveTemplate(effect.where, { input, state }));
    collection.push(item);
  }
  return { input, state };
}

function baselineFieldValue(field: import("./model.ts").FieldDefinition): unknown {
  if (field.type === "object") {
    return Object.fromEntries(
      Object.entries(field.properties).map(([name, property]) => [name, baselineFieldValue(property)]),
    );
  }
  if (field.type === "array") return [];
  if (field.default !== undefined) return structuredClone(field.default);
  if (field.type === "number") return Math.max(field.minimum ?? 0, 1);
  if (field.type === "string") return field.enum?.[0] ?? "sample";
  return true;
}

function resolveTemplate(
  value: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, candidate]) => [
    key,
    typeof candidate === "string" && candidate.startsWith("$")
      ? structuredClone(getPath(context, candidate.slice(1)))
      : structuredClone(candidate),
  ]));
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  const leaf = parts.pop()!;
  let current = root;
  for (const part of parts) {
    if (typeof current[part] !== "object" || current[part] === null) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[leaf] = value;
}

function decimalPlaces(raw: string): number {
  return raw.includes(".") ? raw.split(".")[1].length : 0;
}

function decimalEpsilon(raw: string): number {
  return 10 ** -Math.max(3, decimalPlaces(raw) + 1);
}

function slug(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}
