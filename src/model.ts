export type ScalarFieldDefinition = {
  type: "number" | "string" | "boolean";
  unit?: string;
  minimum?: number;
  enum?: string[];
  optional?: boolean;
  default?: number | string | boolean;
};

export type ObjectFieldDefinition = {
  type: "object";
  properties: Record<string, ScalarFieldDefinition>;
  unit?: never;
  minimum?: never;
};

export type ArrayFieldDefinition = {
  type: "array";
  items: ObjectFieldDefinition;
  unit?: never;
  minimum?: never;
};

export type FieldDefinition = ScalarFieldDefinition | ObjectFieldDefinition | ArrayFieldDefinition;

export type AssetDefinition = {
  id: string;
  type: "box" | "cylinder";
  dimensions: {
    length: { value: number; unit: "m" };
    width: { value: number; unit: "m" };
    height: { value: number; unit: "m" };
  };
  material: {
    baseColor: [number, number, number];
  };
  collision: {
    shape: "box" | "capsule" | "sphere" | "ndop26";
  };
  lod: {
    group: "None" | "SmallProp" | "LargeProp" | "LevelArchitecture";
  };
  placement: {
    location: {
      x: { value: number; unit: "m" };
      y: { value: number; unit: "m" };
      z: { value: number; unit: "m" };
    };
    rotation: {
      pitch: { value: number; unit: "deg" };
      yaw: { value: number; unit: "deg" };
      roll: { value: number; unit: "deg" };
    };
  };
  traces: string[];
};

export type IrExtension = {
  protocol: string;
  data: unknown;
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
    }
  | {
      target: string;
      action: "increment";
      expression: string;
    }
  | {
      target: string;
      action: "remove";
      where: Record<string, unknown>;
    }
  | {
      target: string;
      action: "update";
      where: Record<string, unknown>;
      set: Record<string, unknown>;
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
  extensions?: Record<string, IrExtension>;
  /** @deprecated Read-only compatibility for IR produced before the extension boundary. */
  assets?: AssetDefinition[];
};

export type CrddIr = {
  irVersion: "0.1";
  operation: Operation;
};

export type Diagnostic = {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  location?: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  };
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
