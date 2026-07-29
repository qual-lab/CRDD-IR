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

node tools/CRDD-IR/src/cli.ts generate unity contracts/MyOperation.md `
  --profile Config/CRDD/unity-target.json `
  --out-dir generated/unity

node tools/CRDD-IR/src/cli.ts batch unity `
  contracts/operations/apply-record.md `
  contracts/operations/revise-record.md `
  --profile Config/CRDD/unity-target.json `
  --out-dir generated/unity `
  --flat
```

`target list` and `target describe` return JSON so CI and wrappers can discover supported
targets and their profile requirements. All targets use the same `generate <target>`
command shape.

## Adding a target

Implement `TargetAdapter` and register it with `registerTargetAdapter`. The adapter owns:

- target ID and human-readable description
- profile schema and validation
- flat batch capability
- deterministic generation from a compiled CRDD operation

The CLI argument parser, batch generator, collision detection, and target discovery do not
need target-specific branches. Built-in registrations are in
`src/target-registry.ts`.
