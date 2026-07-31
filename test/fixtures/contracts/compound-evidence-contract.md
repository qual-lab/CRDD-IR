# Compound evidence contract fixture

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: preserve-evidence
  kind: command
  traces: [IR-EVIDENCE-ROUNDTRIP-001, IR-STRUCTURAL-TYPE-001, IR-NESTED-COLLECTION-001]
  input:
    evidence_version: { type: string, enum: [v1] }
    quantity_kind: { type: string }
    scope_id: { type: string, enum: ["scope-\b\f\u0001-雪-😀"] }
    subject_ref:
      type: union
      discriminator: variant
      variants:
        - type: object
          properties:
            variant: { type: string, enum: [space] }
            space_id: { type: string }
        - type: object
          properties:
            variant: { type: string, enum: [boundary-face] }
            boundary_face_id: { type: string }
        - type: object
          properties:
            variant: { type: string, enum: [building] }
            building_id: { type: string }
    aggregation_scope_id: { type: string }
    numeric_policy_id: { type: string }
    quantity_state: { type: string }
    slot_disposition: { type: string }
    value_interval:
      type: object
      properties:
        minimum: { type: string, enum: ["1"] }
        maximum: { type: string, enum: ["2"] }
    absolute_error_upper_bound: { type: string, enum: ["0.01"] }
    segments:
      type: array
      items:
        type: object
        properties:
          id: { type: string, minLength: 1 }
          labels:
            type: array
            items: { type: string }
    numeric_lexemes:
      type: object
      properties:
        negative_zero: { type: string, enum: ["-0"] }
        exponent: { type: string, enum: ["1e+21"] }
        min_subnormal: { type: string, enum: ["5e-324"] }
        max_finite: { type: string, enum: ["1.7976931348623157e+308"] }
    fragment_ids:
      type: array
      items: { type: string, minLength: 1 }
      maxItems: 1024
    canonical_evidence_hash: { type: string, pattern: "^[0-9a-f]{64}$" }
  state:
    persisted_segments:
      type: array
      items:
        type: object
        properties:
          id: { type: string, minLength: 1 }
          labels:
            type: array
            items: { type: string }
    evidence_version: { type: string, enum: [v1] }
    quantity_kind: { type: string }
    scope_id: { type: string, enum: ["scope-\b\f\u0001-雪-😀"] }
    subject_ref:
      type: union
      discriminator: variant
      variants:
        - type: object
          properties:
            variant: { type: string, enum: [space] }
            space_id: { type: string }
        - type: object
          properties:
            variant: { type: string, enum: [boundary-face] }
            boundary_face_id: { type: string }
        - type: object
          properties:
            variant: { type: string, enum: [building] }
            building_id: { type: string }
    aggregation_scope_id: { type: string }
    numeric_policy_id: { type: string }
    quantity_state: { type: string }
    slot_disposition: { type: string }
    value_interval:
      type: object
      properties:
        minimum: { type: string, enum: ["1"] }
        maximum: { type: string, enum: ["2"] }
    absolute_error_upper_bound: { type: string, enum: ["0.01"] }
    segments:
      type: array
      items:
        type: object
        properties:
          id: { type: string, minLength: 1 }
          labels:
            type: array
            items: { type: string }
    numeric_lexemes:
      type: object
      properties:
        negative_zero: { type: string, enum: ["-0"] }
        exponent: { type: string, enum: ["1e+21"] }
        min_subnormal: { type: string, enum: ["5e-324"] }
        max_finite: { type: string, enum: ["1.7976931348623157e+308"] }
    fragment_ids:
      type: array
      items: { type: string, minLength: 1 }
      maxItems: 1024
    canonical_evidence_hash: { type: string, pattern: "^[0-9a-f]{64}$" }
  requires: []
  portable_rules:
    - kind: evidence.canonical-hash
      id: EV-CANONICAL-HASH
      error: EVIDENCE_HASH_MISMATCH
      source: input
      hash: input.canonical_evidence_hash
    - kind: collection.unique
      id: EV-FRAGMENTS-UNIQUE
      error: DUPLICATE_FRAGMENT_ID
      collection: input.fragment_ids
    - kind: collection.unique
      id: EV-SEGMENTS-UNIQUE
      error: DUPLICATE_SEGMENT_ID
      collection: input.segments
      key: id
  effects:
    - { target: state.evidence_version, action: assign, expression: input.evidence_version }
    - { target: state.quantity_kind, action: assign, expression: input.quantity_kind }
    - { target: state.scope_id, action: assign, expression: input.scope_id }
    - { target: state.subject_ref, action: assign, expression: input.subject_ref }
    - { target: state.aggregation_scope_id, action: assign, expression: input.aggregation_scope_id }
    - { target: state.numeric_policy_id, action: assign, expression: input.numeric_policy_id }
    - { target: state.quantity_state, action: assign, expression: input.quantity_state }
    - { target: state.slot_disposition, action: assign, expression: input.slot_disposition }
    - { target: state.value_interval, action: assign, expression: input.value_interval }
    - { target: state.absolute_error_upper_bound, action: assign, expression: input.absolute_error_upper_bound }
    - { target: state.persisted_segments, action: assign, expression: input.segments }
    - { target: state.numeric_lexemes, action: assign, expression: input.numeric_lexemes }
    - { target: state.fragment_ids, action: assign, expression: input.fragment_ids }
    - { target: state.canonical_evidence_hash, action: assign, expression: input.canonical_evidence_hash }
  errors:
    - { code: EVIDENCE_HASH_MISMATCH, traces: [IR-EVIDENCE-ROUNDTRIP-001] }
    - { code: DUPLICATE_FRAGMENT_ID, traces: [IR-PRIMITIVE-COLLECTION-001] }
    - { code: DUPLICATE_SEGMENT_ID, traces: [IR-NESTED-COLLECTION-001] }
  transaction: { atomic: true, rollback_on_failure: true }
```
