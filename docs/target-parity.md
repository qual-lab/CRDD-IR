# Unreal and Unity target parity

CRDD IR tracks two target requirements:

- `IR-TARGET-001`: generate Unreal C++ and Unity C# independently;
- `IR-PARITY-001`: reject target profiles whose observable contract semantics differ.

Run the static parity gate with:

```powershell
node tools/CRDD-IR/src/cli.ts target parity contracts/MyOperation.md `
  --unreal-profile Config/CRDD/ue-5.8-editor.json `
  --unity-profile Config/CRDD/unity-6-il2cpp.json `
  --out evidence/crdd-ir/target-parity.json
```

The report records the shared source IR and conformance digests, both target profile
digests, and every generated target file digest. It verifies that:

- Unreal outputs are C++ and contain no Unity dependency;
- Unity outputs are C# and contain no Unreal dependency;
- both adapters receive the same versioned IR;
- both adapters are measured against the same generated conformance semantics;
- both adapters emit the same snapshot-ownership contract digest;
- every numeric unit has equivalent width, number kind, JSON representation, rounding,
  and overflow behavior.

The command exits non-zero when parity fails. For example, Unreal `int64` with
`decimal-string`, lossless rejection, and overflow error is equivalent to Unity `long`
with the corresponding policies. A `number`/`decimal-string` mismatch fails the gate.

This is the deterministic static parity gate. Runtime evidence remains target-specific:
run `verify:unreal` and `verify:unity` to prove the generated implementation in each
engine/toolchain.

v0.4.0 through v0.5.0 emit `crdd-ir/target-parity-v0.2`. The v0.2 protocol makes the current
required fields explicit and intentionally does not reinterpret old v0.1
Evidence. Consumers should regenerate Evidence and switch schema validation to
v0.2 in the same change.

v0.6.0 emits `crdd-ir/target-parity-v0.3`. It adds
`snapshotOwnershipSha256` to the report and each target, plus
`checks.sharedSnapshotOwnership`. The digest is derived from the ownership
contract embedded in generated Unreal and Unity conformance tests. Consumers
must regenerate Evidence and move schema validation from v0.2 to v0.3; older
Evidence remains historical and is not rewritten.
