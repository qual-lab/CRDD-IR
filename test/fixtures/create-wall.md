# CreateWall generic conformance fixture

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: CreateWall
  traces: [REQ-WALL]
  input:
    wall_id: { type: string }
    length: { type: number, unit: mm, minimum: 0 }
    height: { type: number, unit: mm, minimum: 0 }
    thickness: { type: number, unit: mm, minimum: 0 }
    opening_width: { type: number, unit: mm, minimum: 0 }
    opening_height: { type: number, unit: mm, minimum: 0 }
    opening_offset: { type: number, unit: mm, minimum: 0 }
    opening_sill: { type: number, unit: mm, minimum: 0 }
  state:
    walls:
      type: array
      items:
        type: object
        properties:
          wall_id: { type: string }
          length: { type: number, unit: mm }
          height: { type: number, unit: mm }
          thickness: { type: number, unit: mm }
          opening_width: { type: number, unit: mm }
          opening_height: { type: number, unit: mm }
          opening_offset: { type: number, unit: mm }
          opening_sill: { type: number, unit: mm }
  requires:
    - { id: wall-id-required, condition: 'input.wall_id != ""', error: WALL_ID_REQUIRED }
    - { id: minimum-wall-length, condition: input.length >= 300mm, error: WALL_TOO_SHORT }
    - { id: minimum-wall-height, condition: input.height >= 300mm, error: WALL_TOO_LOW }
    - { id: minimum-wall-thickness, condition: input.thickness >= 10mm, error: WALL_TOO_THIN }
    - { id: opening-fits-width, condition: input.opening_offset + input.opening_width <= input.length, error: OPENING_TOO_WIDE }
    - { id: opening-fits-height, condition: input.opening_sill + input.opening_height <= input.height, error: OPENING_TOO_HIGH }
  effects:
    - target: state.walls
      action: append
      value:
        wall_id: $input.wall_id
        length: $input.length
        height: $input.height
        thickness: $input.thickness
        opening_width: $input.opening_width
        opening_height: $input.opening_height
        opening_offset: $input.opening_offset
        opening_sill: $input.opening_sill
  errors:
    - { code: WALL_ID_REQUIRED, traces: [REQ-WALL] }
    - { code: WALL_TOO_SHORT, traces: [REQ-WALL] }
    - { code: WALL_TOO_LOW, traces: [REQ-WALL] }
    - { code: WALL_TOO_THIN, traces: [REQ-WALL] }
    - { code: OPENING_TOO_WIDE, traces: [REQ-WALL] }
    - { code: OPENING_TOO_HIGH, traces: [REQ-WALL] }
  transaction: { atomic: true, rollback_on_failure: true }
```
