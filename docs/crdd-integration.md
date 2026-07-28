# CRDD Repository Integration

CRDD IR本体はCRDD適用先へコピーせず、repository rootの`plugins/CRDD-IR`
へGit submoduleとして配置する。

```powershell
git submodule add https://github.com/qual-lab/CRDD-IR.git plugins/CRDD-IR
npm.cmd ci --prefix plugins/CRDD-IR
```

CRDD Markdownは適用先repositoryの`05_SPEC`を正本とする。Internal IRは
`.crdd-ir/`へ一時生成し、Git管理しない。生成コードと3D assetはtarget側の
配置方針に従い、検証要約は`07_Quality/CRDD_IR`へ保存する。

```powershell
node plugins/CRDD-IR/src/cli.ts check `
  05_SPEC/01_Behavior_Specification.md

node plugins/CRDD-IR/src/cli.ts generate unreal `
  05_SPEC/01_Behavior_Specification.md `
  --out-dir Source/MyGame/Generated

node plugins/CRDD-IR/src/cli.ts generate assets `
  05_SPEC/01_Behavior_Specification.md `
  --out-dir Content/CRDD/SourceAssets
```

`30_IR`を恒久的な正本置場にはしない。必要ならCI Artifactの収集地点として
使えるが、Internal IR instanceは`.crdd-ir/`、追跡可能な実行証跡は
`07_Quality/CRDD_IR`へ分離する。
