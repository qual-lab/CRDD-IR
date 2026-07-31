# Conditional transition contract

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: ResolveDecision
  kind: command
  traces: [IR-CONDITIONAL-EFFECT-001]
  input:
    decision: { type: string, enum: [continue, withdraw] }
    danger_gain: { type: number, minimum: 0, maximum: 10 }
  state:
    danger: { type: number, minimum: 0, maximum: 100 }
    status: { type: string, enum: [active, withdrawn] }
  requires:
    - id: danger-within-range
      condition: state.danger + input.danger_gain <= 100
      error: DANGER_LIMIT_EXCEEDED
    - id: withdraw-only-while-active
      when: input.decision == "withdraw"
      condition: state.status == "active"
      error: STATUS_NOT_ACTIVE
  effects:
    - when: input.decision == "continue"
      traces: [BRANCH-CONTINUE]
      target: state.danger
      action: assign
      expression: state.danger + input.danger_gain
    - when: input.decision == "withdraw"
      traces: [BRANCH-WITHDRAW]
      target: state.status
      action: assign
      expression: '"withdrawn"'
  errors:
    - code: DANGER_LIMIT_EXCEEDED
      traces: [IR-CONDITIONAL-EFFECT-001]
    - code: STATUS_NOT_ACTIVE
      traces: [BRANCH-WITHDRAW]
  transaction:
    atomic: true
    rollback_on_failure: true
```
