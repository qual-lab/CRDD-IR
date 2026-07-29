# CRDD IR

CRDD Markdownに記録した構造化契約を検証し、Unreal C++、3D Asset、
Conformance Test、Traceability Evidenceへ決定的に変換するCompilerです。

通常はCRDD適用先リポジトリの`tools/CRDD-IR`へGit Submoduleとして導入します。
CRDD Coreへ組み込む必要はありません。

## 適用先へ導入する

前提:

- Windows PowerShell
- Node.js 22.18以降
- Unreal連携を使う場合はUnreal Engine 5.8とVisual Studio 2022
- 適用先リポジトリにCRDD Markdownと`.uproject`が存在すること

適用先リポジトリのルートで実行します。

```powershell
git submodule add https://github.com/qual-lab/CRDD-IR.git tools/CRDD-IR
npm.cmd ci --prefix tools/CRDD-IR

.\tools\CRDD-IR\scripts\install-project.ps1 `
  -ProjectRoot . `
  -Source @(
    "05_SPEC/operations/create-entity.md",
    "05_SPEC/operations/update-entity.md"
  ) `
  -AssetSource "05_SPEC/operations/create-entity.md" `
  -GeneratedSource "40_Develop/MyGame/Source/MyGame/Generated" `
  -GeneratedAssets "40_Develop/Generated/Assets" `
  -UnrealProject "40_Develop/MyGame/MyGame.uproject" `
  -UnrealEngineRoot "C:/Program Files/Epic Games/UE_5.8"
```

`-Source`が1件なら`-AssetSource`は省略できます。Unrealを使わない場合は
`-UnrealProject`と`-UnrealEngineRoot`を省略します。

Installerは次を適用先へ追加します。

- `crdd-ir.config.json`: 適用先固有のパスとUnreal設定
- `tools/crdd-ir.ps1`: 日常操作用Wrapper
- `Config/CRDD/*.json`: Editor/Shipping Target Profile
- `Plugins/CRDDIRIntegration`: Runtime/Editor分離済みUnreal Plugin
- Codex、Claude Code、GitHub Copilot向けの管理区間

既存ファイル全体は所有せず、管理ファイルまたは
`CRDD-IR:BEGIN/END`区間だけを更新します。

## 最初の確認

```powershell
.\tools\crdd-ir.ps1 doctor
.\tools\crdd-ir.ps1 check
.\tools\crdd-ir.ps1 generate
```

- `doctor`: 設定、Submodule、入力、出力先、Unreal前提条件を事前診断
- `check`: CRDD Structured Contractを検証
- `generate`: Unreal C++と3D Assetを再生成
- `verify`: 上記に加えてContract Test、UE Build、Asset import、
  Automation、Shipping Cook/Package、Evidence生成を実行

本番適用前またはCIでは次を実行します。

```powershell
.\tools\crdd-ir.ps1 verify
```

中間IR、ログ、Packageは`.crdd-ir/`へ置かれ、Git管理しません。
追跡可能な検証要約は`07_Quality/CRDD_IR/`へ生成されます。

## チームメンバーがCloneする

```powershell
git clone --recurse-submodules <app-repository-url>
cd <app-repository>
npm.cmd ci --prefix tools/CRDD-IR
.\tools\crdd-ir.ps1 doctor
```

すでに通常Cloneした場合:

```powershell
git submodule update --init --recursive
npm.cmd ci --prefix tools/CRDD-IR
```

## CRDD IRを更新する

Submoduleは適用先が検証済みcommitを固定します。自動的に最新版へ追従させず、
更新後に`doctor`と`verify`を通してから適用先側でpointerをコミットしてください。

```powershell
git -C tools/CRDD-IR fetch origin
git -C tools/CRDD-IR checkout <tested-commit-or-tag>
npm.cmd ci --prefix tools/CRDD-IR

.\tools\CRDD-IR\scripts\repair-project.ps1 -ProjectRoot .
.\tools\crdd-ir.ps1 doctor
.\tools\crdd-ir.ps1 verify

git status --short
git add -A
git commit -m "Update CRDD IR"
```

`repair-project.ps1`は現在の設定を使って管理ファイルとPluginを更新します。
変更済みの管理対象を上書きする前に`.crdd-ir/backups/`へ退避します。

## 生成物を手で編集しない

生成ファイルには所有manifestとSHA-256があります。編集済み生成物は、
明示的な`--force`なしでは上書きしません。製品固有ロジックは生成コードではなく、
生成物を呼び出すAdapter、Subsystem、Componentなどへ実装してください。

CRDD Markdownが正本です。Internal IR instanceを`30_IR`などへ恒久保存する必要は
ありません。

## 詳細

- [Git Submodule導入・運用ガイド](docs/crdd-integration.md)
- [対応範囲と設計境界](docs/mvp.md)
- [Process Adapter Protocol](docs/process-adapter-protocol.md)
- [Unreal fixture](examples/unreal/CrddCompilerFixture/README.md)

## このリポジトリを開発する

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:installer
npm.cmd run verify:unreal
```

`verify:unreal`はUE 5.8のUHT、Editor Build、Automation、Shipping Build、
Cook、Pak/IoStore、Evidence生成まで実行します。既定以外へUEをインストールした
場合は`CRDD_UNREAL_ROOT`を設定してください。

## 設計境界

- CRDD Markdownが人間向け記述と機械可読契約の正本
- CRDD IRはCompiler内部のVersion付き一時表現
- Target ProfileがEngine、Module、UHT、GC、Thread、Cook、Shipping条件を固定
- Conformance基準入力は全Requiresを満たし、各反例は対象Requiresだけを破る
- 任意の生成先で成立する相対includeと、出力／Project単位のプロセス間lockを使用
- Target Profileで`mm`などのC++型、JSON表現、丸め、overflow方針を固定
- 整数Requiresの加減算はchecked arithmeticで生成し、decimal-stringの境界をUE Automationで検証
- Numeric Boundary Automation FixtureもTarget Profileから生成し、生成manifestでownershipとhashを管理
- 生成は一方向で、製品固有の操作感・描画・最適化はTarget側が所有
- AIは候補作成を支援できるが、未確定情報をCompilerが推測して補完しない
