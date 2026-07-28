# PlaceWall Behavior Specification

Version: v0.1.0
Status: Draft
Owner: Qual-Lab
Last Updated: 2026-07-28

## Purpose

壁の長さと予算を検証し、壁の配置と費用消費を一つのTransactionとして確定する。
失敗時は、壁と予算のどちらも変更しない。

## Structured Contract

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: PlaceWall
  traces:
    - REQ-WALL-001
    - DEC-WALL-003

  input:
    length:
      type: number
      unit: m
      minimum: 0
    cost:
      type: number
      unit: JPY
      minimum: 0

  state:
    budget.remaining:
      type: number
      unit: JPY
      minimum: 0
    walls:
      type: array
      items:
        type: object
        properties:
          length:
            type: number
            unit: m
          cost:
            type: number
            unit: JPY

  requires:
    - id: minimum-wall-length
      condition: input.length >= 0.3m
      error: WALL_TOO_SHORT
    - id: sufficient-budget
      condition: state.budget.remaining >= input.cost
      error: INSUFFICIENT_BUDGET

  effects:
    - target: state.walls
      action: append
      value:
        length: $input.length
        cost: $input.cost
    - target: state.budget.remaining
      action: assign
      expression: state.budget.remaining - input.cost

  errors:
    - code: WALL_TOO_SHORT
      traces:
        - REQ-WALL-001
    - code: INSUFFICIENT_BUDGET
      traces:
        - DEC-WALL-003

  transaction:
    atomic: true
    rollback_on_failure: true

  assets:
    - id: WallPreview
      type: box
      dimensions:
        length: { value: 1.0, unit: m }
        width: { value: 0.2, unit: m }
        height: { value: 2.4, unit: m }
      material:
        base_color: [0.65, 0.68, 0.72]
      placement:
        location:
          x: { value: 0, unit: m }
          y: { value: 0, unit: m }
          z: { value: 0, unit: m }
        rotation:
          pitch: { value: 0, unit: deg }
          yaw: { value: 0, unit: deg }
          roll: { value: 0, unit: deg }
      traces:
        - REQ-WALL-001
    - id: DoorPreview
      type: box
      dimensions:
        length: { value: 0.9, unit: m }
        width: { value: 0.1, unit: m }
        height: { value: 2.0, unit: m }
      material:
        base_color: [0.4, 0.2, 0.1]
      placement:
        location:
          x: { value: 1.5, unit: m }
          y: { value: 0.25, unit: m }
          z: { value: 0, unit: m }
        rotation:
          pitch: { value: 0, unit: deg }
          yaw: { value: 90, unit: deg }
          roll: { value: 0, unit: deg }
      traces:
        - REQ-WALL-001
```
