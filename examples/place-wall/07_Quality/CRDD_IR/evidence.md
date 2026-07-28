# CRDD IR Conformance Evidence: PlaceWall

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/place-wall/05_SPEC/01_Behavior_Specification.md`
- Internal IR SHA-256: `756eaa1f50d11d8a6293e35403399698b13b5e7015e56ee033aaab720c03852a`
- Conformance Bundle SHA-256: `def53a693f5af925966c530a1d5684a34448bca0c5a19b1075af45060607e3c1`
- Conformance Cases: 5

## Requirement Coverage

| Requirement | Error | CRDD IDs | Test Cases |
| --- | --- | --- | --- |
| minimum-wall-length | WALL_TOO_SHORT | REQ-WALL-001 | minimum-wall-length-at-boundary, minimum-wall-length-below-boundary |
| sufficient-budget | INSUFFICIENT_BUDGET | DEC-WALL-003 | sufficient-budget-exact, sufficient-budget-insufficient |

## Generated Artifacts

| Artifact | SHA-256 | CRDD IDs |
| --- | --- | --- |
| unreal/PlaceWall.generated.h | `1758106f98246e1f645f829ff01d342fdf3c4961cddbfbb59971acb4efcad0d9` | REQ-WALL-001, DEC-WALL-003 |
| unreal/PlaceWall.generated.cpp | `d78e9c18758b43dc34e6d84b4105f33d109353d1eeb62ad77974603ba543a51f` | REQ-WALL-001, DEC-WALL-003 |
| assets/WallPreview.generated.obj | `1aa038429906fc0e614a0c625033686f35f19b9cf47426e90eae2ba122e3c752` | REQ-WALL-001 |
| assets/WallPreview.generated.mtl | `1607240ad13b4560495b8b431245f3bdb8ff49a88f924a0cc1a9d94b623d9e30` | REQ-WALL-001 |
| assets/DoorPreview.generated.obj | `dd2c06a1b7b6a474ad3e980f25bb546bfb2f18e2587c0c6673395daaef8eb783` | REQ-WALL-001 |
| assets/DoorPreview.generated.mtl | `4fa40f4b4d053a8507b8e3c73b5b23301659db67124d36a72b776707e21c9cfa` | REQ-WALL-001 |
| assets/assets.manifest.json | `2028eb491bfaeaec08eef9e36d5e5aa50567319194b6a75b291fe353484ca5ec` |  |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `e4f9e6f066a2d6543eb6abb9f85e740d75e65b22d200b60d5a3de3411561e2fc`
- Tests: CRDD.Assets.GeneratedMeshes, CRDD.Assets.GeneratedPreviewLevels, CRDD.Assets.GeneratedScene, CRDD.PlaceWall.Conformance
