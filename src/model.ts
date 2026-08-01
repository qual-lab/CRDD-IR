export type ScalarFieldDefinition = {
  type: "number" | "integer" | "string" | "boolean";
  unit?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  optional?: boolean;
  nullable?: boolean;
  default?: number | string | boolean;
};

export type ObjectFieldDefinition = {
  type: "object";
  properties: Record<string, FieldDefinition>;
  optional?: boolean;
  nullable?: boolean;
  unit?: never;
  minimum?: never;
};

export type ArrayFieldDefinition = {
  type: "array";
  items: FieldDefinition;
  minItems?: number;
  maxItems?: number;
  optional?: boolean;
  nullable?: boolean;
  unit?: never;
  minimum?: never;
};

export type MapFieldDefinition = {
  type: "map";
  values: FieldDefinition;
  optional?: boolean;
  nullable?: boolean;
  unit?: never;
  minimum?: never;
};

export type UnionFieldDefinition = {
  type: "union";
  discriminator: string;
  variants: ObjectFieldDefinition[];
  optional?: boolean;
  nullable?: boolean;
  unit?: never;
  minimum?: never;
};

export type OpaqueFieldDefinition = {
  type: "opaque";
  encoding: "base64";
  digest: "sha256";
  optional?: boolean;
  nullable?: boolean;
  unit?: never;
  minimum?: never;
};

export type FieldDefinition =
  | ScalarFieldDefinition
  | ObjectFieldDefinition
  | ArrayFieldDefinition
  | MapFieldDefinition
  | UnionFieldDefinition
  | OpaqueFieldDefinition;

export type IrExtension = {
  protocol: string;
  data: unknown;
};

export type Requirement = {
  id: string;
  expression: string;
  error: string;
  when?: string;
};

export type PortableRule =
  | {
      kind: "collection.unique";
      id: string;
      error: string;
      collection: string;
      key?: string;
    }
  | {
      kind: "collection.reference";
      id: string;
      error: string;
      collection: string;
      reference: string;
      target: string;
      targetKey: string;
      targetType?: { field: string; equals: string };
    }
  | {
      kind: "collection.membership";
      id: string;
      error: string;
      collection: string;
      parentReference: string;
      parents: string;
      parentKey: string;
    }
  | {
      kind: "collection.relation";
      id: string;
      error: string;
      collection: string;
      from: string;
      to: string;
      elements: string;
      elementKey: string;
      fromType?: { field: string; equals: string };
      toType?: { field: string; equals: string };
    }
  | {
      kind: "collection.not-contains";
      id: string;
      error: string;
      value: string;
      collection: string;
      targetKey: string;
    }
  | {
      kind: "collection.prospective-unique";
      id: string;
      error: string;
      candidates: string;
      candidateKey: string;
      existing: string;
      existingKey: string;
    }
  | {
      kind: "opaque.integrity";
      id: string;
      error: string;
      target: string;
    }
  | {
      kind: "opaque.immutable-when-inactive";
      id: string;
      error: string;
      current: string;
      proposed: string;
    }
  | {
      kind: "opaque.reject-edit-when-inactive";
      id: string;
      error: string;
      current: string;
      intent: string;
    }
  | {
      kind: "evidence.canonical-hash";
      id: string;
      error: string;
      source: "input" | "state";
      hash: string;
    };

type EffectBranch = {
  when?: string;
  traces?: string[];
};

export type Effect = (
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
    }
) & EffectBranch;

export type CrddError = {
  code: string;
  traces: string[];
};

export type Operation = {
  id: string;
  kind: "command" | "query";
  traces: string[];
  input: Record<string, FieldDefinition>;
  state: Record<string, FieldDefinition>;
  output?: FieldDefinition;
  requires: Requirement[];
  portableRules?: PortableRule[];
  effects: Effect[];
  errors: CrddError[];
  conformance?: {
    baseline?: Partial<SimulationRequest>;
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
    rollbackOnFailure: boolean;
  };
  execution?: {
    mode: "sync" | "async";
    cancelable?: boolean;
    timeoutMs?: number;
    idempotency?: "none" | "optional" | "required";
  };
  emits?: Array<{
    type: string;
    payload?: FieldDefinition;
    delivery?: "at-most-once" | "at-least-once";
    traces: string[];
  }>;
  extensions?: Record<string, IrExtension>;
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
