# Composite arithmetic boundary generation

`IR-TEST-003` extends deterministic conformance generation to affine
comparisons that contain addition or subtraction:

```text
a + b <= c
a + b < c
a + b >= c
a + b > c
a - b <= c
```

For each supported requirement, CRDD IR generates three isolated cases:

- `at-boundary`: the two arithmetic sides are exactly equal
- `outside-boundary`: the requirement is false by one representable unit
- `inside-boundary`: the requirement is true by one representable unit

The equality case distinguishes inclusive operators from their strict
mutations. Consequently, changing `<=` to `<`, `<` to `<=`, `>=` to `>`, or
`>` to `>=` changes at least one generated outcome and kills the mutant.

## Safety and determinism

The solver:

- starts from a deterministic baseline satisfying every requirement
- changes one referenced numeric field per generated scenario
- preserves every non-target requirement
- validates field type, `minimum`, and `maximum`
- uses one integer unit for integer fields
- uses one millimetre-equivalent quantum for built-in length units
- retains the declared source unit
- rejects non-finite and unsafe arithmetic
- emits cases in a stable order

The current expression language supports affine `+`, `-`, unary `-`,
references, and numeric literals. It does not silently approximate an
unrepresentable equality.

## Diagnostics

When generation cannot preserve the schema and the other requirements,
`project doctor` fails explicitly with:

- `CRDD_BOUNDARY_CASE_UNSATISFIABLE` when the supported boundary has no valid
  assignment
- `CRDD_BOUNDARY_CASE_UNSUPPORTED` when safe deterministic arithmetic cannot
  represent the requested boundary

The diagnostic includes the Requires ID, source expression, classification,
reason, and conflicting schema fields or Requires IDs.
