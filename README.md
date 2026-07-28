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
npm run generate:unreal
npm test
```

生成物は既定で `generated/` に出力されます。

## CLI

```text
crdd-ir lint <ir.json>
crdd-ir simulate <ir.json> --input <input.json>
crdd-ir test generate <ir.json> [--out <file>]
crdd-ir generate unreal <ir.json> [--out-dir <directory>]
crdd-ir view trace <ir.json>
```

## Design boundaries

- CRDDは「なぜ」と「何を」の正本
- CRDD IRは振る舞い・制約・状態遷移の正本
- 生成コードは一方向生成し、人間の実装は明示的な拡張点へ置く
- Unreal固有の操作感、描画、最適化はIRへ取り込まない

詳細は [docs/mvp.md](docs/mvp.md) を参照してください。
