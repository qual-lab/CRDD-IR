import type { CrddIr, SimulationRequest, TestCase, TestManifest } from "./model.ts";

export function generateTestManifest(ir: CrddIr): TestManifest {
  const baseline = createBaseline(ir);
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

  return {
    version: "0.1",
    operation: ir.operation.id,
    traces: ir.operation.traces,
    cases,
  };
}

function createBaseline(ir: CrddIr): SimulationRequest {
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(ir.operation.input)) {
    if (field.type === "number") input[name] = Math.max(field.minimum ?? 0, name === "cost" ? 100 : 1);
    else if (field.type === "string") input[name] = "sample";
    else if (field.type === "boolean") input[name] = true;
    else input[name] = [];
  }

  const state: Record<string, unknown> = {};
  for (const [path, field] of Object.entries(ir.operation.state)) {
    const value = field.type === "array" ? [] : field.type === "number" ? 1_000_000 : null;
    setPath(state, path, value);
  }
  return { input, state };
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
