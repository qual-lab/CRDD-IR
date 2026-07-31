# Project configuration v0.2

Project configuration is target-neutral. Core owns source discovery, evidence,
and output isolation. Every platform is configured under `targets`.

```json
{
  "protocol": "crdd-ir/project-config-v0.2",
  "toolRoot": "tools/CRDD-IR",
  "sources": ["contracts/operation.md"],
  "evidence": "quality/crdd-ir",
  "targets": {
    "typescript": {
      "output": "generated/typescript"
    },
    "python": {
      "module": "tools/crdd-target-python/register.ts",
      "output": "generated/python"
    }
  }
}
```

Each target owns its optional `profile` and `options`. Core does not define
engine roots, application project files, asset directories, server frameworks,
or transport channels.

External targets set a project-relative `module`. The wrapper and Doctor load
that module before target discovery, profile validation, or generation.

The installer accepts a list of target IDs:

```powershell
.\tools\CRDD-IR\scripts\install-project.ps1 `
  -ProjectRoot . `
  -Source @("contracts/read.md", "contracts/change.md") `
  -Target @("typescript", "ir")
```

Generation iterates the configured target registry:

```powershell
.\tools\crdd-ir.ps1 doctor
.\tools\crdd-ir.ps1 generate
.\tools\crdd-ir.ps1 verify
```

## Adopting a reviewed config change

The installer owns `crdd-ir.config.json` by SHA-256. Doctor therefore rejects
unreviewed edits with `CRDD_MANAGED_FILE_MODIFIED`. Preview and explicitly adopt
an intentional change with:

```powershell
node tools/CRDD-IR/src/cli.ts project adopt-config crdd-ir.config.json --dry-run
node tools/CRDD-IR/src/cli.ts project adopt-config crdd-ir.config.json
```

The command validates the config schema, sources, target/output isolation, and
the remaining Doctor safety gates. It reports the old and new hash and updates
only the config entry in `.crdd-ir.install.json`; wrappers and all other managed
files are untouched. CI must not call `adopt-config`.
