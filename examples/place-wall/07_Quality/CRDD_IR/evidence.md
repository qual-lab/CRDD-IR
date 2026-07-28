# CRDD IR Conformance Evidence: PlaceWall

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/place-wall/05_SPEC/01_Behavior_Specification.md`
- Internal IR SHA-256: `1fc7e43e67b3c08e3c047f18b0707ce705e3eca9dfd4ff5c7380a7e9bb9ae9cd`
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
| assets/WallPreview.generated.obj | `ca616a4b3feb411aaecffc574a99f8384e3a6e7e6a87b19a9c5f0244f1de9684` | REQ-WALL-001 |
| assets/WallPreview.generated.mtl | `1607240ad13b4560495b8b431245f3bdb8ff49a88f924a0cc1a9d94b623d9e30` | REQ-WALL-001 |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `200414224d6b13b2baea517e002ac4a3bc43a6d437cf36144ec88e96202fa474`
- Tests: CRDD.PlaceWall.Conformance
