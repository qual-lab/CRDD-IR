# Multi-field conformance fixture

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: ClassifyRecord
  kind: command
  traces: [IR-CONFORMANCE-SEED-001]
  input:
    count_band:
      type: string
      enum: [none, one, two]
    signal_a: { type: boolean }
    signal_b: { type: boolean }
    signal_c: { type: boolean }
  state:
    accepted: { type: boolean }
    marked: { type: boolean }
  requires:
    - id: count-none
      when: input.count_band == "none"
      condition: input.signal_a == false && input.signal_b == false && input.signal_c == false
      error: COUNT_MISMATCH
    - id: count-one
      when: input.count_band == "one"
      condition: (input.signal_a == true && input.signal_b == false && input.signal_c == false) || (input.signal_a == false && input.signal_b == true && input.signal_c == false) || (input.signal_a == false && input.signal_b == false && input.signal_c == true)
      error: COUNT_MISMATCH
    - id: count-two
      when: input.count_band == "two"
      condition: (input.signal_a == true && input.signal_b == true && input.signal_c == false) || (input.signal_a == true && input.signal_b == false && input.signal_c == true) || (input.signal_a == false && input.signal_b == true && input.signal_c == true)
      error: COUNT_MISMATCH
  effects:
    - when: input.count_band == "none"
      target: state.accepted
      action: assign
      expression: 'true'
    - when: input.count_band == "one"
      target: state.accepted
      action: assign
      expression: 'true'
    - when: input.count_band == "two"
      target: state.accepted
      action: assign
      expression: 'true'
    - when: input.count_band == "one" && input.signal_a == true
      target: state.marked
      action: assign
      expression: 'true'
  errors:
    - code: COUNT_MISMATCH
      traces: [IR-CONFORMANCE-SEED-001]
  conformance:
    baseline:
      input:
        count_band: none
        signal_a: false
        signal_b: false
        signal_c: false
      state:
        accepted: false
        marked: false
    seeds:
      - id: one-signal-a
        when: input.count_band == "one"
        input:
          count_band: one
          signal_a: true
          signal_b: false
          signal_c: false
      - id: two-signals-a-b
        when: input.count_band == "two"
        input:
          count_band: two
          signal_a: true
          signal_b: true
          signal_c: false
      - id: one-signal-a-marked
        when: input.count_band == "one" && input.signal_a == true
        input:
          count_band: one
          signal_a: true
          signal_b: false
          signal_c: false
  transaction:
    atomic: true
    rollback_on_failure: true
```
