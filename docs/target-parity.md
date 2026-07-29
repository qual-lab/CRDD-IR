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
- every numeric unit has equivalent width, number kind, JSON representation, rounding,
  and overflow behavior.

The command exits non-zero when parity fails. For example, Unreal `int64` with
`decimal-string`, lossless rejection, and overflow error is equivalent to Unity `long`
with the corresponding policies. A `number`/`decimal-string` mismatch fails the gate.

This is the deterministic static parity gate. Runtime evidence remains target-specific:
run `verify:unreal` and `verify:unity` to prove the generated implementation in each
engine/toolchain.
