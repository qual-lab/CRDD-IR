# Collection predicates and operation results

CRDD IR v0.9.0 adds deterministic collection quantifiers and executable
operation results without moving product-specific presentation behavior into
the contract.

## Collection predicates

`all(collection, predicate)` and `any(collection, predicate)` are boolean
expressions. They may be used in `requires`, `effect.when`, effect expressions,
`returns`, and `emits.when`.

- `all` evaluates every item and returns `true` for an empty collection.
- `any` returns `true` when at least one item matches and returns `false` for an
  empty collection.
- object items use `item.<field>`; primitive items use `item.value`.
- predicates may compare item fields with other item fields, `input.*`,
  `state.*`, or typed constants.

A false quantifier is an ordinary boolean result unless the contract explicitly
uses it in `requires`. Input validity and domain invariants therefore remain
separate from a normal negative decision.

## Output and events

An executable output declares both its schema and its expression mapping:

```yaml
output:
  type: object
  properties:
    crossed: { type: boolean }
returns:
  crossed: state.crossed
```

`returns` is evaluated after all effects. Event conditions and payload mappings
can read `previous.*` (the immutable pre-operation snapshot) and `state.*` (the
post-effect candidate):

```yaml
emits:
  - type: ThresholdCrossed
    when: previous.crossed == false && state.crossed == true
    payload:
      type: object
      properties:
        crossed: { type: boolean }
    value:
      crossed: state.crossed
    traces: [IR-OUTPUT-EVENT-001]
```

This expresses a rising edge and prevents repeat emission after the transition.
On requirement or portable-rule failure, the original state is returned and no
output or event is produced. Unreal and Unity generated operation results and
bridge DTOs carry the same output and events to the product adapter boundary.

Presentation timelines, audio, lighting, and other engine-owned behavior remain
outside CRDD IR.
