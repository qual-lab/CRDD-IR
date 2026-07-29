# CRDD IR Conformance Evidence: CreateEntity

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/create-entity/05_SPEC/01_Behavior_Specification.md`
- Internal IR SHA-256: `958fe9983be73621981e4aada20961d69c42b7d79ed5d8e199338d819d181b26`
- Conformance Bundle SHA-256: `fae4e3882c30f88222e4c1976bff9d1920c7ad9a3063e1a1e68d34f7a529ee1c`
- Conformance Cases: 5
- Requirement Failure Coverage: 2/2 (100%)
- Mutation Score: 6/6 (100%)

## Requirement Coverage

| Requirement | Error | CRDD IDs | Test Cases |
| --- | --- | --- | --- |
| minimum-entity-length | ENTITY_TOO_SHORT | REQ-ENTITY-001 | minimum-entity-length-at-boundary, minimum-entity-length-below-boundary |
| sufficient-budget | INSUFFICIENT_BUDGET | DEC-ENTITY-003 | sufficient-budget-exact, sufficient-budget-insufficient |

## Generated Artifacts

| Artifact | SHA-256 | CRDD IDs |
| --- | --- | --- |
| unreal/CreateEntity.generated.h | `3877104986613e3236836d6e3b1381463d8942fcbf6b526fbc348c5efa8e2ca7` | REQ-ENTITY-001, DEC-ENTITY-003 |
| unreal/CreateEntity.generated.cpp | `cca122e2679818fcd4d41d3faf32547306c560d1dd9d79611ee4fdb0177650b2` | REQ-ENTITY-001, DEC-ENTITY-003 |
| assets/EntityPreview.generated.obj | `a8cbc7e791cef05227bae119f4e561af4747f8740f75586778871c7978718f7a` | REQ-ENTITY-001 |
| assets/EntityPreview.generated.mtl | `75fd255dfafcf433ffe9555e602569be2dbed9dff76c90badd9d8dc492909792` | REQ-ENTITY-001 |
| assets/SecondaryPreview.generated.obj | `d186e821dffacccb1a1ca8db42c95faf20f1ce868d631ca2399d93af0b079023` | REQ-ENTITY-001 |
| assets/SecondaryPreview.generated.mtl | `8ce01a862f958517dde3d50e4cb855cefad9fc75c1f23a31670746f4d493732f` | REQ-ENTITY-001 |
| assets/assets.manifest.json | `20005ccf92c91efddcf4dc62c3e6417f0039e35e9fc8c41b217089ff86b11f3a` |  |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `7f39d3fece77dd4e279a4f49bcc907023ac71368e23247f5c9666497e5870545`
- Tests: CRDD.Assets.GeneratedMeshes, CRDD.Assets.GeneratedPreviewLevels, CRDD.Assets.GeneratedScene, CRDD.CreateEntity.Conformance, CRDD.CreateWall.NumericBoundary.Generated, CRDD.Integration.GeneratedAssets
