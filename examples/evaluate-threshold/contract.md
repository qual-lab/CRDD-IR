# Evaluate Threshold

This fixture exercises a scalar threshold and an opaque extension envelope.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: EvaluateThreshold
  kind: command
  traces: [REQ-THRESHOLD-001]
  input:
    amount: { type: number, unit: token, minimum: 0 }
  state:
    availableCapacity: { type: number, unit: token, minimum: 0 }
  requires:
    - id: positive-amount
      condition: input.amount > 0token
      error: INVALID_AMOUNT
    - id: sufficient-capacity
      condition: state.availableCapacity >= input.amount
      error: THRESHOLD_EXCEEDED
  effects:
    - target: state.availableCapacity
      action: assign
      expression: state.availableCapacity - input.amount
  errors:
    - code: INVALID_AMOUNT
      traces: [REQ-THRESHOLD-001]
    - code: THRESHOLD_EXCEEDED
      traces: [REQ-THRESHOLD-001]
  transaction:
    atomic: true
    rollback_on_failure: true
  extensions:
    com.example.audit:
      protocol: example/audit-v1
      data:
        category: threshold-evaluation
        retention_days: 30
```
