# Collection Evaluation

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: EvaluateCollectionSubmission
  kind: command
  traces: [IR-COLLECTION-EVALUATION-001, IR-PRIVATE-OUTPUT-001]
  input:
    expectedRevision: { type: integer }
    selectedIds:
      type: array
      maxItems: 15
      items: { type: string }
    truthCatalog:
      type: array
      visibility: private
      maxItems: 15
      items: { type: string }
    records:
      type: array
      maxItems: 100
      items:
        type: object
        properties:
          recordId: { type: string }
          observationId: { type: string }
          captureMethod: { type: string, enum: [photo, audio, sensor] }
    truthNodes:
      type: array
      visibility: private
      maxItems: 100
      items:
        type: object
        properties:
          truthId: { type: string }
          role: { type: string, enum: [primary, contributing, cover] }
    observationRelations:
      type: array
      visibility: private
      maxItems: 1000
      items:
        type: object
        properties:
          observationId: { type: string }
          captureMethod: { type: string, enum: [photo, audio, sensor] }
          truthId: { type: string }
          relation: { type: string, enum: [supports, contradicts, ambiguous] }
          reliability: { type: integer, minimum: 0, maximum: 100 }
          importance: { type: integer, minimum: 0, maximum: 100 }
    policy:
      type: object
      visibility: private
      properties:
        primaryWeight: { type: integer, minimum: 0, maximum: 100000 }
        contributingWeight: { type: integer, minimum: 0, maximum: 100000 }
        coverWeight: { type: integer, minimum: 0, maximum: 100000 }
        incorrectPenalty: { type: integer, minimum: 0, maximum: 100000 }
        rewardMultiplier: { type: integer, minimum: 0, maximum: 100000 }
        highBandMinimum: { type: integer, minimum: -1000000000, maximum: 1000000000 }
        mediumBandMinimum: { type: integer, minimum: -1000000000, maximum: 1000000000 }
  state:
    revision: { type: integer, minimum: 0 }
    submitted: { type: boolean }
    truthAccuracyScore: { type: integer }
    reportingQualityScore: { type: integer }
    totalScore: { type: integer }
    rewardBalance: { type: integer }
    rewardAwarded: { type: integer }
    resultBand: { type: string, enum: [none, low, medium, high] }
  output:
    type: object
    properties:
      truthAccuracyScore: { type: integer }
      reportingQualityScore: { type: integer }
      totalScore: { type: integer }
      reward: { type: integer }
      resultBand: { type: string, enum: [none, low, medium, high] }
      revision: { type: integer }
  returns:
    truthAccuracyScore: state.truthAccuracyScore
    reportingQualityScore: state.reportingQualityScore
    totalScore: state.totalScore
    reward: state.rewardAwarded
    resultBand: state.resultBand
    revision: state.revision
  requires:
    - id: revision-matches
      condition: input.expectedRevision == state.revision
      error: REVISION_CONFLICT
    - id: not-previously-submitted
      condition: state.submitted == false
      error: ALREADY_SUBMITTED
    - id: selection-not-empty
      condition: count(input.selectedIds, selected, true) > 0
      error: EMPTY_SELECTION
    - id: selected-ids-known
      condition: count(input.selectedIds, selected, true) == join_count(input.selectedIds, selected, input.truthCatalog, known, selected.value == known.value)
      error: UNKNOWN_SELECTION_ID
    - id: records-are-valid
      condition: count(input.records, record, true) == join_count(input.records, record, input.observationRelations, relation, record.observationId == relation.observationId && record.captureMethod == relation.captureMethod)
      error: INVALID_RECORD
  portable_rules:
    - kind: collection.unique
      id: selected-ids-unique
      error: DUPLICATE_SELECTION
      collection: input.selectedIds
    - kind: collection.unique
      id: truth-catalog-ids-unique
      error: INVALID_PRIVATE_GRAPH
      collection: input.truthCatalog
    - kind: collection.unique
      id: record-ids-unique
      error: DUPLICATE_RECORD
      collection: input.records
      key: recordId
    - kind: collection.reference
      id: relation-truth-reference
      error: INVALID_PRIVATE_GRAPH
      collection: input.observationRelations
      reference: truthId
      target: input.truthNodes
      targetKey: truthId
  effects:
    - target: state.truthAccuracyScore
      action: assign
      expression: join_count(input.selectedIds, selected, input.truthNodes, truth, selected.value == truth.truthId && truth.role == "primary") * input.policy.primaryWeight + join_count(input.selectedIds, selected, input.truthNodes, truth, selected.value == truth.truthId && truth.role == "contributing") * input.policy.contributingWeight + join_count(input.selectedIds, selected, input.truthNodes, truth, selected.value == truth.truthId && truth.role == "cover") * input.policy.coverWeight - (count(input.selectedIds, selected, true) - join_count(input.selectedIds, selected, input.truthNodes, truth, selected.value == truth.truthId)) * input.policy.incorrectPenalty
    - target: state.reportingQualityScore
      action: assign
      expression: join_sum(input.records, record, input.observationRelations, relation, relation.reliability + relation.importance, record.observationId == relation.observationId && record.captureMethod == relation.captureMethod)
    - target: state.totalScore
      action: assign
      expression: state.truthAccuracyScore + state.reportingQualityScore
    - target: state.rewardAwarded
      action: assign
      expression: state.totalScore * input.policy.rewardMultiplier
    - target: state.rewardBalance
      action: increment
      expression: state.rewardAwarded
    - target: state.resultBand
      action: assign
      expression: '"low"'
    - target: state.resultBand
      action: assign
      expression: '"medium"'
      when: state.totalScore >= input.policy.mediumBandMinimum
    - target: state.resultBand
      action: assign
      expression: '"high"'
      when: state.totalScore >= input.policy.highBandMinimum
    - target: state.revision
      action: increment
      expression: "1"
    - target: state.submitted
      action: assign
      expression: "true"
  errors:
    - { code: REVISION_CONFLICT, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: ALREADY_SUBMITTED, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: EMPTY_SELECTION, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: UNKNOWN_SELECTION_ID, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: INVALID_RECORD, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: DUPLICATE_SELECTION, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: DUPLICATE_RECORD, traces: [IR-COLLECTION-EVALUATION-001] }
    - { code: INVALID_PRIVATE_GRAPH, traces: [IR-COLLECTION-EVALUATION-001] }
  conformance:
    baseline:
      input:
        expectedRevision: 4
        selectedIds: [truth-primary, truth-cover, wrong]
        truthCatalog: [truth-primary, truth-contributing, truth-cover, wrong]
        records:
          - { recordId: record-1, observationId: obs-1, captureMethod: photo }
        truthNodes:
          - { truthId: truth-primary, role: primary }
          - { truthId: truth-contributing, role: contributing }
          - { truthId: truth-cover, role: cover }
        observationRelations:
          - { observationId: obs-1, captureMethod: photo, truthId: truth-primary, relation: supports, reliability: 3, importance: 2 }
        policy:
          primaryWeight: 10
          contributingWeight: 5
          coverWeight: 1
          incorrectPenalty: 2
          rewardMultiplier: 3
          highBandMinimum: 15
          mediumBandMinimum: 8
      state:
        revision: 4
        submitted: false
        truthAccuracyScore: 0
        reportingQualityScore: 0
        totalScore: 0
        rewardBalance: 100
        rewardAwarded: 0
        resultBand: none
    seeds:
      - id: medium-band
        when: state.totalScore >= input.policy.mediumBandMinimum
        input:
          expectedRevision: 4
          selectedIds: [truth-primary, truth-cover, wrong]
          truthCatalog: [truth-primary, truth-contributing, truth-cover, wrong]
          records: [{ recordId: record-1, observationId: obs-1, captureMethod: photo }]
          truthNodes:
            - { truthId: truth-primary, role: primary }
            - { truthId: truth-contributing, role: contributing }
            - { truthId: truth-cover, role: cover }
          observationRelations:
            - { observationId: obs-1, captureMethod: photo, truthId: truth-primary, relation: supports, reliability: 3, importance: 2 }
          policy: { primaryWeight: 10, contributingWeight: 5, coverWeight: 1, incorrectPenalty: 2, rewardMultiplier: 3, highBandMinimum: 15, mediumBandMinimum: 8 }
        state: { revision: 4, submitted: false, truthAccuracyScore: 0, reportingQualityScore: 0, totalScore: 17, rewardBalance: 100, rewardAwarded: 0, resultBand: none }
      - id: high-band
        when: state.totalScore >= input.policy.highBandMinimum
        input:
          expectedRevision: 4
          selectedIds: [truth-primary, truth-cover, wrong]
          truthCatalog: [truth-primary, truth-contributing, truth-cover, wrong]
          records: [{ recordId: record-1, observationId: obs-1, captureMethod: photo }]
          truthNodes:
            - { truthId: truth-primary, role: primary }
            - { truthId: truth-contributing, role: contributing }
            - { truthId: truth-cover, role: cover }
          observationRelations:
            - { observationId: obs-1, captureMethod: photo, truthId: truth-primary, relation: supports, reliability: 3, importance: 2 }
          policy: { primaryWeight: 10, contributingWeight: 5, coverWeight: 1, incorrectPenalty: 2, rewardMultiplier: 3, highBandMinimum: 15, mediumBandMinimum: 8 }
        state: { revision: 4, submitted: false, truthAccuracyScore: 0, reportingQualityScore: 0, totalScore: 17, rewardBalance: 100, rewardAwarded: 0, resultBand: none }
  emits:
    - type: CollectionSubmissionEvaluated
      payload:
        type: object
        properties:
          totalScore: { type: integer }
          reward: { type: integer }
          resultBand: { type: string, enum: [none, low, medium, high] }
          revision: { type: integer }
      value:
        totalScore: state.totalScore
        reward: state.rewardAwarded
        resultBand: state.resultBand
        revision: state.revision
      delivery: at-most-once
      traces: [IR-COLLECTION-EVALUATION-001]
  transaction:
    atomic: true
    rollback_on_failure: true
```
