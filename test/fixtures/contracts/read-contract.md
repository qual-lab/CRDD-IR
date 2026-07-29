# Query Operation

Returns a record without mutating application state.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: QueryRecord
  kind: query
  traces: [REQ-RESOURCE-001]
  input:
    id:
      type: string
      minLength: 1
  state:
    records:
      type: map
      values:
        type: object
        properties:
          id: { type: string }
          labels:
            type: array
            items: { type: string }
  output:
    type: object
    nullable: true
    properties:
      id: { type: string }
      metadata:
        type: map
        values: { type: string, nullable: true }
  requires: []
  effects: []
  errors: []
  execution:
    mode: sync
  emits: []
```
