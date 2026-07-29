# Authorize Invoice

This fixture proves that the CRDD IR core models a non-game business operation.

```crdd-contract
schema: crdd-source-contract/v0.1
operation:
  id: AuthorizeInvoice
  traces:
    - REQ-BILLING-001
  input:
    amount:
      type: number
      unit: USD
      minimum: 0
  state:
    availableCredit:
      type: number
      unit: USD
      minimum: 0
  requires:
    - id: positive-amount
      condition: input.amount > 0USD
      error: INVALID_AMOUNT
    - id: sufficient-credit
      condition: state.availableCredit >= input.amount
      error: CREDIT_EXCEEDED
  effects:
    - target: state.availableCredit
      action: assign
      expression: state.availableCredit - input.amount
  errors:
    - code: INVALID_AMOUNT
      traces:
        - REQ-BILLING-001
    - code: CREDIT_EXCEEDED
      traces:
        - REQ-BILLING-001
  transaction:
    atomic: true
    rollback_on_failure: true
  extensions:
    com.example.audit:
      protocol: example/audit-v1
      data:
        category: billing
        retention_days: 2555
```
