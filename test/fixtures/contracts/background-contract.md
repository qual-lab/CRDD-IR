# Async Operation

Accepts a cancellable, idempotent background operation and declares its completion event.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: SubmitTask
  kind: command
  traces: [REQ-JOB-001]
  input:
    requestId: { type: string, pattern: "^[A-Za-z0-9-]+$" }
  state:
    tasks:
      type: array
      items:
        type: object
        properties:
          requestId: { type: string }
          status:
            type: string
            enum: [accepted, running, succeeded, failed, canceled]
  output:
    type: object
    properties:
      requestId: { type: string }
      status:
        type: string
        enum: [accepted]
  requires: []
  effects:
    - target: state.tasks
      action: append
      value:
        requestId: $input.requestId
        status: accepted
  errors: []
  transaction:
    atomic: true
    rollback_on_failure: true
  execution:
    mode: async
    cancelable: true
    timeout_ms: 30000
    idempotency: required
  emits:
    - type: TaskCompleted
      delivery: at-least-once
      traces: [REQ-JOB-001]
      payload:
        type: union
        discriminator: outcome
        variants:
          - type: object
            properties:
              outcome: { type: string, enum: [succeeded] }
              result: { type: string }
          - type: object
            properties:
              outcome: { type: string, enum: [failed] }
              error: { type: string }
```
