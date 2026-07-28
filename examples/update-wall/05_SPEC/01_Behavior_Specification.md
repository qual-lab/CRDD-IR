# UpdateWall Behavior Specification

既存の壁をIDで特定し、長さを原子的に更新する。

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: UpdateWall
  traces:
    - REQ-WALL-UPDATE-001

  input:
    wall_id:
      type: string
    new_length:
      type: number
      unit: m
      minimum: 0
    update_mode:
      type: string
      enum: [replace, preserve_metadata]
      optional: true
      default: replace

  state:
    walls:
      type: array
      items:
        type: object
        properties:
          wall_id:
            type: string
          length:
            type: number
            unit: m

  requires:
    - id: valid-wall-id
      condition: input.wall_id != ""
      error: WALL_ID_REQUIRED
    - id: minimum-wall-length
      condition: input.new_length >= 0.3m
      error: WALL_TOO_SHORT

  effects:
    - target: state.walls
      action: update
      where:
        wall_id: $input.wall_id
      set:
        length: $input.new_length

  errors:
    - code: WALL_ID_REQUIRED
      traces:
        - REQ-WALL-UPDATE-001
    - code: WALL_TOO_SHORT
      traces:
        - REQ-WALL-UPDATE-001

  transaction:
    atomic: true
    rollback_on_failure: true
```
