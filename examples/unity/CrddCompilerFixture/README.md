# CRDD Compiler Unity Fixture

This minimal Unity 6 project verifies generated CRDD contracts independently of a product
project.

From the repository root:

```powershell
npm.cmd run verify:unity
```

The verification:

1. generates the Unity target from `test/fixtures/create-wall.md`;
2. separates runtime and generated test assemblies;
3. runs all EditMode bridge and conformance tests;
4. builds a Windows x64 IL2CPP Player;
5. verifies the NUnit XML result and Unity build success marker.

Local derived files, logs, test results, and Player builds are written below `.crdd-ir/`
or Unity's ignored `Library`, `Logs`, and `Temp` directories.

Override paths when needed:

```powershell
.\scripts\verify-unity.ps1 `
  -UnityEditor "C:\Program Files\Unity\Hub\Editor\6000.5.5f1\Editor\Unity.exe" `
  -Project "C:\path\to\fixture" `
  -Source "C:\path\to\operation.md" `
  -Profile "C:\path\to\unity-profile.json"
```
