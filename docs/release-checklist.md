# v0.9.0 release checklist

Do not tag, publish, or merge to `main` until release Go is recorded.

## Source and automated verification

- [ ] `feature/collection-quantifiers-output-events-v0.9.0` is reviewed and merged into `develop`
- [ ] `package.json` and `package-lock.json` use `0.9.0`
- [ ] Node regression suite passes
- [ ] installer and verification-lock regressions pass
- [ ] Unreal Editor, Automation, Shipping Cook, Package, and Archive pass
- [ ] Unity EditMode and Windows x64 IL2CPP Player Build pass
- [ ] package dry run contains source, schemas, scripts, templates, and docs

## v0.9.0 semantic gates

- [ ] `all` and `any` agree across Simulator, Unreal, and Unity
- [ ] empty collections produce `all=true` and `any=false`
- [ ] predicates resolve item-local, input, state, and constant operands
- [ ] a false collection predicate remains a normal result outside `requires`
- [ ] `returns` is constructed from post-effect state
- [ ] `emits.when` can compare immutable `previous` and candidate `state`
- [ ] a false-to-true event fires once and does not repeat on the stable state
- [ ] failed operations expose no output/event and preserve the original state
- [ ] generated product bridge DTOs carry output and events without adapter-side decisions
- [ ] repeated generation is byte-identical
- [ ] Unreal and Unity own the same branch cases and conformance digest
- [ ] target parity passes with the conformance plan in the IR digest
- [ ] existing contracts without `conformance` remain unchanged
- [ ] all earlier semantic and mutation regressions pass

## Documentation and adopter gate

- [ ] syntax and failure behavior match `docs/collection-predicates-and-results.md`
- [ ] release notes match the reviewed implementation
- [ ] an adopter validates a pinned release candidate on both targets
- [ ] second generation reports unchanged outputs

## Publish after Go

```powershell
git switch develop
git merge --no-ff feature/collection-quantifiers-output-events-v0.9.0
git push origin develop
# Create and merge the reviewed develop -> main release PR.
git switch main
git pull --ff-only
git tag -a v0.9.0 -m "CRDD IR v0.9.0"
git push origin main
git push origin v0.9.0
```

- [ ] tag points to the reviewed `main` release commit
- [ ] GitHub Release title is `CRDD IR v0.9.0`
- [ ] release body uses `docs/releases/v0.9.0.md`
- [ ] adopting repositories can pin their Submodule to `v0.9.0`
