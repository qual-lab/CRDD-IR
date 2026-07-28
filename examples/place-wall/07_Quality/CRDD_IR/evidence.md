# CRDD IR Conformance Evidence: PlaceWall

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/place-wall/05_SPEC/01_Behavior_Specification.md`
- Internal IR SHA-256: `0f25e83029412fcfc1d87daa4ecdec5713f20994f7b5a1385a931d7b0cafeb85`
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
| assets/assets.manifest.json | `85932c1f8d1c42ad56aca6742a7ed77e44b5d7848e161eee5b4800b7e32a56c1` |  |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `d5b4d4ef4cfccf176c8192a13eca3e09ad8c83388601fdc9c85bc988689fd525`
- Tests: CRDD.Assets.GeneratedMeshes, CRDD.Assets.GeneratedPreviewLevels, CRDD.PlaceWall.Conformance
