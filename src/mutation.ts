import type { CrddIr, SimulationResult, TestManifest } from "./model.ts";
import { simulate } from "./simulator.ts";

export type MutationReport = {
  protocol: "crdd-ir/mutation-v0.1";
  total: number;
  killed: number;
  survived: string[];
  score: number;
};

type Mutant = { id: string; ir: CrddIr };

export function analyzeMutationCoverage(
  ir: CrddIr,
  manifest: TestManifest,
): MutationReport {
  const expected = new Map(manifest.cases.map((testCase) => [
    testCase.id,
    outcome(() => simulate(ir, structuredClone(testCase.arrange))),
  ]));
  const mutants = createMutants(ir);
  const survived = mutants
    .filter((mutant) => !manifest.cases.some((testCase) => {
      const actual = outcome(() => simulate(mutant.ir, structuredClone(testCase.arrange)));
      return JSON.stringify(actual) !== JSON.stringify(expected.get(testCase.id));
    }))
    .map((mutant) => mutant.id);
  return {
    protocol: "crdd-ir/mutation-v0.1",
    total: mutants.length,
    killed: mutants.length - survived.length,
    survived,
    score: mutants.length === 0 ? 100 : (mutants.length - survived.length) / mutants.length * 100,
  };
}

function createMutants(ir: CrddIr): Mutant[] {
  const mutants: Mutant[] = [];
  ir.operation.requires.forEach((requirement, index) => {
    const removed = structuredClone(ir);
    removed.operation.requires.splice(index, 1);
    mutants.push({ id: `remove-requirement:${requirement.id}`, ir: removed });

    const replacement = flipBoundary(requirement.expression);
    if (replacement) {
      const changed = structuredClone(ir);
      changed.operation.requires[index].expression = replacement;
      mutants.push({ id: `flip-boundary:${requirement.id}`, ir: changed });
    }
    if (requirement.when) {
      const changed = structuredClone(ir);
      changed.operation.requires[index].when = flipEquality(requirement.when);
      mutants.push({ id: `flip-requirement-branch:${requirement.id}`, ir: changed });
    }
  });
  ir.operation.effects.forEach((effect, index) => {
    const removed = structuredClone(ir);
    removed.operation.effects.splice(index, 1);
    mutants.push({ id: `remove-effect:${effect.target}:${index}`, ir: removed });
    if (effect.when) {
      const changed = structuredClone(ir);
      changed.operation.effects[index].when = flipEquality(effect.when);
      mutants.push({ id: `flip-effect-branch:${effect.target}:${index}`, ir: changed });
    }
  });
  (ir.operation.portableRules ?? []).forEach((rule, index) => {
    const removed = structuredClone(ir);
    removed.operation.portableRules!.splice(index, 1);
    mutants.push({ id: `remove-portable-rule:${rule.id}`, ir: removed });
  });
  return mutants;
}

function flipEquality(expression: string): string {
  if (expression.includes("==")) return expression.replace("==", "!=");
  if (expression.includes("!=")) return expression.replace("!=", "==");
  throw new Error(`Conditional branch mutation requires == or !=: ${expression}`);
}

function flipBoundary(expression: string): string | undefined {
  for (const [from, to] of [[">=", ">"], ["<=", "<"], [">", ">="], ["<", "<="]] as const) {
    if (expression.includes(from)) return expression.replace(from, to);
  }
  return undefined;
}

function outcome(run: () => SimulationResult): unknown {
  try {
    return run();
  } catch (error) {
    return { threw: (error as Error).message };
  }
}
