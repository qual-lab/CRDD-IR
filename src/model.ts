export type FieldDefinition = {
  type: "number" | "string" | "boolean" | "array";
  unit?: string;
  minimum?: number;
};

export type Requirement = {
  id: string;
  expression: string;
  error: string;
};

export type Effect =
  | {
      target: string;
      action: "assign";
      expression: string;
    }
  | {
      target: string;
      action: "append";
      value: unknown;
    };

export type CrddError = {
  code: string;
  traces: string[];
};

export type Operation = {
  id: string;
  traces: string[];
  input: Record<string, FieldDefinition>;
  state: Record<string, FieldDefinition>;
  requires: Requirement[];
  effects: Effect[];
  errors: CrddError[];
  transaction: {
    atomic: boolean;
    rollbackOnFailure: boolean;
  };
};

export type CrddIr = {
  irVersion: "0.1";
  operation: Operation;
};

export type Diagnostic = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

export type SimulationRequest = {
  input: Record<string, unknown>;
  state: Record<string, unknown>;
};

export type SimulationResult =
  | {
      ok: true;
      operation: string;
      state: Record<string, unknown>;
      traces: string[];
    }
  | {
      ok: false;
      operation: string;
      error: string;
      failedRequirement: string;
      state: Record<string, unknown>;
      traces: string[];
    };

export type TestCase = {
  id: string;
  sourceRequirement?: string;
  description: string;
  arrange: SimulationRequest;
  expect: {
    ok: boolean;
    error?: string;
    stateUnchanged?: boolean;
  };
};

export type TestManifest = {
  version: "0.1";
  operation: string;
  traces: string[];
  cases: TestCase[];
};

export type TestCaseResult = {
  id: string;
  passed: boolean;
  message: string;
  traces: string[];
};

export type TestRunReport = {
  operation: string;
  passed: number;
  failed: number;
  total: number;
  results: TestCaseResult[];
};

export type OperationAdapter = {
  name: string;
  execute(request: SimulationRequest): SimulationResult | Promise<SimulationResult>;
};

export type ConformanceCase = {
  id: string;
  description: string;
  sourceRequirement?: string;
  request: SimulationRequest;
  expected: SimulationResult;
};

export type ConformanceBundle = {
  protocol: "crdd-ir/conformance-v0.1";
  operation: string;
  traces: string[];
  cases: ConformanceCase[];
};
