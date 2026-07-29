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
    }
  }
}
```

Each target owns its optional `profile` and `options`. Core does not define
engine roots, application project files, asset directories, server frameworks,
or transport channels.

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
