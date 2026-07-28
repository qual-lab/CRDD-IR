# CRDD IR

CRDDに記録された要求・判断を、検証可能な振る舞いの契約として実装へ接続するための実証プロジェクトです。

現在のMVPは注文住宅ゲームの `PlaceWall` Operationに限定し、次を提供します。

- IRの構造・意味検証
- Operationの原子的なSimulation
- 境界値・Rollback用Test Manifest生成
- Unreal C++とAutomation Testの骨格生成
- CRDD IDとのTraceability

## Requirements

- Node.js 22.18以降

外部npmパッケージは使用していません。

## Quick start

```bash
npm run lint:ir
npm run simulate -- --input examples/place-wall/success.input.json
npm run test:generate
npm run test:contract
npm run test:adapter
npm run test:process
npm run test:bundle
npm run generate:unreal
npm test
```

生成物は既定で `generated/` に出力されます。

## CLI

```text
crdd-ir lint <ir.json>
crdd-ir simulate <ir.json> --input <input.json>
crdd-ir test generate <ir.json> [--out <file>]
crdd-ir test bundle <ir.json> [--out <file>]
crdd-ir test run <ir.json> [--adapter <module>]
crdd-ir test run <ir.json> --command <executable> [--arg <value>...]
crdd-ir generate unreal <ir.json> [--out-dir <directory>]
crdd-ir view trace <ir.json>
```

`--adapter` を指定すると、Reference Simulatorではなく外部実装へ同じContract Testを適用できます。

```bash
crdd-ir test run examples/place-wall/place-wall.ir.json \
  --adapter examples/place-wall/adapters/correct.adapter.ts
```

言語非依存の実装は、JSONを標準入力で受け取り結果を標準出力へ返すProcess Adapterとして接続できます。コマンドはシェルを介さず起動されます。

```bash
crdd-ir test run examples/place-wall/place-wall.ir.json \
  --command node \
  --arg examples/place-wall/adapters/process-correct.ts
```

`test bundle` は、UnrealなどTarget側のテストから直接読み込める入力・期待結果を単一JSONへ出力します。

Process AdapterのJSON仕様は [docs/process-adapter-protocol.md](docs/process-adapter-protocol.md) を参照してください。

## Design boundaries

- CRDDは「なぜ」と「何を」の正本
- CRDD IRは振る舞い・制約・状態遷移の正本
- 生成コードは一方向生成し、人間の実装は明示的な拡張点へ置く
- Unreal固有の操作感、描画、最適化はIRへ取り込まない

詳細は [docs/mvp.md](docs/mvp.md) を参照してください。
