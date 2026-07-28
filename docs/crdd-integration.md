# CRDD Repository Integration

CRDD IR本体はCRDD適用先へコピーせず、repository rootの`tools/CRDD-IR`
へGit submoduleとして配置する。

```powershell
git submodule add https://github.com/qual-lab/CRDD-IR.git tools/CRDD-IR
npm.cmd ci --prefix tools/CRDD-IR

.\tools\CRDD-IR\scripts\install-project.ps1 -ProjectRoot .
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

`30_IR`を恒久的な正本置場にはしない。必要ならCI Artifactの収集地点として
使えるが、Internal IR instanceは`.crdd-ir/`、追跡可能な実行証跡は
`07_Quality/CRDD_IR`へ分離する。
