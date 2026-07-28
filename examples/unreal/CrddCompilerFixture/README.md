# CRDD Compiler Unreal Fixture

UE 5.8上の`PlaceWall` C++実装へ、CRDD Compilerが生成したConformance Bundleを適用する最小検証Project。

## Inputs

- `../../../generated/place-wall.conformance.json`
- Protocol: `crdd-ir/conformance-v0.1`

## Build

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
