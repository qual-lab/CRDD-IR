# Evaluate Threshold Set

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: EvaluateThresholdSet
  kind: command
  traces: [IR-COLLECTION-PREDICATE-001, IR-OUTPUT-EVENT-001]
  input:
    axes:
      type: array
      items:
        type: object
        properties:
          value: { type: integer }
          minimumValue: { type: integer }
    commonMinimum: { type: integer }
    accepted: { type: boolean }
  state:
    crossed: { type: boolean }
  output:
    type: object
    properties:
      crossed: { type: boolean }
      anyMeetsCommonMinimum: { type: boolean }
  returns:
    crossed: state.crossed
    anyMeetsCommonMinimum: any(input.axes, item.value >= input.commonMinimum)
  requires:
    - id: input-accepted
      condition: input.accepted == true
      error: INPUT_REJECTED
  effects:
    - target: state.crossed
      action: assign
      expression: all(input.axes, item.value >= item.minimumValue)
  errors:
    - code: INPUT_REJECTED
      traces: [IR-OUTPUT-EVENT-001]
  conformance:
    baseline:
      input:
        axes:
          - { value: 5, minimumValue: 5 }
        commonMinimum: 5
        accepted: true
      state:
        crossed: false
  emits:
    - type: ThresholdSetCrossed
      when: previous.crossed == false && state.crossed == true
      payload:
        type: object
        properties:
          crossed: { type: boolean }
      value:
        crossed: state.crossed
      delivery: at-most-once
      traces: [IR-OUTPUT-EVENT-001]
  transaction:
    atomic: true
    rollback_on_failure: true
```
