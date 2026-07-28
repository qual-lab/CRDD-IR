# CRDD Compiler Unreal Fixture

UE 5.8上で、CRDD Markdownから生成した`PlaceWall` C++実装へConformance Bundleを適用する最小検証Project。

## Inputs

- `../../../examples/place-wall/05_SPEC/01_Behavior_Specification.md`
- `../../../generated/place-wall.conformance.json`
- Protocol: `crdd-ir/conformance-v0.1`

## Generate

```powershell
node src/cli.ts generate unreal `
  examples/place-wall/05_SPEC/01_Behavior_Specification.md `
  --out-dir examples/unreal/CrddCompilerFixture/Source/CrddCompilerFixture/Generated
```

## Build

Repository rootで`npm run verify:unreal`を実行すると、生成、Build、
OBJから`/Game/CRDD/Generated/WallPreview`へのStaticMesh Import、
`/Game/CRDD/Generated/WallPreviewLevel`への永続配置、Automation Test、
`07_Quality/CRDD_IR`のEvidence更新までを一括実行する。

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
  -ExecCmds='Automation RunTests CRDD.PlaceWall.Conformance' `
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
Path={CRDD.PlaceWall.Conformance}
```

`Binaries`、`Intermediate`、`Saved`等は再生成可能なためGit管理しない。
