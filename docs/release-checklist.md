# v0.7.0 release checklist

This checklist prepares CRDD IR v0.7.0 for publication. Do not tag, publish,
or merge to `main` until the release Go is recorded.

## Source

- [ ] `feature/conditional-effects-adopt-config-v0.7.0` is reviewed and merged into `develop`
- [ ] `develop` is merged into `main` through a release PR
- [ ] the release commit has a clean working tree
- [ ] `package.json` and `package-lock.json` use `0.7.0`
- [ ] tracked generated target files identify generator `0.7.0`
- [ ] Source Contract and Internal IR remain schema-valid without migration

## Automated verification

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:installer
npm.cmd run test:verify-lock
npm.cmd run verify:unreal
npm.cmd run verify:unity
npm.cmd run pack:check
```

- [ ] Node tests pass (reference result: 153/153)
- [ ] Installer regression tests pass
- [ ] verification-lock tests pass
- [ ] Unreal Editor Build and Automation pass
- [ ] Unreal Shipping Cook, Stage, Pak, IoStore, Package, and Archive pass
- [ ] Unity EditMode tests pass (reference result: 50/50)
- [ ] Unity Windows x64 IL2CPP Player Build passes
- [ ] npm package contains `src`, `schemas`, `scripts`, `docs`, and templates

## v0.7.0 semantic gates

- [ ] every `effect.when` enum branch has generated success coverage
- [ ] conditional Requires has generated failure and rollback coverage
- [ ] unknown enum values fail closed before branch evaluation
- [ ] applied branch traces match across Simulator, Unreal, and Unity
- [ ] remove/invert branch mutations are killed
- [ ] all branch effects share one atomic transaction snapshot
- [ ] `project adopt-config --dry-run` leaves the manifest byte-identical
- [ ] config adoption reports old/new SHA-256 and changes only its manifest entry
- [ ] unsafe source, target, or output changes cannot be adopted
- [ ] Doctor and CI never adopt a changed config implicitly

- [ ] `IR-TARGET-001` and `IR-PARITY-001` pass
- [ ] TypeScript query and asynchronous targets preserve Core semantics
- [ ] an external Target Adapter loads without Core or CLI dispatch changes
- [ ] `IR-TEST-003` still kills composite arithmetic boundary mutations
- [ ] `IR-COLLECTION-001`, `IR-OPAQUE-001`, and `IR-IMMUTABLE-001` regressions pass
- [ ] `IR-UNION-001` generates typed variants and payloads for Unreal and Unity
- [ ] every declared union variant passes generated conformance
- [ ] unknown union variants fail closed without default conversion
- [ ] `IR-PRIMITIVE-COLLECTION-001` preserves empty arrays and source order
- [ ] primitive uniqueness rejection has matching Rule ID and Error Code
- [ ] `IR-EVIDENCE-ROUNDTRIP-001` preserves every required Evidence field
- [ ] Unreal and Unity reconstruct the same canonical Evidence SHA-256
- [ ] missing or modified Evidence is rejected before commit
- [ ] rejection preserves the original snapshot and produces no side effect
- [ ] generated Target Parity Evidence attributes all three requirement IDs
- [ ] `IR-STRUCTURAL-TYPE-001` emits one type per generated object shape
- [ ] matching Input and State object collections are assignment-compatible
- [ ] different shapes with the same preferred name remain collision-free
- [ ] `IR-NESTED-COLLECTION-001` supports primitive arrays in object elements
- [ ] empty nested arrays and nested array order survive conformance and Evidence
- [ ] parity Evidence attributes both v0.6.0 requirement IDs
- [ ] Unity State clone, rollback, and collection assign recursively deep-clone nested lists
- [ ] generated Unreal and Unity ownership tests mutate both sides without propagation
- [ ] Target Parity v0.3 reports matching `snapshotOwnershipSha256`
- [ ] `checks.sharedSnapshotOwnership` passes
- [ ] existing v0.5.0 contracts compile without migration

## Documentation and adopter gate

- [ ] v0.7.0 release notes match the reviewed implementation
- [ ] compound-value and canonical-Evidence syntax is documented
- [ ] known top-level/nesting limits are documented
- [ ] adopter verifies a pinned release candidate in its Unreal and Unity products
- [ ] adopter confirms regenerated manifests are deterministic and unchanged on a second run

## Publish after Go

```powershell
git switch develop
git merge --no-ff feature/conditional-effects-adopt-config-v0.7.0
git push origin develop
# Create and merge the reviewed develop -> main release PR.
git switch main
git pull --ff-only
git tag -a v0.7.0 -m "CRDD IR v0.7.0"
git push origin main
git push origin v0.6.0
```

- [ ] tag points to the reviewed `main` release commit
- [ ] GitHub Release title is `CRDD IR v0.7.0`
- [ ] release body uses `docs/releases/v0.7.0.md`
- [ ] source archive works from a clean checkout
- [ ] adopting repositories can pin their Submodule to `v0.7.0`
