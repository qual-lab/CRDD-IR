# Deterministic collection evaluation

CRDD IR v0.10.0 adds typed, deterministic scalar aggregation over arrays and
maps. The operation contract remains the authority for policy values; adapters
receive only the generated result and events.

## Expressions

The following functions are available in `requires`, effect expressions,
`returns`, and event mappings:

```text
count(collection, alias, predicate)
sum(collection, alias, value, predicate)
join_count(left, leftAlias, right, rightAlias, predicate)
join_sum(left, leftAlias, right, rightAlias, value, predicate)
```

Aliases are lexically scoped and expose object properties directly. Primitive
items expose `alias.value`. Predicates act as deterministic filters. Grouped
aggregates are expressed by filtering on a typed group field, such as
`truth.role == "primary"`. Join functions enumerate the left collection and
then the right collection in their declared order. Map values are enumerated in
the target runtime's deterministic generated representation.

`count` and `join_count` return integers. `sum` and `join_sum` require a numeric
value expression. Invalid aliases, non-collection sources, non-boolean
predicates, incompatible comparisons, and non-numeric sums fail during
Source Contract checking.

Every aggregated collection must declare `maxItems`. Numeric values that can
contribute to a sum or to arithmetic around an aggregate must declare finite
`minimum` and `maximum` bounds. The compiler evaluates a conservative interval
and rejects the contract unless the complete expression is proven to remain in
the portable safe-integer range. This prevents target-specific overflow
fallbacks from changing scores or committing partial rewards.

## Private inputs

An input that contains authoritative or non-public data can declare:

```yaml
truthGraph:
  type: array
  visibility: private
  items: ...
```

A private field can participate in validation and scalar aggregation, but it
cannot be projected directly as an output or event payload expression. Output
schemas should contain only approved scores, bands, rewards, and revisions.
The generated Unreal and Unity input DTOs still accept private data from the
trusted host boundary; the compiler does not treat client-provided values as
authoritative.

## Transaction behavior

Collection validation runs before effects. A failed uniqueness, inclusion,
join-validity, or revision rule returns its declared Rule ID/Error Code,
preserves the original state and reward, and emits no output or event. All
effects, output construction, and event construction use the same candidate
state in Simulator, Unreal, and Unity.

The generic fixture is
`test/fixtures/contracts/collection-evaluation.md`; it intentionally contains
no product-specific names or balancing values.
