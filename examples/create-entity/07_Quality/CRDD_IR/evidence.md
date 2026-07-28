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
| unreal/CreateEntity.generated.h | `d1162f88d82efcb2f55dfd4308c5eca371e487b910267cc91cebf2cefbb1a290` | REQ-ENTITY-001, DEC-ENTITY-003 |
| unreal/CreateEntity.generated.cpp | `d293120ecac980bb8368b8aa6e99081d2e14bf1f740b0ef41447cc7d8bed3e9d` | REQ-ENTITY-001, DEC-ENTITY-003 |
| assets/EntityPreview.generated.obj | `a8cbc7e791cef05227bae119f4e561af4747f8740f75586778871c7978718f7a` | REQ-ENTITY-001 |
| assets/EntityPreview.generated.mtl | `75fd255dfafcf433ffe9555e602569be2dbed9dff76c90badd9d8dc492909792` | REQ-ENTITY-001 |
| assets/SecondaryPreview.generated.obj | `d186e821dffacccb1a1ca8db42c95faf20f1ce868d631ca2399d93af0b079023` | REQ-ENTITY-001 |
| assets/SecondaryPreview.generated.mtl | `8ce01a862f958517dde3d50e4cb855cefad9fc75c1f23a31670746f4d493732f` | REQ-ENTITY-001 |
| assets/assets.manifest.json | `20005ccf92c91efddcf4dc62c3e6417f0039e35e9fc8c41b217089ff86b11f3a` |  |
## Unreal Execution

- Status: **PASSED**
- Evidence: `unreal-execution.json`
- Evidence SHA-256: `ecc9e9cf2577932e836447f28e8decd9b74297a7088cd880fdd1e1460fe6c67d`
- Tests: CRDD.Assets.GeneratedMeshes, CRDD.Assets.GeneratedPreviewLevels, CRDD.Assets.GeneratedScene, CRDD.CreateEntity.Conformance
