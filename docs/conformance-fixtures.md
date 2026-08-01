# Reviewable conformance fixtures

CRDD IR normally derives a valid baseline and mutates one selector field for
conditional branch coverage. When a branch is legal only if several fields
change together, declare the reviewed values in the Source Contract.

```yaml
operation:
  conformance:
    baseline:
      input:
        count_band: none
        signal_a: false
        signal_b: false
      state:
        accepted: false
    seeds:
      - id: one-signal
        when: input.count_band == "one"
        input:
          count_band: one
          signal_a: true
          signal_b: false
```

`baseline` and each seed are partial `input`/`state` objects. The baseline is
merged with schema-derived defaults. A seed is merged into that baseline after
the selected enum value is applied. `when` is normalized by the same typed
expression parser used by conditional Requires and effects.

## Validation

`check`, generation, Doctor, and target parity fail closed when:

- a value references an unknown field or violates its type, enum, or range;
- the declared baseline does not satisfy every active Requires;
- a seed does not match a declared effect or Requires condition;
- two seeds own the same normalized condition;
- applying a seed leaves any active Requires unsatisfied.

An invalid explicit fixture is never repaired by the search solver. This keeps
the reviewed Contract values authoritative and prevents test-only inputs from
weakening production validation.

The normalized conformance plan is part of Internal IR and therefore its
digest. Unreal and Unity generation consume the same test manifest, and target
parity compares the resulting shared conformance digest.

## Compatibility

`conformance` is optional. Existing contracts continue to use deterministic
baseline search and single-selector branch coverage. Add explicit seeds only
for conditions whose legal input requires coordinated values.
