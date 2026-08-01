# v0.8.0 release checklist

Do not tag, publish, or merge to `main` until release Go is recorded.

## Source and automated verification

- [ ] `feature/conformance-seeds-v0.8.0` is reviewed and merged into `develop`
- [ ] `package.json` and `package-lock.json` use `0.8.0`
- [ ] Node regression suite passes
- [ ] installer and verification-lock regressions pass
- [ ] Unreal Editor, Automation, Shipping Cook, Package, and Archive pass
- [ ] Unity EditMode and Windows x64 IL2CPP Player Build pass
- [ ] package dry run contains source, schemas, scripts, templates, and docs

## v0.8.0 semantic gates

- [ ] a reviewed baseline is validated without solver mutation
- [ ] a branch seed can coordinate multiple input and state values
- [ ] unknown fields, invalid values, unused or duplicate seeds fail closed
- [ ] seed application never weakens or bypasses Requires
- [ ] invalid seeds report their ID and conflicting Requires
- [ ] repeated generation is byte-identical
- [ ] Unreal and Unity own the same branch cases and conformance digest
- [ ] target parity passes with the conformance plan in the IR digest
- [ ] existing contracts without `conformance` remain unchanged
- [ ] all earlier semantic and mutation regressions pass

## Documentation and adopter gate

- [ ] syntax and fail-closed behavior match `docs/conformance-fixtures.md`
- [ ] release notes match the reviewed implementation
- [ ] an adopter validates a pinned release candidate on both targets
- [ ] second generation reports unchanged outputs

## Publish after Go

```powershell
git switch develop
git merge --no-ff feature/conformance-seeds-v0.8.0
git push origin develop
# Create and merge the reviewed develop -> main release PR.
git switch main
git pull --ff-only
git tag -a v0.8.0 -m "CRDD IR v0.8.0"
git push origin main
git push origin v0.8.0
```

- [ ] tag points to the reviewed `main` release commit
- [ ] GitHub Release title is `CRDD IR v0.8.0`
- [ ] release body uses `docs/releases/v0.8.0.md`
- [ ] adopting repositories can pin their Submodule to `v0.8.0`
