# PlaceWall MVP

## 検証仮説

CRDD IRに事前条件、Effect、Error、Transaction、Trace IDを固定すると、実装を生成するAIやTargetが変わっても、必須の振る舞いと境界Testを安定して維持できる。

## v0.1の範囲

`PlaceWall` の次の意味だけを扱う。

- 数値入力と単位Metadata
- 事前条件
- 配列への追加と値の代入
- 原子的なState変更
- Error Code
- 境界Test Manifest
- Unreal C++骨格
- CRDD Requirement／Decisionとの対応

## 意図的に扱わないもの

- 独自テキスト構文
- 任意コードの実行
- Round-trip同期
- Unrealの描画、入力、Actor Lifecycle
- 完全なC++コンパイル可能性
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
