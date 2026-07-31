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

## Nested primitive collections

Object collection elements may contain primitive arrays such as `string[]`,
`integer[]`, `number[]`, and `boolean[]`. Unreal generates nested `TArray<T>`
members and Unity generates nested `List<T>` members. Empty arrays and source
order are preserved by generated fixtures, canonical Evidence serialization,
and Input-to-State effects.

Nested object collections, nested maps, and nested unions are not part of the
v0.6.0 target-generation surface.

## Structural collection element types

Top-level arrays or maps whose object elements have the same generated shape
share one deterministic target type across Input and State, even when their
field names differ. Shape identity includes property names, nested collection
shape, units, and projected target scalar types. Source constraints remain on
their owning fields and are not merged.

This prevents duplicate C++ struct declarations and makes whole-collection
Input-to-State assignment type-compatible. When different shapes would produce
the same preferred target name, the generator adds a deterministic scope and
numeric suffix instead of emitting a duplicate declaration.

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
`IR-PRIMITIVE-COLLECTION-001`, `IR-EVIDENCE-ROUNDTRIP-001`,
`IR-STRUCTURAL-TYPE-001`, and `IR-NESTED-COLLECTION-001` when used.

The reference contract is
`test/fixtures/contracts/compound-evidence-contract.md`. It exercises all
required fields, three union variants, primitive-array ordering and uniqueness,
shared object element types, nested primitive arrays, canonical hashing, atomic
commit, and rollback.
