# PlaceWall MVP

## 検証仮説

CRDD Markdown内の構造化契約に事前条件、Effect、Error、Transaction、Trace IDを固定し、決定的にCRDD IRへCompileすると、実装を生成するAIやTargetが変わっても、必須の振る舞いと境界Testを安定して維持できる。

CRDD Markdownが正本であり、CRDD IRインスタンスはCompiler処理中またはDebug出力としてだけ存在する。IR SchemaはVersion管理するが、再生成可能なIRインスタンスを正本としてGit管理しない。

## v0.1の範囲

`PlaceWall` の次の意味だけを扱う。

- 数値入力と単位Metadata
- 事前条件
- 配列への追加と値の代入
- 原子的なState変更
- Error Code
- 境界Test Manifest
- Test Manifestの実行と契約判定
- Unreal C++骨格
- CRDD Requirement／Decisionとの対応

## CRDD Markdown Frontend

FrontendはMarkdown内の`crdd-contract` Fenceだけを解析する。周辺の自然言語や通常のYAML Fenceを推測で解釈しない。

```text
05_SPEC/01_Behavior_Specification.md
→ Source Contract
→ Expression AST
→ Canonical CRDD IR
→ Validator / Simulator / Conformance / Target Adapter
```

Expression Language v0.1はField Reference、単位付き数値、比較、加減算、Boolean演算、括弧だけを許可する。`eval`、任意関数、I/O、時刻、乱数、Target固有処理は許可しない。

同じSource Contractから生成したCanonical JSONのSHA-256 Digestが一致することを、決定性Testで確認する。

## v0.1の意味検証

Validatorは構造検証に加えて次を拒否する。

- Requirement／Effectからの未定義Input・State参照
- 異なる型・単位を持つField同士の比較
- 未定義Stateを変更するEffect
- 配列以外を対象とする `append`
- Targetと異なる型・単位を使用する代入
- 重複したRequirement ID／Error Code
- State変更を伴う非原子的Operation
- Rollback指定のないState変更

`crdd-ir test run` は生成済み、または実行時に生成したTest ManifestをSimulatorへ投入し、成功可否、Error Code、完全Rollbackを自動判定する。

`--adapter` を指定した場合は、外部実装の結果をReference Simulatorの意味と比較する。成功時の最終State、失敗時のError Code、Rollback、Trace IDを比較するため、Target実装におけるValidationやEffectの欠落を検出できる。

`--command` は同じ検査を任意言語の外部プロセスへ適用する。Protocolは1回の実行につき標準入力から1件のJSON Envelopeを受け取り、標準出力へ1件のResult JSONを返す。シェル実行は使用せず、既定5秒のTimeoutと1 MiBの出力上限を設ける。

`test bundle` は全ケースのRequestとReference Resultを `crdd-ir/conformance-v0.1` 形式で出力する。これはUnreal Automation Testなど、CRDD IR CLIを直接起動しないTarget側Testの入力として使用する。

## 意図的に扱わないもの

- 独自テキスト構文
- 任意コードの実行
- Round-trip同期
- Unrealの描画、入力、Actor Lifecycle
- 完全なC++コンパイル可能性
- 生成されたUnrealコードに対するContract Test実行
- 複数Target

## 成功判定

1. `0.299m` を拒否し、`0.300m` を受理できる
2. 予算不足時に壁と予算の双方が変更されない
3. 契約から上記Testを機械的に導出できる
4. 生成物からCRDD IDへ戻れる
5. Target固有実装を生成領域の外に維持できる

## 次の判断ゲート

MVPの比較実験後にのみ、次を判断する。

- JSONより人間向けの構文が必要か
- Schema Validatorを外部ライブラリへ置き換えるか
- Unreal Adapterをコンパイル可能なPluginへ拡張するか
- UI／Server／Game Dialectを分離するか
