# v0.2.1 release checklist

This checklist is for publishing CRDD IR v0.2.1.

## Source

- [ ] `feature/generalize-core-ir` is reviewed and merged into `develop`
- [ ] `develop` is merged into `main` through a release PR
- [ ] the working tree is clean
- [ ] `package.json` and `package-lock.json` use `0.2.1`
- [ ] generated Unreal and Unity files identify generator `0.2.1`
- [ ] CRDD Source Contract and Internal IR protocol IDs remain compatible at `v0.1`
- [ ] newly compiled 3D data uses `operation.extensions["crdd.3d-assets"]`
- [ ] legacy `operation.assets` input remains readable

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

- [ ] Node tests pass
- [ ] non-game `AuthorizeInvoice` fixture compiles and validates
- [ ] Installer and repair regression tests pass
- [ ] verification lock tests pass
- [ ] Unreal Editor Build and Automation pass
- [ ] Unreal Shipping Cook, Stage, Pak, IoStore, Package, and Archive pass
- [ ] Unity EditMode tests pass
- [ ] Unity Windows x64 IL2CPP Player Build passes
- [ ] npm package contains `src`, `schemas`, `scripts`, `docs`, and templates

## Compatibility gates

- [ ] `IR-TARGET-001` passes
- [ ] `IR-PARITY-001` passes
- [ ] Core accepts arbitrary matching units such as `USD`
- [ ] Core ignores target-owned Extension payload semantics
- [ ] Asset target rejects invalid 3D Extension payloads
- [ ] Unreal and Unity generated code remains semantically equivalent

## Documentation

- [ ] README states that Core IR is domain- and target-neutral
- [ ] Core Extension ownership and compatibility are documented
- [ ] v0.2.1 release notes contain compatibility, upgrade, and known boundaries
- [ ] Submodule users can identify the release tag and verification commands

## Publish

```powershell
git tag -a v0.2.1 -m "CRDD IR v0.2.1"
git push origin main
git push origin v0.2.1
```

- [ ] tag points to the reviewed `main` release commit
- [ ] GitHub Release title is `CRDD IR v0.2.1`
- [ ] release body uses `docs/releases/v0.2.1.md`
- [ ] source archive works from a clean checkout
- [ ] an adopting repository can pin its Submodule to `v0.2.1`
