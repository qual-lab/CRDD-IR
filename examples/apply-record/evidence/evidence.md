# CRDD IR Conformance Evidence: ApplyRecord

- Protocol: `crdd-ir/traceability-v0.1`
- Source: `examples/apply-record/contract.md`
- Internal IR SHA-256: `82dd4ea090d92c9a0bc628c24db35296843828e3968169ee398764b9bf12756c`
- Conformance Bundle SHA-256: `2acfb58330257d5d7946bc1c12fd2f7ea496aed216f776080cf6ee87de4b5582`
- Conformance Cases: 5
- Requirement Failure Coverage: 2/2 (100%)
- Mutation Score: 6/6 (100%)

## Requirement Coverage

| Requirement | Error | CRDD IDs | Test Cases |
| --- | --- | --- | --- |
| minimum-record-length | RECORD_TOO_SMALL | REQ-RECORD-001 | minimum-record-length-at-boundary, minimum-record-length-below-boundary |
| sufficient-capacity | INSUFFICIENT_CAPACITY | DEC-CAPACITY-001 | sufficient-capacity-exact, sufficient-capacity-insufficient |

## Generated Artifacts

| Artifact | SHA-256 | CRDD IDs |
| --- | --- | --- |
