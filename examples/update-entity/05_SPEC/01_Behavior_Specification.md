# UpdateEntity Behavior Specification

既存のEntityをIDで特定し、属性を原子的に更新する。

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: UpdateEntity
  traces:
    - REQ-ENTITY-UPDATE-001

  input:
    entity_id:
      type: string
    new_length:
      type: number
      unit: m
      minimum: 0
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
    entities:
      type: array
      items:
        type: object
        properties:
          entity_id:
            type: string
          length:
            type: number
            unit: m

  requires:
    - id: valid-entity-id
      condition: input.entity_id != ""
      error: ENTITY_ID_REQUIRED
    - id: minimum-entity-length
      condition: input.new_length >= 0.3m
      error: ENTITY_TOO_SHORT

  effects:
    - target: state.audit.mode
      action: assign
      expression: input.options.mode
    - target: state.entities
      action: update
      where:
        entity_id: $input.entity_id
      set:
        length: $input.new_length

  errors:
    - code: ENTITY_ID_REQUIRED
      traces:
        - REQ-ENTITY-UPDATE-001
    - code: ENTITY_TOO_SHORT
      traces:
        - REQ-ENTITY-UPDATE-001

  transaction:
    atomic: true
    rollback_on_failure: true
```
