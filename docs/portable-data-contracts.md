# Portable collection and opaque-data contracts

CRDD IR v0.4.0 adds target-neutral typed rules for referential integrity and
forward-compatible unknown data. These rules belong to Core IR. Product
adapters do not reinterpret them.

## Source syntax

`portable_rules` is evaluated after ordinary `requires`, in declaration order,
and before any effect. A failed rule returns its declared Rule ID and Error
Code. Atomic operations return the original state and perform no effect.

Supported collection rules are:

- `collection.unique`: unique, non-empty IDs within an array or string-keyed map
- `collection.reference`: reference existence with an optional target type
- `collection.membership`: membership in a parent collection
- `collection.relation`: existence and optional type of both endpoints

Collection paths address top-level `input` or `state` arrays or string-keyed
maps whose values are objects. Input and state collections use the same
generation path. IDs and references must be non-empty strings or safe integers,
and a reference member must have the same declared type as its target key.
Other scalar key types are rejected while compiling the Source Contract.

```yaml
portable_rules:
  - kind: collection.reference
    id: DM-FRAME-REFERENCE
    error: FRAME_REFERENCE_NOT_FOUND
    collection: state.elements
    reference: frame_id
    target: state.frames
    targetKey: id
    targetType: { field: kind, equals: coordinate-frame }
```

## Opaque values

An opaque field has one portable representation:

```yaml
unknown_extension:
  type: opaque
  encoding: base64
  digest: sha256
```

Its runtime value contains canonical `base64`, lowercase `sha256` of the
decoded bytes, and an `active` boolean. `opaque.integrity` rejects
non-canonical Base64 and digest mismatches. Decode followed by encode must
reproduce the exact Base64 text. No JSON or text reserialization occurs.

`opaque.immutable-when-inactive` compares the current and proposed envelope
byte-for-byte. When `current.active` is false, Base64, digest, and active state
must all remain identical. The conventional portable rejection is:

- Rule ID: `DM-UNKNOWN-PRESERVED`
- Error Code: `UNKNOWN_EXTENSION_EDIT_REJECTED`

## Generated semantics

Unreal C++ uses `FString`, `FBase64`, and `FSHA256`. Unity C# uses
`Convert.FromBase64String` and `System.Security.Cryptography.SHA256`.
Both adapters generate checks in Source declaration order before effects.

Each Target Adapter writes deterministic `CRDD-PORTABLE-SEMANTICS` records next
to its generated guards. Target parity extracts and hashes these target-owned
records independently as `portableRulesSha256`; it does not copy one Source
hash into both target entries. The batch manifest also records Source path and
full Operation IR digest.

Generated conformance includes one isolated rejection per portable rule and an
active opaque edit success case. Unity emits NUnit tests and Unreal emits an
Automation Test that execute the generated operation. Mutation analysis removes
every Core rule in turn.

Opaque assignment is a value transfer: adapters clone the envelope instead of
retaining the request DTO. `opaque.immutable-when-inactive` fails closed when
either envelope is malformed, even if a separate integrity rule was omitted.

## Upgrade from v0.3.1

Existing v0.3.1 Source Contracts remain valid without modification. The change
is additive:

1. keep `schema: crdd-source-contract/v0.1`;
2. declare `type: opaque` only for byte-preserved values;
3. add `portable_rules` only where Core must own the invariant;
4. regenerate both targets, conformance, parity evidence, and batch manifests.

Do not migrate arbitrary strings to `opaque`. Use it only where preserving the
original bytes, canonical Base64, digest, and inactive state is contractual.
