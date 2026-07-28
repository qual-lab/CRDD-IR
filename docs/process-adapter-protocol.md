# CRDD IR Process Adapter Protocol v0.1

言語やRuntimeに依存せず、Target実装へContract Testを適用するための最小Protocol。

## Invocation

RunnerはContract Caseごとに新しいProcessを起動する。シェルは使用しない。

- Request: 標準入力へUTF-8 JSONを1件
- Response: 標準出力へUTF-8 JSONを1件
- 診断: 標準エラー出力
- 正常終了: Exit Code `0`
- 異常終了: `0`以外
- 既定Timeout: 5秒
- 標準出力上限: 1 MiB

## Request

```json
{
  "protocol": "crdd-ir/adapter-v0.1",
  "operation": "PlaceWall",
  "request": {
    "input": {
      "length": 0.3,
      "cost": 12000
    },
    "state": {
      "budget": {
        "remaining": 50000
      },
      "walls": []
    }
  }
}
```

## Success Response

```json
{
  "ok": true,
  "operation": "PlaceWall",
  "state": {
    "budget": {
      "remaining": 38000
    },
    "walls": [
      {
        "length": 0.3,
        "cost": 12000
      }
    ]
  },
  "traces": [
    "REQ-WALL-001",
    "DEC-WALL-003"
  ]
}
```

## Failure Response

```json
{
  "ok": false,
  "operation": "PlaceWall",
  "error": "WALL_TOO_SHORT",
  "failedRequirement": "minimum-wall-length",
  "state": {
    "budget": {
      "remaining": 50000
    },
    "walls": []
  },
  "traces": [
    "REQ-WALL-001"
  ]
}
```

Failureでは、原子的Operationの完全Rollback後Stateを返す。

## Conformance Bundle

`crdd-ir test bundle` はProcessを起動できないTarget向けに、全RequestとReference Resultを単一JSONへ出力する。形式は [conformance-bundle.schema.json](../schemas/conformance-bundle.schema.json) で定義する。
