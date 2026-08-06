# v0.10.0 release checklist

Do not tag, publish, or merge to `main` until release Go is recorded.

## Source and automated verification

- [ ] `feature/truth-evaluation-pipeline-v0.10.0` is reviewed and merged into `develop`
- [ ] package metadata uses `0.10.0`
- [ ] Node regression suite passes
- [ ] installer and verification-lock regressions pass
- [ ] Unreal Editor, Automation, Shipping Cook, Package, and Archive pass
- [ ] Unity EditMode and Windows x64 IL2CPP Player Build pass
- [ ] package dry run contains source, schemas, scripts, templates, and docs

## Semantic gates

- [ ] count/filter and join aggregates agree across Simulator, Unreal, and Unity
- [ ] primary/contributing/cover-style groups are policy data, not Core constants
- [ ] empty, duplicate, unknown, invalid-record, and revision failures rollback
- [ ] output/event contains no directly projected private collection
- [ ] scoring, join, and authoritative matching do not appear in Product Adapter code
- [ ] output, reward, revision, and event share one atomic candidate state
- [ ] repeated generation is byte-identical
- [ ] target parity includes `IR-COLLECTION-AGGREGATE-001` and `IR-PRIVATE-OUTPUT-001`
- [ ] all earlier semantic and mutation regressions pass

## Publish after Go

Create reviewed feature-to-develop and develop-to-main PRs. Tag only the merged
`main` commit as `v0.10.0`, then publish `docs/releases/v0.10.0.md`.
