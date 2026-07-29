# Unity integration

Unity AdapterはCRDD Structured Contractから、純粋C#のContract、製品Bridge、Unity Test
Framework向けNUnit fixtureを決定的に生成します。`MonoBehaviour`、`GameObject`、
`UnityEditor` APIは生成コードへ含めません。

## Generate

```powershell
node tools/CRDD-IR/src/cli.ts unity generate `
  05_SPEC/operations/create-entity.md `
  --profile Config/CRDD/unity-6-il2cpp.json `
  --out-dir Assets/CRDD/Generated
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

## Unity 6 verification

The repository includes a minimal Unity fixture and repeatable verification command:

```powershell
npm.cmd run verify:unity
```

It generates runtime and test assemblies separately, runs EditMode bridge/conformance
tests, and performs a Windows x64 IL2CPP Player build. Results and logs are written to
`.crdd-ir/unity-verification/`.

## Current verification boundary

Node側では決定性、型Projection、checked arithmetic、rollback、Bridge commit境界、
全Conformance fixture生成を検証します。実Unity Editor／IL2CPP Buildの検証には
Unity Editorをインストールし、BatchMode test/buildをCIへ接続する必要があります。
