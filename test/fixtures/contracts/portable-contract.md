# Portable typed contract fixture

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: synchronize-model
  kind: command
  traces: [REQ-PORTABLE-001]
  input:
    proposed_extension: { type: opaque, encoding: base64, digest: sha256 }
    edit_unknown: { type: boolean }
    new_element_id: { type: string }
    new_numeric_id: { type: integer }
    proposed_elements:
      type: map
      values:
        type: object
        properties:
          id: { type: string }
    frames:
      type: array
      items:
        type: object
        properties:
          id: { type: string }
          kind: { type: string }
  state:
    parents:
      type: map
      values:
        type: object
        properties:
          id: { type: string }
    elements:
      type: array
      items:
        type: object
        properties:
          id: { type: string }
          kind: { type: string }
          frame_id: { type: string }
          parent_id: { type: string }
    numeric_elements:
      type: array
      items:
        type: object
        properties:
          id: { type: integer }
    relations:
      type: array
      items:
        type: object
        properties:
          from_id: { type: string }
          to_id: { type: string }
    map_elements:
      type: map
      values:
        type: object
        properties:
          id: { type: string }
          kind: { type: string }
          frame_id: { type: string }
          parent_id: { type: string }
    map_relations:
      type: map
      values:
        type: object
        properties:
          from_id: { type: string }
          to_id: { type: string }
    unknown_extension: { type: opaque, encoding: base64, digest: sha256 }
  requires: []
  portable_rules:
    - kind: collection.unique
      id: DM-ELEMENT-ID-UNIQUE
      error: DUPLICATE_ELEMENT_ID
      collection: state.elements
      key: id
    - kind: collection.reference
      id: DM-FRAME-REFERENCE
      error: FRAME_REFERENCE_NOT_FOUND
      collection: state.elements
      reference: frame_id
      target: input.frames
      targetKey: id
      targetType: { field: kind, equals: coordinate-frame }
    - kind: collection.membership
      id: DM-PARENT-MEMBERSHIP
      error: PARENT_NOT_FOUND
      collection: state.elements
      parentReference: parent_id
      parents: state.parents
      parentKey: id
    - kind: collection.relation
      id: DM-RELATION-ENDPOINTS
      error: RELATION_ENDPOINT_INVALID
      collection: state.relations
      from: from_id
      to: to_id
      elements: state.elements
      elementKey: id
      fromType: { field: kind, equals: source }
      toType: { field: kind, equals: target }
    - kind: collection.unique
      id: DM-MAP-ELEMENT-ID-UNIQUE
      error: DUPLICATE_MAP_ELEMENT_ID
      collection: state.map_elements
      key: id
    - kind: collection.reference
      id: DM-MAP-FRAME-REFERENCE
      error: MAP_FRAME_REFERENCE_NOT_FOUND
      collection: state.map_elements
      reference: frame_id
      target: input.frames
      targetKey: id
      targetType: { field: kind, equals: coordinate-frame }
    - kind: collection.membership
      id: DM-MAP-PARENT-MEMBERSHIP
      error: MAP_PARENT_NOT_FOUND
      collection: state.map_elements
      parentReference: parent_id
      parents: state.parents
      parentKey: id
    - kind: collection.relation
      id: DM-MAP-RELATION-ENDPOINTS
      error: MAP_RELATION_ENDPOINT_INVALID
      collection: state.map_relations
      from: from_id
      to: to_id
      elements: state.map_elements
      elementKey: id
      fromType: { field: kind, equals: source }
      toType: { field: kind, equals: target }
    - kind: collection.not-contains
      id: DM-NEW-ELEMENT-ID-AVAILABLE
      error: ELEMENT_ID_ALREADY_EXISTS
      value: input.new_element_id
      collection: state.elements
      targetKey: id
    - kind: collection.prospective-unique
      id: DM-PROPOSED-ELEMENTS-UNIQUE
      error: PROPOSED_ELEMENT_ID_CONFLICT
      candidates: input.proposed_elements
      candidateKey: id
      existing: state.elements
      existingKey: id
    - kind: collection.not-contains
      id: DM-NEW-NUMERIC-ID-AVAILABLE
      error: NUMERIC_ID_ALREADY_EXISTS
      value: input.new_numeric_id
      collection: state.numeric_elements
      targetKey: id
    - kind: opaque.integrity
      id: DM-UNKNOWN-BYTES
      error: UNKNOWN_BYTES_INVALID
      target: input.proposed_extension
    - kind: opaque.integrity
      id: DM-STORED-UNKNOWN-BYTES
      error: STORED_UNKNOWN_BYTES_INVALID
      target: state.unknown_extension
    - kind: opaque.immutable-when-inactive
      id: DM-UNKNOWN-PRESERVED
      error: UNKNOWN_EXTENSION_EDIT_REJECTED
      current: state.unknown_extension
      proposed: input.proposed_extension
    - kind: opaque.reject-edit-when-inactive
      id: DM-UNKNOWN-EDIT-INTENT
      error: UNKNOWN_EXTENSION_EDIT_REJECTED
      current: state.unknown_extension
      intent: input.edit_unknown
  effects:
    - target: state.unknown_extension
      action: assign
      expression: input.proposed_extension
  errors:
    - { code: DUPLICATE_ELEMENT_ID, traces: [IR-COLLECTION-001] }
    - { code: FRAME_REFERENCE_NOT_FOUND, traces: [IR-COLLECTION-001] }
    - { code: PARENT_NOT_FOUND, traces: [IR-COLLECTION-001] }
    - { code: RELATION_ENDPOINT_INVALID, traces: [IR-COLLECTION-001] }
    - { code: DUPLICATE_MAP_ELEMENT_ID, traces: [IR-COLLECTION-001] }
    - { code: MAP_FRAME_REFERENCE_NOT_FOUND, traces: [IR-COLLECTION-001] }
    - { code: MAP_PARENT_NOT_FOUND, traces: [IR-COLLECTION-001] }
    - { code: MAP_RELATION_ENDPOINT_INVALID, traces: [IR-COLLECTION-001] }
    - { code: ELEMENT_ID_ALREADY_EXISTS, traces: [IR-COLLECTION-001] }
    - { code: PROPOSED_ELEMENT_ID_CONFLICT, traces: [IR-COLLECTION-001] }
    - { code: NUMERIC_ID_ALREADY_EXISTS, traces: [IR-COLLECTION-001] }
    - { code: UNKNOWN_BYTES_INVALID, traces: [IR-OPAQUE-001] }
    - { code: STORED_UNKNOWN_BYTES_INVALID, traces: [IR-OPAQUE-001] }
    - { code: UNKNOWN_EXTENSION_EDIT_REJECTED, traces: [IR-IMMUTABLE-001] }
  transaction: { atomic: true, rollback_on_failure: true }
```
