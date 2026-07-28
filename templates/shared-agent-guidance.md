<!-- CRDD-IR:BEGIN -->
## CRDD-IR project contract

- CRDD Markdown under `05_SPEC/` is the source of truth.
- Do not guess missing or ambiguous contract information. Report it as a diagnostic and update CRDD before generating implementation.
- Run `.\tools\crdd-ir.ps1 check` after changing CRDD contracts.
- Run `.\tools\crdd-ir.ps1 verify` after changing generated implementation or Unreal integration.
- Do not edit generated source code, generated 3D assets, or generated manifests directly.
- Do not commit Internal IR or cache content under `.crdd-ir/`.
- Store reproducible verification evidence under `07_Quality/CRDD_IR/`.
- Preserve CRDD requirement and decision IDs through generated code, tests, assets, and evidence.
<!-- CRDD-IR:END -->
