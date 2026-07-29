# Unreal product bridge

`generate unreal` と一括生成は、Operationごとに次のBridge成果物も生成します。

- `<Operation>.bridge.generated.h`: DTO、失敗分類、Product Adapter port
- `<Operation>.bridge.generated.cpp`: Contract実行とSnapshot commitの制御
- `<Operation>.bridge.generated.spec.cpp`: 失敗時にcommitしないことを確認するUE Automation

Bridgeは生成Contractと製品コードの境界です。Actor生成、World更新、Asset解決、表示用の
Projectionは生成しません。これらは製品側のAdapterが所有します。

## 実装するport

製品側は、生成された`ICrdd<Operation>ProductAdapter`を実装します。

```cpp
class FMyOperationAdapter final : public ICrddMyOperationProductAdapter
{
public:
    bool BuildRequest(
        FCrddMyOperationBridgeRequestDto& OutRequest,
        FString& OutDiagnostic
    ) override;

    bool LoadSnapshot(
        FCrddMyOperationBridgeSnapshotDto& OutSnapshot,
        FString& OutDiagnostic
    ) override;

    bool CommitSnapshot(
        const FCrddMyOperationBridgeSnapshotDto& Candidate,
        uint64 ExpectedRevision,
        FString& OutDiagnostic
    ) override;
};
```

- `BuildRequest`: 製品入力を型付きContract入力へ変換する
- `LoadSnapshot`: authoritativeな製品状態を読み、Contract Snapshotへ変換する
- `CommitSnapshot`: `ExpectedRevision`を比較し、Candidateを原子的に公開する

`CommitSnapshot`は永続化とWorld Projectionを同じ非原子的処理にまとめるためのAPIでは
ありません。まずauthoritative stateを原子的に確定し、Actorや表示は製品側のProjection
規約に従って反映してください。

## 保証する境界

Bridgeは次を決定的に行います。

1. Requestを構築する
2. 元Snapshotとrevisionを取得する
3. 生成Contractを実行する
4. 成功時のみrevisionを増やして`CommitSnapshot`を呼ぶ

Request変換、Snapshot取得、Contract、revision、commitのいずれかが失敗した場合、
戻り値のSnapshotは取得済みの元Snapshotから変更されません。Contract Error Code、
Requirement ID、Trace IDは`BridgeErrorDto`へ保持されます。

プロセス間・サーバー間の同時更新を安全にする責務は、製品側の`CommitSnapshot`に
あります。`ExpectedRevision`不一致時はcommitせず`false`を返してください。
