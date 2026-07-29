# Unity integration

Unity AdapterはCRDD Structured Contractから、純粋C#のContract、製品Bridge、Unity Test
Framework向けNUnit fixtureを決定的に生成します。`MonoBehaviour`、`GameObject`、
`UnityEditor` APIは生成コードへ含めません。

## Generate

```powershell
node tools/CRDD-IR/src/cli.ts generate unity `
  05_SPEC/operations/create-entity.md `
  --profile Config/CRDD/unity-6-il2cpp.json `
  --out-dir .crdd-ir/unity-generated
```

複数Operationの場合:

```powershell
node tools/CRDD-IR/src/cli.ts batch unity `
  05_SPEC/operations/create-entity.md `
  05_SPEC/operations/update-entity.md `
  --profile Config/CRDD/unity-6-il2cpp.json `
  --out-dir Assets/CRDD/Generated `
  --flat
```

Operationごとに次を生成します。

- `<Operation>.Generated.cs`: Input、State、Error、純粋C# Operation
- `<Operation>.Bridge.Generated.cs`: DTOと`I<Operation>ProductAdapter`
- `<Operation>.Bridge.Generated.Tests.cs`: commit境界のNUnit test
- `<Operation>.Conformance.Generated.Tests.cs`: CRDDから導出した全ケース

CLIは4ファイルを同じ生成先へ出力します。Unity Projectへ取り込む際はRuntimeの
2ファイルとTestの2ファイルを次のように分離してください。

```text
Assets/CRDD/Runtime/Generated/
├─ <Operation>.Generated.cs
└─ <Operation>.Bridge.Generated.cs

Assets/CRDD/Tests/Generated/
├─ <Operation>.Bridge.Generated.Tests.cs
└─ <Operation>.Conformance.Generated.Tests.cs
```

## Product boundary

製品側は`I<Operation>ProductAdapter`を別ファイルで実装します。

- `TryBuildRequest`: UI／入力モデルからContract Inputへ変換
- `TryLoadSnapshot`: authoritativeなDomain状態を読み込む
- `TryCommitSnapshot`: `expectedRevision`を比較して原子的にcommit

Contract失敗時、revision overflow時、commit失敗時には元Snapshotを返します。
GameObjectやComponentはDomain状態のProjectionとして、commit後にMain Threadで反映します。

## Assembly layout

推奨構成:

```text
Assets/CRDD/
├─ Runtime/
│  ├─ Generated/
│  └─ ProductAdapters/
└─ Tests/
   └─ Generated/
```

Runtime asmdefはEditor assemblyを参照しないでください。生成testを含むasmdefでは
`optionalUnityReferences: ["TestAssemblies"]`を設定し、Runtime asmdefを参照します。

## AOT and threading

- Reflection、`dynamic`、runtime code generationを使わない
- IL2CPPで利用可能な明示型だけを生成する
- ContractとBridgeはUnity Objectへ触れないためworker threadでも実行可能
- GameObject／Asset／UIへの反映は製品AdapterからMain Threadへmarshalする
- AddressablesやResourcesの選択は製品側のAsset portへ閉じ込める

## Unity 6で検証する

リポジトリには最小Unity Fixtureと再実行可能な検証コマンドがあります。

```powershell
npm.cmd run verify:unity
```

このコマンドは生成コードをRuntime/Test assemblyへ分離し、EditModeのBridge／
Conformance TestとWindows x64 IL2CPP Player Buildを実行します。結果とログは
`.crdd-ir/unity-verification/`へ出力します。

検証済み環境:

- Unity `6000.5.5f1`
- Unity Personal
- Windows x64
- .NET Standard 2.1
- IL2CPP
- EditMode Test 11/11成功
- Windows x64 IL2CPP Player Build成功

## Current verification boundary

Node側では決定性、型Projection、checked arithmetic、rollback、Bridge commit境界、
全Conformance fixture生成を検証します。`verify:unity`はFixtureに対する実Unity
検証です。製品固有のGameObject Projection、Addressables、シーン、入力、描画、
プラットフォーム固有Playerは適用先Projectで追加検証してください。
