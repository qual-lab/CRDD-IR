# Apply Record

This fixture validates a record and consumes capacity in one atomic
transaction. Failure leaves both state fields unchanged.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: ApplyRecord
  kind: command
  traces: [REQ-RECORD-001, DEC-CAPACITY-001]
  input:
    length: { type: number, unit: unit, minimum: 0 }
    amount: { type: number, unit: credit, minimum: 0 }
  state:
    capacity.remaining: { type: number, unit: credit, minimum: 0 }
    records:
      type: array
      items:
        type: object
        properties:
          length: { type: number, unit: unit }
          amount: { type: number, unit: credit }
  requires:
    - id: minimum-record-length
      condition: input.length >= 0.3unit
      error: RECORD_TOO_SMALL
    - id: sufficient-capacity
      condition: state.capacity.remaining >= input.amount
      error: INSUFFICIENT_CAPACITY
  effects:
    - target: state.records
      action: append
      value: { length: $input.length, amount: $input.amount }
    - target: state.capacity.remaining
      action: assign
      expression: state.capacity.remaining - input.amount
  errors:
    - code: RECORD_TOO_SMALL
      traces: [REQ-RECORD-001]
    - code: INSUFFICIENT_CAPACITY
      traces: [DEC-CAPACITY-001]
  transaction:
    atomic: true
    rollback_on_failure: true
  extensions:
    crdd.3d-assets:
      protocol: crdd-ir/3d-assets-v0.1
      data:
        assets:
          - id: PrimaryPreview
            type: box
            dimensions:
              length: { value: 1.0, unit: m }
              width: { value: 0.2, unit: m }
              height: { value: 2.4, unit: m }
            material: { baseColor: [0.65, 0.68, 0.72] }
            collision: { shape: box }
            lod: { group: LevelArchitecture }
            placement:
              location:
                x: { value: 0, unit: m }
                y: { value: 0, unit: m }
                z: { value: 0, unit: m }
              rotation:
                pitch: { value: 0, unit: deg }
                yaw: { value: 0, unit: deg }
                roll: { value: 0, unit: deg }
            traces: [REQ-RECORD-001]
          - id: SecondaryPreview
            type: box
            dimensions:
              length: { value: 0.9, unit: m }
              width: { value: 0.1, unit: m }
              height: { value: 2.0, unit: m }
            material: { baseColor: [0.4, 0.2, 0.1] }
            collision: { shape: box }
            lod: { group: LargeProp }
            placement:
              location:
                x: { value: 1.5, unit: m }
                y: { value: 0.25, unit: m }
                z: { value: 0, unit: m }
              rotation:
                pitch: { value: 0, unit: deg }
                yaw: { value: 90, unit: deg }
                roll: { value: 0, unit: deg }
            traces: [REQ-RECORD-001]
```
