# Revise Record

This fixture updates a selected record atomically.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: ReviseRecord
  kind: command
  traces: [REQ-RECORD-UPDATE-001]
  input:
    record_id: { type: string }
    new_length: { type: number, unit: unit, minimum: 0 }
    options:
      type: object
      properties:
        mode:
          type: string
          enum: [replace, preserve_metadata]
          optional: true
          default: replace
  state:
    audit:
      type: object
      properties:
        mode:
          type: string
          enum: [preserve_metadata, replace]
    records:
      type: array
      items:
        type: object
        properties:
          record_id: { type: string }
          length: { type: number, unit: unit }
  requires:
    - id: valid-record-id
      condition: input.record_id != ""
      error: RECORD_ID_REQUIRED
    - id: minimum-record-length
      condition: input.new_length >= 0.3unit
      error: RECORD_TOO_SMALL
  effects:
    - target: state.audit.mode
      action: assign
      expression: input.options.mode
    - target: state.records
      action: update
      where: { record_id: $input.record_id }
      set: { length: $input.new_length }
  errors:
    - code: RECORD_ID_REQUIRED
      traces: [REQ-RECORD-UPDATE-001]
    - code: RECORD_TOO_SMALL
      traces: [REQ-RECORD-UPDATE-001]
  transaction:
    atomic: true
    rollback_on_failure: true
```
