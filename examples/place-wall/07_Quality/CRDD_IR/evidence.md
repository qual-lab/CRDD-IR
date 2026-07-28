# CRDD IR Conformance Evidence: PlaceWall

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/place-wall/05_SPEC/01_Behavior_Specification.md`
- Internal IR SHA-256: `00690fa3748b550856e6dfba843415ff55599a49de9a38c75178e9f3afc6c2bf`
- Conformance Bundle SHA-256: `def53a693f5af925966c530a1d5684a34448bca0c5a19b1075af45060607e3c1`
- Conformance Cases: 5
- Requirement Failure Coverage: 2/2 (100%)
- Mutation Score: 6/6 (100%)

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
| assets/assets.manifest.json | `c370c9edd0299dc7ba1109a41f61f6edf83026f3fcead702cc84daea8f4fdd7f` |  |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `b8febbf362ce8ae49d91bd694784ab584d767986e09ff48741de2e704e611c87`
- Tests: CRDD.Assets.GeneratedMeshes, CRDD.Assets.GeneratedPreviewLevels, CRDD.Assets.GeneratedScene, CRDD.PlaceWall.Conformance
