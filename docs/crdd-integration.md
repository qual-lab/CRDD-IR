# Git Submodule導入・運用ガイド

このガイドは、CRDD適用先リポジトリへCRDD IRを
`tools/CRDD-IR`として導入する担当者向けです。

## 1. 導入前に決めること

次のパスを適用先の構成に合わせて決めます。

| 対象 | 推奨例 | Git管理 |
|---|---|---|
| CRDD Markdown | `05_SPEC/operations/*.md` | する・正本 |
| Compiler Submodule | `tools/CRDD-IR` | pointerを管理 |
| Unreal生成C++ | `40_Develop/MyGame/Source/MyGame/Generated` | Target方針による |
| 3D source asset | `40_Develop/Generated/Assets` | Target方針による |
| 検証Evidence | `07_Quality/CRDD_IR` | する |
| Internal IR/cache/package | `.crdd-ir` | しない |

生成C++の出力先は、`.uproject`があるディレクトリではなく、コンパイル対象Module
の`Source/<Module>/Generated`を指定します。

複数Operationを使う場合、`-Source`へすべて列挙します。3D Asset集合を定義する
Contractは`-AssetSource`で1件に固定します。

## 2. Submoduleを追加する

適用先リポジトリのルートで実行します。

```powershell
git submodule add https://github.com/qual-lab/CRDD-IR.git tools/CRDD-IR
npm.cmd ci --prefix tools/CRDD-IR
```

Submodule追加によって、適用先には`.gitmodules`とSubmodule commit pointerが
記録されます。チーム全体が同じCompiler versionを使えるため、Submodule内で
任意に`pull`した状態を放置せず、適用先側へpointerをコミットします。

## 3. 適用先を初期化する

```powershell
.\tools\CRDD-IR\scripts\install-project.ps1 `
  -ProjectRoot . `
  -Source @(
    "05_SPEC/operations/create-entity.md",
    "05_SPEC/operations/update-entity.md"
  ) `
  -AssetSource "05_SPEC/operations/create-entity.md" `
  -GeneratedSource "40_Develop/MyGame/Source/MyGame/Generated" `
  -GeneratedAssets "40_Develop/Generated/Assets" `
  -Evidence "07_Quality/CRDD_IR" `
  -UnrealProject "40_Develop/MyGame/MyGame.uproject" `
  -UnrealEngineRoot "C:/Program Files/Epic Games/UE_5.8" `
  -UnrealEditorTarget "MyGameEditor" `
  -UnrealGameTarget "MyGame"
```

Target名を省略した場合、Editorは`<ProjectName>Editor`、Gameは
`<ProjectName>`を使用します。

Installerが所有するもの:

- `crdd-ir.config.json`
- `tools/crdd-ir.ps1`
- `.crdd-ir.install.json`
- `Config/CRDD/ue-5.8-editor.json`
- `Config/CRDD/ue-5.8-shipping.json`
- `Plugins/CRDDIRIntegration`
- `tools/crdd-import-generated-assets.py`
- `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`内の管理区間

既存のAI向け指示は保持されます。管理対象が手で変更されている場合、再導入は
`.crdd-ir/backups/`へバックアップして停止します。

## 4. 生成前に設定を確認する

生成された`crdd-ir.config.json`は適用先固有の正本です。

```json
{
  "protocol": "crdd-ir/project-config-v0.1",
  "toolRoot": "tools/CRDD-IR",
  "source": [
    "05_SPEC/operations/create-entity.md",
    "05_SPEC/operations/update-entity.md"
  ],
  "assetSource": "05_SPEC/operations/create-entity.md",
  "generatedSource": "40_Develop/MyGame/Source/MyGame/Generated",
  "generatedAssets": "40_Develop/Generated/Assets",
  "evidence": "07_Quality/CRDD_IR",
  "unreal": {
    "project": "40_Develop/MyGame/MyGame.uproject",
    "engineRoot": "C:/Program Files/Epic Games/UE_5.8",
    "editorTarget": "MyGameEditor",
    "gameTarget": "MyGame",
    "configuration": "Development",
    "integrationPlugin": "CRDDIRIntegration",
    "editorProfile": "Config/CRDD/ue-5.8-editor.json",
    "shippingProfile": "Config/CRDD/ue-5.8-shipping.json"
  }
}
```

設定後に診断します。

```powershell
.\tools\crdd-ir.ps1 doctor
```

`doctor`はSubmodule、設定Schema、入力Contract、出力先の重複・書込権限、
Installer所有hash、`.uproject`、Engine、Build tool、Plugin前提条件を確認
します。最初から`verify`を実行するより、まず`doctor`で環境問題を除く方が速く
原因を特定できます。

## 5. 日常の開発フロー

CRDD Markdownを編集した後:

```powershell
.\tools\crdd-ir.ps1 check
.\tools\crdd-ir.ps1 generate
```

レビューまたは本番適用前:

```powershell
.\tools\crdd-ir.ps1 verify
```

`verify`は次の順に実行します。

1. CRDD Contractと生成Conformance Caseを検証
2. Target ProfileからVersion付きUnreal Target Planを構築
3. C++と3D Assetを生成
4. Editor TargetをUHT/UBTでBuild
5. Assetをimportし、保存後のpackageを再ロードして検証
6. Unreal Automation Testを実行
7. Game TargetをShipping Build
8. MapとAssetをCookし、Pak/IoStore packageを作成
9. Traceability、Automation要約、Package hashをEvidenceへ保存

Editorで成功してもShipping依存グラフやCookで失敗する可能性があるため、
`verify`はEditor Buildだけでは完了扱いにしません。

## 6. Gitへ含めるもの

少なくとも次をコミットします。

```text
.gitmodules
tools/CRDD-IR
crdd-ir.config.json
.crdd-ir.install.json
tools/crdd-ir.ps1
Config/CRDD/
Plugins/CRDDIRIntegration/
AGENTS.md
CLAUDE.md
.github/copilot-instructions.md
07_Quality/CRDD_IR/
```

生成C++と生成3D source assetをコミットするかはTarget repositoryの方針で
決めます。ただし、どちらの場合もCIで`generate`後に差分がないことを確認すると
生成忘れを検出できます。

`.crdd-ir/`はcache、raw report、backup、Shipping packageを含むため、
Git管理しません。`30_IR`もInternal IR instanceの恒久置場にはしません。

## 7. Clone・CI

新しい開発環境:

```powershell
git clone --recurse-submodules <app-repository-url>
cd <app-repository>
npm.cmd ci --prefix tools/CRDD-IR
.\tools\crdd-ir.ps1 doctor
```

通常Clone済みの場合:

```powershell
git submodule update --init --recursive
npm.cmd ci --prefix tools/CRDD-IR
```

CIでも必ずSubmoduleをcheckoutし、Node依存関係を`npm ci`で復元します。
Unreal検証にはUE 5.8とVisual Studioを持つWindows runnerが必要です。

## 8. Compilerを更新する

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

Target ProfileやPlugin templateが変わるため、Submodule pointerだけを更新せず、
必ず`repair-project.ps1`を実行します。管理対象へ利用者の変更があればbackup後に
明示的な確認を要求します。

## 9. よくある問題

### `tools/CRDD-IR`が空

```powershell
git submodule update --init --recursive
```

### `Cannot find module`または`yaml`が見つからない

```powershell
npm.cmd ci --prefix tools/CRDD-IR
```

### 生成先がUnreal Buildへ入らない

`generatedSource`が`.uproject`配下の実際の
`Source/<RuntimeModule>/Generated`を指しているか確認します。

### 編集した生成物を上書きできない

生成物は所有hashで保護されています。必要な変更をCRDDまたはTarget Adapterへ
移し、再生成してください。生成物を意図的に破棄できる場合のみ`--force`を使います。

### Installer管理ファイルを変更してしまった

```powershell
.\tools\CRDD-IR\scripts\repair-project.ps1 -ProjectRoot .
```

変更内容は`.crdd-ir/backups/`へ退避されます。

### UnrealのエラーをCI向けに正規化したい

```powershell
node tools/CRDD-IR/src/cli.ts unreal diagnostics Saved/Logs/MyGame.log
```

Compiler、UHT、UBT、Cook、Automationの診断を、ローカル絶対パスを除いた安定形式
へ変換します。

## 10. 削除する

まず変更対象を確認します。

```powershell
.\tools\CRDD-IR\scripts\uninstall-project.ps1 -ProjectRoot . -WhatIf
.\tools\CRDD-IR\scripts\uninstall-project.ps1 -ProjectRoot .
```

Uninstallerはmanifest所有ファイルと管理区間だけを削除します。変更済み管理対象は
backupし、`-ForceManagedRemoval`を指定するまで削除しません。その後、必要なら
適用先側でSubmoduleを削除します。

## Unreal境界の要点

- `CRDDIRRuntime`は`Core`、`CoreUObject`、`Engine`だけに依存
- `CRDDIRIntegration`へEditor importとAutomationを隔離
- 非同期処理は純粋データだけをworkerへ渡し、UObject反映はGame Threadで行う
- cooperative cancellation、weak owner、revision gateで古い結果を破棄
- Asset Managerと明示Cook ruleでShipping到達性を検証
- Configは`CRDD-IR:<owner>:BEGIN/END`区間だけを所有
- 保存は容量制限、非同期、atomic replacement、project提供transform境界を使用
- ActorはDomain stateの投影であり正本にしない
- Target Profile違反はC++生成前に停止する
