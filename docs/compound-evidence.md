# Compound values and reversible Evidence

CRDD-IR supports portable discriminated unions, primitive arrays, and canonical
Evidence hashing for Unreal C++ and Unity C# targets.

## Discriminated unions

Use `type: union`, an explicit discriminator, and object variants. Every variant
must declare a unique discriminator literal. Generated targets contain an
`Unknown` enum value and fail closed when no declared variant is selected;
unknown variants are never silently mapped to a default payload.

## Primitive collections

Arrays may contain scalar `string`, `integer`, `number`, or `boolean` values.
They preserve order and support empty arrays and `minItems`/`maxItems`.
`collection.unique` omits `key` for a primitive array:

```yaml
- kind: collection.unique
  id: EV-FRAGMENTS-UNIQUE
  error: DUPLICATE_FRAGMENT_ID
  collection: input.fragment_ids
```

## Canonical Evidence

`evidence.canonical-hash` verifies the SHA-256 of canonical UTF-8 JSON. Object
keys are sorted, arrays retain source order, and the configured hash field is
excluded from the digest payload.

Strings follow JSON escaping identically on Node, Unreal, and Unity: quotation
mark and reverse solidus are escaped; backspace, form feed, newline, carriage
return, and tab use their short escapes; every other U+0000-U+001F code unit
uses lowercase `\u00xx`. Valid Unicode scalar values are emitted as UTF-8.
Unpaired UTF-16 surrogates use lowercase `\uxxxx`, matching `JSON.stringify`.

Binary floating-point `number` fields are deliberately unsupported anywhere
inside the selected hash scope. Their shortest decimal spelling differs across
JavaScript, C++, and .NET for values such as `-0`, subnormals, and exponent
boundaries. The compiler rejects such a contract. Evidence must represent an
exact numeric value as a schema-constrained canonical decimal `string`.
`integer` remains supported.

```yaml
- kind: evidence.canonical-hash
  id: EV-CANONICAL-HASH
  error: EVIDENCE_HASH_MISMATCH
  source: input
  hash: input.canonical_evidence_hash
```

The simulator and generated Unreal/Unity implementations reject a missing or
modified payload with the same Rule ID and Error Code before applying effects.
Generated conformance owns both a valid round-trip case and an isolated hash
mutation case. Target parity Evidence reports `IR-UNION-001`,
`IR-PRIMITIVE-COLLECTION-001`, and `IR-EVIDENCE-ROUNDTRIP-001` when used.

The reference contract is
`test/fixtures/contracts/compound-evidence-contract.md`. It exercises all
required fields, three union variants, primitive-array ordering and uniqueness,
canonical hashing, atomic commit, and rollback.
