# Numeric boundary conformance fixture

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: AppendRecord
  kind: command
  traces: [REQ-NUMERIC-BOUNDARY]
  input:
    record_id: { type: string }
    span: { type: number, unit: mm, minimum: 0 }
    extent: { type: number, unit: mm, minimum: 0 }
    depth: { type: number, unit: mm, minimum: 0 }
    segment_span: { type: number, unit: mm, minimum: 0 }
    segment_extent: { type: number, unit: mm, minimum: 0 }
    offset: { type: number, unit: mm, minimum: 0 }
    baseline: { type: number, unit: mm, minimum: 0 }
  state:
    records:
      type: array
      items:
        type: object
        properties:
          record_id: { type: string }
          span: { type: number, unit: mm }
          extent: { type: number, unit: mm }
          depth: { type: number, unit: mm }
          segment_span: { type: number, unit: mm }
          segment_extent: { type: number, unit: mm }
          offset: { type: number, unit: mm }
          baseline: { type: number, unit: mm }
  requires:
    - { id: record-id-required, condition: 'input.record_id != ""', error: RECORD_ID_REQUIRED }
    - { id: minimum-span, condition: input.span >= 300mm, error: SPAN_TOO_SMALL }
    - { id: minimum-extent, condition: input.extent >= 300mm, error: EXTENT_TOO_SMALL }
    - { id: minimum-depth, condition: input.depth >= 10mm, error: DEPTH_TOO_SMALL }
    - { id: segment-fits-span, condition: input.offset + input.segment_span <= input.span, error: SEGMENT_EXCEEDS_SPAN }
    - { id: segment-fits-extent, condition: input.baseline + input.segment_extent <= input.extent, error: SEGMENT_EXCEEDS_EXTENT }
  effects:
    - target: state.records
      action: append
      value:
        record_id: $input.record_id
        span: $input.span
        extent: $input.extent
        depth: $input.depth
        segment_span: $input.segment_span
        segment_extent: $input.segment_extent
        offset: $input.offset
        baseline: $input.baseline
  errors:
    - { code: RECORD_ID_REQUIRED, traces: [REQ-NUMERIC-BOUNDARY] }
    - { code: SPAN_TOO_SMALL, traces: [REQ-NUMERIC-BOUNDARY] }
    - { code: EXTENT_TOO_SMALL, traces: [REQ-NUMERIC-BOUNDARY] }
    - { code: DEPTH_TOO_SMALL, traces: [REQ-NUMERIC-BOUNDARY] }
    - { code: SEGMENT_EXCEEDS_SPAN, traces: [REQ-NUMERIC-BOUNDARY] }
    - { code: SEGMENT_EXCEEDS_EXTENT, traces: [REQ-NUMERIC-BOUNDARY] }
  transaction: { atomic: true, rollback_on_failure: true }
```
