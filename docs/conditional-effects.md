# Conditional effects and branch requirements

v0.7.0 lets one command choose effects and failure rules from typed input while
retaining one atomic state transaction.

```yaml
input:
  decision:
    type: string
    enum: [continue, withdraw]
requires:
  - id: withdraw-only-while-active
    when: input.decision == "withdraw"
    condition: state.status == "active"
    error: STATUS_NOT_ACTIVE
effects:
  - when: input.decision == "continue"
    traces: [BRANCH-CONTINUE]
    target: state.danger
    action: assign
    expression: state.danger + input.danger_gain
  - when: input.decision == "withdraw"
    traces: [BRANCH-WITHDRAW]
    target: state.status
    action: assign
    expression: '"withdrawn"'
```

`when` uses the same deterministic expression language as `condition`. Source
expressions require quoted string literals. For generated branch coverage,
v0.7.0 requires selectors in the portable form
`input.<enum-field> == "<declared-value>"`. Unsupported or unsatisfiable
selectors stop conformance generation with an explicit diagnostic.

Input validation occurs before branch evaluation, so unknown enum values fail
closed. Conditional Requires are evaluated only in their selected branch.
Effects are evaluated in declaration order against one working snapshot; any
failure before commit returns the original state under the existing atomic
transaction contract. Successful results contain operation traces followed by
the traces of every applied effect.

The generated conformance bundle owns every declared effect branch, every
conditional failure, rollback, and mutations that remove or invert branch
selectors. Unreal C++ and Unity C# therefore execute the same branch fixtures.
