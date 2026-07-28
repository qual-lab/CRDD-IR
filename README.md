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

Markdown内のYAML契約解析に`yaml`の固定バージョンを使用します。

## Quick start

```bash
npm run lint:ir
npm run check:source
npm run compile:source
npm run simulate -- --input examples/place-wall/success.input.json
npm run test:generate
npm run test:contract
npm run test:adapter
npm run test:process
npm run test:bundle
npm run generate:unreal
npm run generate:assets
npm run generate:evidence
npm run verify:unreal
npm test
```

生成物は既定で `generated/` に出力されます。

## CLI

```text
crdd-ir compile <spec.md> [--out <debug-ir.json>]
crdd-ir check <spec.md>
crdd-ir lint <ir.json>
crdd-ir simulate <ir.json> --input <input.json>
crdd-ir test generate <ir.json> [--out <file>]
crdd-ir test bundle <ir.json> [--out <file>]
crdd-ir test run <ir.json> [--adapter <module>]
crdd-ir test run <ir.json> --command <executable> [--arg <value>...]
crdd-ir generate unreal <ir.json> [--out-dir <directory>]
crdd-ir generate assets <ir.json> [--out-dir <directory>]
crdd-ir generate evidence <spec.md> [--out-dir <directory>] [--unreal-report <index.json>]
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

`.md`を指定した場合、CLIは`crdd-contract` Fenceを決定的にCompileしてから既存の検証・生成Pipelineへ渡します。Debug IRは`.crdd-ir/`などGit管理外の領域へ出力します。

Process AdapterのJSON仕様は [docs/process-adapter-protocol.md](docs/process-adapter-protocol.md) を参照してください。

## End-to-end Unreal verification

`npm run verify:unreal` executes CRDD validation, C++ generation, UE build,
Automation Test, and Evidence generation in one pipeline. Set
`CRDD_UNREAL_ROOT` when Unreal Engine is installed outside
`C:\Program Files\Epic Games\UE_5.8`.

GitHub Actions runs Node verification on a hosted runner. The Unreal job
requires a Windows self-hosted runner labeled `unreal-5.8` with UE 5.8 and
Visual Studio installed.

CRDD repositoryへのsubmodule導入方法は
[docs/crdd-integration.md](docs/crdd-integration.md)を参照する。

適用先には`tools/CRDD-IR`として任意導入し、Codex、Claude Code、
GitHub Copilotで共通の`tools/crdd-ir.ps1`を使用する。CRDD Coreには
Compilerを組み込まない。

## Design boundaries

- CRDD Markdownは人間向け記述と機械可読な構造化契約の正本
- CRDD IRはCompilerが一時生成するVersion付き内部表現
- 生成コードは一方向生成し、人間の実装は明示的な拡張点へ置く
- Unreal固有の操作感、描画、最適化はIRへ取り込まない

詳細は [docs/mvp.md](docs/mvp.md) を参照してください。
