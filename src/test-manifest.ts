import { createHash } from "node:crypto";
import type { CrddIr, SimulationRequest, TestCase, TestManifest } from "./model.ts";
import { evaluateExpression, extractReferences, getPath } from "./expression.ts";
import {
  parseSourceExpression,
  type ExpressionNode,
} from "./source-expression.ts";
import { defaultUnitRegistry } from "./unit-registry.ts";
import { canonicalJson } from "./portable-rules.ts";

export function generateTestManifest(ir: CrddIr): TestManifest {
  const baseline = refreshEvidenceHashes(ir, canonicalizeBaselineUnits(
    ir,
    satisfyRequirements(ir, createBaseline(ir)),
  ));
  const cases: TestCase[] = [
    {
      id: `${slug(ir.operation.id)}-success`,
      description: `${ir.operation.id} succeeds when every precondition is satisfied`,
      arrange: structuredClone(baseline),
      expect: { ok: true },
    },
  ];
  for (const [fieldName, field] of Object.entries(ir.operation.input)) {
    if (field.type !== "union") continue;
    for (const variant of field.variants.slice(1)) {
      const variantValue = baselineFieldValue(variant);
      const discriminator = String((variantValue as Record<string, unknown>)[field.discriminator]);
      const arrange = structuredClone(baseline);
      arrange.input[fieldName] = variantValue;
      cases.push({
        id: `${slug(ir.operation.id)}-${slug(fieldName)}-${slug(discriminator)}`,
        description: `${fieldName} variant ${discriminator} round-trips without flattening`,
        arrange,
        expect: { ok: true },
      });
    }
  }

  const ownedBranches = new Set<string>();
  for (const [index, effect] of ir.operation.effects.entries()) {
    if (!effect.when || ownedBranches.has(effect.when)) continue;
    ownedBranches.add(effect.when);
    const selection = effect.when.match(/^input\.([A-Za-z_]\w*)\s*==\s*("(?:[^"\\]|\\.)*")$/);
    if (!selection) {
      throw new Error(
        `Cannot derive deterministic branch coverage for effect[${index}] condition "${effect.when}"; ` +
        "supported branch fixtures require input.<enum> == <string literal>",
      );
    }
    const [, fieldName, literal] = selection;
    const field = ir.operation.input[fieldName];
    const value = JSON.parse(literal) as string;
    if (field?.type !== "string" || !field.enum?.includes(value)) {
      throw new Error(`Effect branch "${effect.when}" must select a declared input enum value`);
    }
    const arrange = structuredClone(baseline);
    arrange.input[fieldName] = value;
    const conflicting = ir.operation.requires.filter((requirement) =>
      !requirementSatisfied(requirement, arrange)
    );
    if (conflicting.length > 0) {
      throw new Error(
        `Cannot cover effect branch "${effect.when}" because Requires conflict: ` +
        conflicting.map((item) => item.id).join(", "),
      );
    }
    cases.push({
      id: `${slug(ir.operation.id)}-branch-${slug(fieldName)}-${slug(value)}`,
      description: `effect branch ${effect.when} is selected atomically`,
      arrange,
      expect: { ok: true },
    });
  }

  for (const requirement of ir.operation.requires) {
    const requirementBaseline = selectRequirementBranch(ir, requirement, baseline);
    const arithmeticBoundary = deriveArithmeticBoundaryCases(
      ir,
      requirement.id,
      requirementBaseline,
    );
    if (arithmeticBoundary) {
      cases.push(...arithmeticBoundary);
      continue;
    }

    const literalBoundary = requirement.expression.match(/^input\.([A-Za-z_]\w*)\s*>=\s*(\d+(?:\.\d+)?)$/);
    if (literalBoundary) {
      const [, field, rawBoundary] = literalBoundary;
      const boundary = Number(rawBoundary);
      const epsilon = decimalEpsilon(rawBoundary);

      const atBoundary = structuredClone(requirementBaseline);
      atBoundary.input[field] = boundary;
      cases.push({
        id: `${slug(requirement.id)}-at-boundary`,
        sourceRequirement: requirement.id,
        description: `${field} equal to ${boundary} is accepted`,
        arrange: atBoundary,
        expect: { ok: true },
      });

      const belowBoundary = structuredClone(requirementBaseline);
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

      const exact = structuredClone(requirementBaseline);
      setPath(exact.state, statePath, required);
      cases.push({
        id: `${slug(requirement.id)}-exact`,
        sourceRequirement: requirement.id,
        description: `${statePath} equal to ${inputField} is accepted`,
        arrange: exact,
        expect: { ok: true },
      });

      const insufficient = structuredClone(requirementBaseline);
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
    const falsified = falsifyRequirement(
      ir,
      requirement.id,
      selectRequirementBranch(ir, requirement, baseline),
    );
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

  for (const rule of ir.operation.portableRules ?? []) {
    if (rule.kind === "opaque.immutable-when-inactive") {
      const editable = structuredClone(baseline);
      const current = structuredClone(getPath(editable as unknown as Record<string, unknown>, rule.current)) as
        Record<string, unknown>;
      current.active = true;
      setPath(editable as unknown as Record<string, unknown>, rule.current, current);
      setPath(editable as unknown as Record<string, unknown>, rule.proposed, {
        base64: "AQ==",
        sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
        active: true,
      });
      cases.push({
        id: `${slug(rule.id)}-active-edit`,
        sourceRequirement: rule.id,
        description: "an active understood extension can be replaced atomically",
        arrange: editable,
        expect: { ok: true },
      });
    }
    const failed = falsifyPortableRule(ir, rule.id, baseline);
    cases.push({
      id: `${slug(rule.id)}-rejected`,
      sourceRequirement: rule.id,
      description: `${rule.kind} is rejected deterministically without state changes`,
      arrange: failed,
      expect: { ok: false, error: rule.error, stateUnchanged: true },
    });
  }

  const evidenceRuleIds = new Set((ir.operation.portableRules ?? [])
    .filter((rule) => rule.kind === "evidence.canonical-hash")
    .map((rule) => rule.id));
  for (const testCase of cases) {
    if (!testCase.sourceRequirement || !evidenceRuleIds.has(testCase.sourceRequirement)) {
      refreshEvidenceHashes(ir, testCase.arrange);
    }
  }
  return {
    version: "0.1",
    operation: ir.operation.id,
    traces: ir.operation.traces,
    cases,
  };
}

function refreshEvidenceHashes(ir: CrddIr, request: SimulationRequest): SimulationRequest {
  for (const rule of ir.operation.portableRules ?? []) {
    if (rule.kind !== "evidence.canonical-hash") continue;
    const source = request[rule.source] as Record<string, unknown>;
    const hashField = rule.hash.split(".").slice(1);
    const payload = structuredClone(source);
    let owner = payload;
    for (const segment of hashField.slice(0, -1)) {
      owner = owner[segment] as Record<string, unknown>;
    }
    delete owner[hashField.at(-1)!];
    setPath(request as unknown as Record<string, unknown>, rule.hash,
      createHash("sha256").update(canonicalJson(payload)).digest("hex"));
  }
  return request;
}

type AffineExpression = {
  constant: number;
  coefficients: Map<string, number>;
};

type BoundaryScenario = {
  suffix: "at-boundary" | "inside-boundary" | "outside-boundary";
  gapSteps: -1 | 0 | 1;
  ok: boolean;
};

export class BoundaryCaseGenerationError extends Error {
  readonly requirementId: string;
  readonly expression: string;
  readonly classification: "unsupported" | "unsatisfiable";
  readonly conflicts: string[];

  constructor(
    requirementId: string,
    expression: string,
    classification: "unsupported" | "unsatisfiable",
    conflicts: string[],
    reason: string,
  ) {
    super(
      `Cannot generate arithmetic boundary cases; requirement="${requirementId}"; ` +
      `expression="${expression}"; classification=${classification}; reason=${reason}; ` +
      `conflicts=${conflicts.length > 0 ? conflicts.join(", ") : "none"}`,
    );
    this.name = "BoundaryCaseGenerationError";
    this.requirementId = requirementId;
    this.expression = expression;
    this.classification = classification;
    this.conflicts = conflicts;
  }
}

function deriveArithmeticBoundaryCases(
  ir: CrddIr,
  requirementId: string,
  baseline: SimulationRequest,
): TestCase[] | undefined {
  const requirement = ir.operation.requires.find((item) => item.id === requirementId)!;
  let ast: ExpressionNode;
  try {
    ast = parseSourceExpression(requirement.expression);
  } catch {
    return undefined;
  }
  if (
    ast.kind !== "binary" ||
    !["<=", "<", ">=", ">"].includes(ast.operator) ||
    !containsAdditive(ast.left) && !containsAdditive(ast.right)
  ) {
    return undefined;
  }

  const left = affine(ast.left);
  const right = affine(ast.right);
  if (!left || !right) {
    throw new BoundaryCaseGenerationError(
      requirement.id,
      requirement.expression,
      "unsupported",
      [],
      "the comparison is not an affine expression composed of references, literals, +, and -",
    );
  }
  const difference = subtractAffine(left, right);
  const references = [...difference.coefficients]
    .filter(([, coefficient]) => coefficient !== 0)
    .map(([reference]) => reference)
    .sort();
  if (references.length === 0) {
    throw new BoundaryCaseGenerationError(
      requirement.id,
      requirement.expression,
      "unsatisfiable",
      [requirement.id],
      "the arithmetic comparison has no adjustable field",
    );
  }

  const scenarios = boundaryScenarios(ast.operator);
  const generated: TestCase[] = [];
  const failures = new Set<string>();
  for (const scenario of scenarios) {
    let candidate: SimulationRequest | undefined;
    try {
      candidate = solveBoundaryScenario(
        ir,
        requirement.id,
        baseline,
        difference,
        references,
        scenario,
        failures,
      );
    } catch (error) {
      throw new BoundaryCaseGenerationError(
        requirement.id,
        requirement.expression,
        "unsupported",
        [...failures].sort(),
        (error as Error).message,
      );
    }
    if (!candidate) {
      throw new BoundaryCaseGenerationError(
        requirement.id,
        requirement.expression,
        "unsatisfiable",
        [...failures].sort(),
        `no schema-valid assignment satisfies the ${scenario.suffix} scenario while preserving every other requirement`,
      );
    }
    generated.push({
      id: `${slug(requirement.id)}-${scenario.suffix}`,
      sourceRequirement: requirement.id,
      description: `${requirement.expression} ${scenario.suffix.replaceAll("-", " ")}`,
      arrange: candidate,
      expect: scenario.ok
        ? { ok: true }
        : { ok: false, error: requirement.error, stateUnchanged: true },
    });
  }
  return generated;
}

function solveBoundaryScenario(
  ir: CrddIr,
  requirementId: string,
  baseline: SimulationRequest,
  difference: AffineExpression,
  references: string[],
  scenario: BoundaryScenario,
  failures: Set<string>,
): SimulationRequest | undefined {
  const baselineGap = evaluateAffine(difference, baseline);
  for (const reference of references) {
    const coefficient = difference.coefficients.get(reference)!;
    const current = getPath(baseline, reference);
    if (typeof current !== "number") {
      failures.add(`schema:${reference}:not-numeric`);
      continue;
    }
    const step = fieldStep(ir, reference);
    const desiredGap = checkedMultiply(scenario.gapSteps, step);
    const adjustment = checkedDivide(checkedSubtract(desiredGap, baselineGap), coefficient);
    const value = canonicalBoundaryNumber(checkedAdd(current, adjustment), step);
    if (!fieldAllows(ir, reference, value)) {
      failures.add(`schema:${reference}:minimum/maximum/type`);
      continue;
    }
    const candidate = structuredClone(baseline);
    setPath(candidate as unknown as Record<string, unknown>, reference, value);
    const failedRequirements: string[] = [];
    try {
      const actualGap = evaluateAffine(difference, candidate);
      if (Math.abs(actualGap - desiredGap) > Math.max(Number.EPSILON, step * 1e-9)) {
        failures.add(`unit:${reference}:cannot-represent-${scenario.suffix}`);
        continue;
      }
      for (const requirement of ir.operation.requires) {
        const actual = evaluateExpression(
          requirement.expression,
          candidate as unknown as Record<string, unknown>,
        );
        const expected = requirement.id === requirementId ? scenario.ok : true;
        if (actual !== expected) failedRequirements.push(requirement.id);
      }
    } catch (error) {
      failures.add(`arithmetic:${(error as Error).message}`);
      continue;
    }
    if (failedRequirements.length === 0) return candidate;
    failedRequirements.forEach((id) => failures.add(`requires:${id}`));
  }
  return undefined;
}

function canonicalizeBaselineUnits(
  ir: CrddIr,
  baseline: SimulationRequest,
): SimulationRequest {
  let result = structuredClone(baseline);
  const references = [...new Set(ir.operation.requires.flatMap((requirement) =>
    extractReferences(requirement.expression)
  ))].sort();
  for (const reference of references) {
    const current = getPath(result, reference);
    const field = fieldDefinition(ir, reference);
    if (
      typeof current !== "number" ||
      !field ||
      field.type !== "number" && field.type !== "integer"
    ) continue;
    const step = fieldStep(ir, reference);
    const rounded = canonicalBoundaryNumber(Math.round(current / step) * step, step);
    if (!fieldAllows(ir, reference, rounded)) continue;
    const candidate = structuredClone(result);
    setPath(candidate as unknown as Record<string, unknown>, reference, rounded);
    try {
      if (ir.operation.requires.every((requirement) =>
        evaluateExpression(
          requirement.expression,
          candidate as unknown as Record<string, unknown>,
        ) === true
      )) result = candidate;
    } catch {
      // Keep the already-valid baseline when canonicalization changes semantics.
    }
  }
  return result;
}

function boundaryScenarios(operator: string): BoundaryScenario[] {
  if (operator === "<=") {
    return [
      { suffix: "at-boundary", gapSteps: 0, ok: true },
      { suffix: "outside-boundary", gapSteps: 1, ok: false },
      { suffix: "inside-boundary", gapSteps: -1, ok: true },
    ];
  }
  if (operator === "<") {
    return [
      { suffix: "at-boundary", gapSteps: 0, ok: false },
      { suffix: "outside-boundary", gapSteps: 1, ok: false },
      { suffix: "inside-boundary", gapSteps: -1, ok: true },
    ];
  }
  if (operator === ">=") {
    return [
      { suffix: "at-boundary", gapSteps: 0, ok: true },
      { suffix: "outside-boundary", gapSteps: -1, ok: false },
      { suffix: "inside-boundary", gapSteps: 1, ok: true },
    ];
  }
  return [
    { suffix: "at-boundary", gapSteps: 0, ok: false },
    { suffix: "outside-boundary", gapSteps: -1, ok: false },
    { suffix: "inside-boundary", gapSteps: 1, ok: true },
  ];
}

function containsAdditive(node: ExpressionNode): boolean {
  return node.kind === "binary" &&
    (node.operator === "+" || node.operator === "-" ||
      containsAdditive(node.left) || containsAdditive(node.right));
}

function affine(node: ExpressionNode): AffineExpression | undefined {
  if (node.kind === "literal" && typeof node.value === "number") {
    return { constant: node.value, coefficients: new Map() };
  }
  if (node.kind === "reference") {
    return { constant: 0, coefficients: new Map([[node.path, 1]]) };
  }
  if (node.kind === "unary" && node.operator === "-") {
    const operand = affine(node.operand);
    return operand ? scaleAffine(operand, -1) : undefined;
  }
  if (node.kind === "binary" && (node.operator === "+" || node.operator === "-")) {
    const left = affine(node.left);
    const right = affine(node.right);
    if (!left || !right) return undefined;
    return addAffine(left, node.operator === "+" ? right : scaleAffine(right, -1));
  }
  return undefined;
}

function addAffine(left: AffineExpression, right: AffineExpression): AffineExpression {
  const coefficients = new Map(left.coefficients);
  for (const [reference, coefficient] of right.coefficients) {
    coefficients.set(
      reference,
      checkedAdd(coefficients.get(reference) ?? 0, coefficient),
    );
  }
  return {
    constant: checkedAdd(left.constant, right.constant),
    coefficients,
  };
}

function subtractAffine(left: AffineExpression, right: AffineExpression): AffineExpression {
  return addAffine(left, scaleAffine(right, -1));
}

function scaleAffine(expression: AffineExpression, factor: number): AffineExpression {
  return {
    constant: checkedMultiply(expression.constant, factor),
    coefficients: new Map(
      [...expression.coefficients].map(([reference, coefficient]) => [
        reference,
        checkedMultiply(coefficient, factor),
      ]),
    ),
  };
}

function evaluateAffine(expression: AffineExpression, request: SimulationRequest): number {
  let value = expression.constant;
  for (const [reference, coefficient] of expression.coefficients) {
    const operand = getPath(request, reference);
    if (typeof operand !== "number") throw new Error(`${reference} is not numeric`);
    value = checkedAdd(value, checkedMultiply(coefficient, operand));
  }
  return value;
}

function fieldStep(ir: CrddIr, reference: string): number {
  const field = fieldDefinition(ir, reference);
  if (field?.type === "integer") return 1;
  if (field?.type === "number" && field.unit) {
    return defaultUnitRegistry.compatible("m", field.unit)
      ? defaultUnitRegistry.convert(0.001, "m", field.unit)
      : 1;
  }
  const precision = Math.max(
    3,
    ...[field?.minimum, field?.maximum]
      .filter((value): value is number => value !== undefined)
      .map((value) => decimalPlaces(String(value))),
  );
  return 10 ** -Math.min(9, precision);
}

function fieldDefinition(
  ir: CrddIr,
  reference: string,
): import("./model.ts").FieldDefinition | undefined {
  const [root, ...parts] = reference.split(".");
  let field: import("./model.ts").FieldDefinition | undefined =
    root === "input"
      ? ir.operation.input[parts.shift() ?? ""]
      : root === "state"
        ? ir.operation.state[parts.shift() ?? ""]
        : undefined;
  for (const part of parts) {
    if (field?.type !== "object") return undefined;
    field = field.properties[part];
  }
  return field;
}

function canonicalBoundaryNumber(value: number, step: number): number {
  checkedNumber(value);
  const precision = Math.min(9, decimalPlaces(String(step)));
  const result = Number(value.toFixed(precision));
  checkedNumber(result);
  return Object.is(result, -0) ? 0 : result;
}

function checkedAdd(left: number, right: number): number {
  return checkedNumber(left + right);
}

function checkedSubtract(left: number, right: number): number {
  return checkedNumber(left - right);
}

function checkedMultiply(left: number, right: number): number {
  return checkedNumber(left * right);
}

function checkedDivide(left: number, right: number): number {
  if (right === 0) throw new Error("division by zero while solving a boundary");
  return checkedNumber(left / right);
}

function checkedNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error("numeric overflow/underflow while solving a boundary");
  }
  return value;
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
    const definition = fieldDefinition(ir, reference);
    const candidates = [
      ...mutationCandidates(current, numericSeeds),
      ...(definition?.type === "string" ? definition.enum ?? [] : []),
    ];
    for (const candidate of [...new Set(candidates)]) {
      const mutated = structuredClone(request);
      setPath(mutated as unknown as Record<string, unknown>, reference, candidate);
      try {
        if (fieldAllows(ir, reference, candidate) &&
            requirementSelected(requirement, mutated) &&
            evaluateExpression(requirement.expression, mutated as unknown as Record<string, unknown>) === false &&
            ir.operation.requires
              .filter((item) => item.id !== requirementId)
              .every((item) => requirementSatisfied(item, mutated))) {
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
    requirementSatisfied(requirement, candidate)
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
    !requirementSatisfied(requirement, request)
  ).map((requirement) => requirement.id);
  throw new Error(
    `Cannot derive a satisfying conformance baseline; unsatisfied requirement(s): ${failed.join(", ")}`,
  );
}

function requirementSelected(
  requirement: CrddIr["operation"]["requires"][number],
  request: SimulationRequest,
): boolean {
  return requirement.when === undefined ||
    evaluateExpression(requirement.when, request as unknown as Record<string, unknown>) === true;
}

function requirementSatisfied(
  requirement: CrddIr["operation"]["requires"][number],
  request: SimulationRequest,
): boolean {
  return !requirementSelected(requirement, request) ||
    evaluateExpression(requirement.expression, request as unknown as Record<string, unknown>) === true;
}

function selectRequirementBranch(
  ir: CrddIr,
  requirement: CrddIr["operation"]["requires"][number],
  baseline: SimulationRequest,
): SimulationRequest {
  if (!requirement.when) return baseline;
  const selection = requirement.when.match(/^input\.([A-Za-z_]\w*)\s*==\s*("(?:[^"\\]|\\.)*")$/);
  if (!selection) {
    throw new Error(
      `Cannot derive deterministic failure coverage for conditional Requires "${requirement.id}"; ` +
      `unsupported selector "${requirement.when}"`,
    );
  }
  const [, fieldName, literal] = selection;
  const value = JSON.parse(literal) as string;
  const field = ir.operation.input[fieldName];
  if (field?.type !== "string" || !field.enum?.includes(value)) {
    throw new Error(`Conditional Requires "${requirement.id}" must select a declared input enum value`);
  }
  const selected = structuredClone(baseline);
  selected.input[fieldName] = value;
  return selected;
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
  const field = fieldDefinition(ir, reference);
  if (!field || field.type === "array" || field.type === "object") return true;
  if (field.type === "number" || field.type === "integer") {
    return typeof value === "number" && Number.isFinite(value) &&
      (field.type !== "integer" || Number.isSafeInteger(value)) &&
      (field.minimum === undefined || value >= field.minimum) &&
      (field.maximum === undefined || value <= field.maximum);
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
    const value = field.type === "number" || field.type === "integer"
      ? Math.min(field.maximum ?? 1_000_000, 1_000_000)
      : baselineFieldValue(field);
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
  if (field.type === "map") return {};
  if (field.type === "union") {
    const variant = field.variants[0];
    return baselineFieldValue(variant);
  }
  if (field.type === "opaque") {
    return {
      base64: "",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      active: false,
    };
  }

  if (field.default !== undefined) return structuredClone(field.default);
  if (field.type === "number" || field.type === "integer") {
    return Math.min(
      field.maximum ?? Number.MAX_SAFE_INTEGER,
      Math.max(field.minimum ?? 0, 1),
    );
  }
  if (field.type === "string") {
    if (field.enum?.[0]) return field.enum[0];
    const fixedHex = field.pattern?.match(/^\^\[0-9a-f\]\{(\d+)\}\$$/);
    if (fixedHex) return "0".repeat(Number(fixedHex[1]));
    return "sample";
  }
  return true;
}

function falsifyPortableRule(ir: CrddIr, id: string, baseline: SimulationRequest): SimulationRequest {
  const rule = ir.operation.portableRules?.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`Unknown portable rule "${id}"`);
  const request = structuredClone(baseline);
  if (rule.kind === "opaque.integrity") {
    setPath(request as unknown as Record<string, unknown>, rule.target, {
      base64: "not-canonical!",
      sha256: "0".repeat(64),
      active: false,
    });
    return request;
  }
  if (rule.kind === "opaque.immutable-when-inactive") {
    setPath(request as unknown as Record<string, unknown>, rule.proposed, {
      base64: "AQ==",
      sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      active: false,
    });
    return request;
  }
  if (rule.kind === "opaque.reject-edit-when-inactive") {
    setPath(request as unknown as Record<string, unknown>, rule.intent, true);
    return request;
  }
  if (rule.kind === "collection.not-contains") {
    const field = fieldDefinition(ir, rule.collection);
    const itemField = field?.type === "array" ? field.items : field?.type === "map" ? field.values : undefined;
    if (itemField?.type !== "object") throw new Error(`Portable collection "${rule.collection}" must contain objects`);
    const item = baselineFieldValue(itemField) as Record<string, unknown>;
    const targetDefinition = itemField.properties[rule.targetKey];
    const duplicate = targetDefinition.type === "integer" ? 7 : "prospective-duplicate";
    item[rule.targetKey] = duplicate;
    satisfyEarlierCollectionRules(ir, rule.id, rule.collection, item, request);
    setPath(request as unknown as Record<string, unknown>, rule.value, duplicate);
    mutableCollection(
      getPath(request as unknown as Record<string, unknown>, rule.collection),
      rule.collection,
    ).add(item);
    return request;
  }
  if (rule.kind === "collection.prospective-unique") {
    const candidateField = fieldDefinition(ir, rule.candidates);
    const existingField = fieldDefinition(ir, rule.existing);
    const candidateItem = candidateField?.type === "array"
      ? candidateField.items
      : candidateField?.type === "map" ? candidateField.values : undefined;
    const existingItem = existingField?.type === "array"
      ? existingField.items
      : existingField?.type === "map" ? existingField.values : undefined;
    if (candidateItem?.type !== "object" || existingItem?.type !== "object") {
      throw new Error(`Prospective unique collections must contain objects`);
    }
    const duplicate = candidateItem.properties[rule.candidateKey].type === "integer"
      ? 7
      : "prospective-duplicate";
    const candidate = baselineFieldValue(candidateItem) as Record<string, unknown>;
    const existing = baselineFieldValue(existingItem) as Record<string, unknown>;
    candidate[rule.candidateKey] = duplicate;
    existing[rule.existingKey] = duplicate;
    satisfyEarlierCollectionRules(ir, rule.id, rule.existing, existing, request);
    mutableCollection(
      getPath(request as unknown as Record<string, unknown>, rule.candidates),
      rule.candidates,
    ).add(candidate);
    mutableCollection(
      getPath(request as unknown as Record<string, unknown>, rule.existing),
      rule.existing,
    ).add(existing);
    return request;
  }
  if (rule.kind === "evidence.canonical-hash") {
    setPath(request as unknown as Record<string, unknown>, rule.hash, "f".repeat(64));
    return request;
  }
  const collectionValue = getPath(request as unknown as Record<string, unknown>, rule.collection);
  const collection = mutableCollection(collectionValue, rule.collection);
  const field = fieldDefinition(ir, rule.collection);
  const itemField = field?.type === "array" ? field.items : field?.type === "map" ? field.values : undefined;
  if (rule.kind === "collection.unique" && itemField &&
      (itemField.type === "string" || itemField.type === "integer")) {
    const duplicate = itemField.type === "integer" ? 7 : "duplicate";
    collection.add(duplicate);
    collection.add(duplicate);
    return request;
  }
  if (itemField?.type !== "object") {
    throw new Error(`Portable collection "${rule.collection}" must contain objects`);
  }
  const item = baselineFieldValue(itemField) as Record<string, unknown>;
  if (rule.kind === "collection.unique") {
    item[rule.key!] = "duplicate";
    collection.add(structuredClone(item));
    collection.add(structuredClone(item));
    return request;
  }
  if (rule.kind === "collection.reference") {
    item[rule.reference] = "missing-reference";
    collection.add(item);
    return request;
  }
  if (rule.kind === "collection.membership") {
    item[rule.parentReference] = "missing-parent";
    satisfyEarlierReferences(ir, rule.id, rule.collection, item, request);
    collection.add(item);
    return request;
  }
  item[rule.from] = "missing-from";
  item[rule.to] = "missing-to";
  collection.add(item);
  return request;
}

function mutableCollection(value: unknown, path: string): { add(value: unknown): void } {
  if (Array.isArray(value)) return { add: (item) => value.push(item) };
  if (value && typeof value === "object") {
    let index = Object.keys(value as Record<string, unknown>).length;
    return {
      add: (item) => {
        (value as Record<string, unknown>)[`generated-${index++}`] = item;
      },
    };
  }
  throw new Error(`Portable collection "${path}" is not an array or map`);
}

function satisfyEarlierReferences(
  ir: CrddIr,
  beforeId: string,
  collectionPath: string,
  item: Record<string, unknown>,
  request: SimulationRequest,
): void {
  for (const rule of ir.operation.portableRules ?? []) {
    if (rule.id === beforeId) return;
    if (rule.kind !== "collection.reference" || rule.collection !== collectionPath) continue;
    const target = getPath(request as unknown as Record<string, unknown>, rule.target);
    const targetField = fieldDefinition(ir, rule.target);
    const targetItem = targetField?.type === "array"
      ? targetField.items
      : targetField?.type === "map"
        ? targetField.values
        : undefined;
    if (!targetItem || targetItem.type !== "object") continue;
    const candidate = baselineFieldValue(targetItem) as Record<string, unknown>;
    const value = `valid-${slug(rule.id)}`;
    item[rule.reference] = value;
    candidate[rule.targetKey] = value;
    if (rule.targetType) candidate[rule.targetType.field] = rule.targetType.equals;
    mutableCollection(target, rule.target).add(candidate);
  }
}

function satisfyEarlierCollectionRules(
  ir: CrddIr,
  beforeId: string,
  collectionPath: string,
  item: Record<string, unknown>,
  request: SimulationRequest,
): void {
  satisfyEarlierReferences(ir, beforeId, collectionPath, item, request);
  for (const rule of ir.operation.portableRules ?? []) {
    if (rule.id === beforeId) return;
    if (rule.kind !== "collection.membership" || rule.collection !== collectionPath) continue;
    const parents = getPath(request as unknown as Record<string, unknown>, rule.parents);
    const parentField = fieldDefinition(ir, rule.parents);
    const parentItem = parentField?.type === "array"
      ? parentField.items
      : parentField?.type === "map" ? parentField.values : undefined;
    if (parentItem?.type !== "object") continue;
    const parent = baselineFieldValue(parentItem) as Record<string, unknown>;
    const value = `valid-${slug(rule.id)}`;
    item[rule.parentReference] = value;
    parent[rule.parentKey] = value;
    mutableCollection(parents, rule.parents).add(parent);
  }
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
