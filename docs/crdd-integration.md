# CRDD Repository Integration

`tools/crdd-ir.ps1` validates `crdd-ir.config.json` before generating files.
It rejects missing or unknown fields, invalid enum values, and project paths
that could escape the target repository.

The installer records owned files, tool version, and SHA-256 values in
`.crdd-ir.install.json`. Reinstalling is idempotent. If an owned file or
managed guidance block was edited, the installer backs it up under
`.crdd-ir/backups/` and stops. Review the difference before explicitly using
`-ForceManagedUpdate`.

For repositories with multiple contracts, use
`crdd-ir batch <ir|unreal|assets> <spec.md>... --out-dir <directory>`.
Each operation receives an isolated output directory and a SHA-256 batch
manifest. Duplicate operation IDs stop generation. Verified unchanged outputs
are reused; a corrupt cache manifest is preserved with a `.corrupt.*` suffix
before regeneration.

Use `--format json` with validation commands to receive the versioned
`crdd-ir/diagnostics-v0.1` envelope and stable `CRDD_*` diagnostic codes.
The expression language and Unreal adapter support numeric, boolean, and string
literals; array append effects may mix typed literals and field references.

CRDD IR本体はCRDD適用先へコピーせず、repository rootの`tools/CRDD-IR`
へGit submoduleとして配置する。

```powershell
git submodule add https://github.com/qual-lab/CRDD-IR.git tools/CRDD-IR
npm.cmd ci --prefix tools/CRDD-IR

.\tools\CRDD-IR\scripts\install-project.ps1 `
  -ProjectRoot . `
  -UnrealProject 40_Develop/MyGame/MyGame.uproject `
  -UnrealEngineRoot 'C:\Program Files\Epic Games\UE_5.8'
```

CRDD Markdownは適用先repositoryの`05_SPEC`を正本とする。Internal IRは
`.crdd-ir/`へ一時生成し、Git管理しない。生成コードと3D assetはtarget側の
配置方針に従い、検証要約は`07_Quality/CRDD_IR`へ保存する。

```powershell
.\tools\crdd-ir.ps1 check
.\tools\crdd-ir.ps1 generate
.\tools\crdd-ir.ps1 verify
```

Installerは`crdd-ir.config.json`と共通Wrapperを生成し、Codex向け
`AGENTS.md`、Claude Code向け`CLAUDE.md`、GitHub Copilot向け
`.github/copilot-instructions.md`へ`CRDD-IR:BEGIN/END`管理区間だけを
追加・更新する。既存のプロジェクト固有指示は保持する。

`-UnrealProject`を指定すると、適用先の`Plugins/CRDDIRIntegration`へ
Editor Plugin、`tools/crdd-import-generated-assets.py`へImport Harnessを
導入する。`verify`は設定された`.uproject`とEngine Rootを使い、Build、
Manifest駆動Import、Automation Test、Evidence生成まで実行する。

生成AssetをContractから削除した場合は、次回`generate`で不要なOBJ/MTLを、
次回`verify`で不要なUnreal StaticMesh、Material、Preview Map、Scene Actorを
生成管理範囲内に限定して削除する。

`30_IR`を恒久的な正本置場にはしない。必要ならCI Artifactの収集地点として
使えるが、Internal IR instanceは`.crdd-ir/`、追跡可能な実行証跡は
`07_Quality/CRDD_IR`へ分離する。
