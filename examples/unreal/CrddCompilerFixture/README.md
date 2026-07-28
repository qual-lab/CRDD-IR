# CRDD Compiler Unreal Fixture

UE 5.8上でTarget Profile付き生成、UHT/UBT、Asset再ロード、Automation、
Shipping Cook/Packageを検証する、このCompiler自体の開発用Fixtureです。
Git Submodule利用者が適用先へコピーするProjectではありません。

## Inputs

- `../../../examples/create-entity/05_SPEC/01_Behavior_Specification.md`
- `../../../generated/create-entity.conformance.json`
- Protocol: `crdd-ir/conformance-v0.1`

## Generate

```powershell
node src/cli.ts unreal generate `
  examples/create-entity/05_SPEC/01_Behavior_Specification.md `
  --profile examples/unreal/profiles/ue-5.8-editor.json `
  --out-dir examples/unreal/CrddCompilerFixture/Source/CrddCompilerFixture/Generated
```

## Build

Repository rootで`npm run verify:unreal`を実行すると、生成、Build、
OBJから`/Game/CRDD/Generated/EntityPreview`へのStaticMesh Import、
`/Game/CRDD/Generated/EntityPreviewLevel`への永続配置、Automation Test、
Shipping Cook/Package、`07_Quality/CRDD_IR`のEvidence更新までを一括実行する。
Import対象は`generated/assets/assets.manifest.json`から読み取るため、
CRDD ContractへAssetを追加してもPython Scriptの固定名変更は不要。
また、全AssetをContract指定のTransformで
`/Game/CRDD/Generated/CreateEntityScene`へまとめて配置する。

```powershell
& 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat' `
  CrddCompilerFixtureEditor `
  Win64 `
  Development `
  "$PWD\examples\unreal\CrddCompilerFixture\CrddCompilerFixture.uproject" `
  -WaitMutex `
  -NoHotReload
```

## Run the Automation Test

```powershell
& 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe' `
  "$PWD\examples\unreal\CrddCompilerFixture\CrddCompilerFixture.uproject" `
  -ExecCmds='Automation RunTests CRDD.CreateEntity.Conformance' `
  -TestExit='Automation Test Queue Empty' `
  -unattended `
  -nop4 `
  -NullRHI `
  -nosplash `
  -NoSound `
  -ReportExportPath="$PWD\examples\unreal\CrddCompilerFixture\Saved\TestReports" `
  -log
```

成功時、Logに次が記録される。

```text
Test Completed. Result={Success}
Path={CRDD.CreateEntity.Conformance}
```

`Binaries`、`Intermediate`、`Saved`等は再生成可能なためGit管理しない。
