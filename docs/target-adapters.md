# Target adapters

CRDD IR routes target generation through a single registry. CLI and batch code do not
contain a switch for each engine.

```text
CRDD Markdown -> Compiler -> Target Registry -> Target Adapter -> Generated files
```

## Commands

```powershell
node tools/CRDD-IR/src/cli.ts target list
node tools/CRDD-IR/src/cli.ts target describe unity

node tools/CRDD-IR/src/cli.ts generate unity 05_SPEC/MyOperation.md `
  --profile Config/CRDD/unity-target.json `
  --out-dir 40_Develop/MyGame/Assets/Generated/CRDD

node tools/CRDD-IR/src/cli.ts batch unity 05_SPEC/operations/*.md `
  --profile Config/CRDD/unity-target.json `
  --out-dir 40_Develop/MyGame/Assets/Generated/CRDD `
  --flat
```

`target list` and `target describe` return JSON so CI and wrappers can discover supported
targets and their profile requirements. Existing `unreal generate` and `unity generate`
commands remain compatibility aliases.

## Adding a target

Implement `TargetAdapter` and register it with `registerTargetAdapter`. The adapter owns:

- target ID and human-readable description
- profile schema and validation
- flat batch capability
- deterministic generation from a compiled CRDD operation

The CLI argument parser, batch generator, collision detection, and target discovery do not
need target-specific branches. Built-in registrations are in
`src/target-registry.ts`.
