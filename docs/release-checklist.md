# v0.2.0 release checklist

このchecklistは`v0.2.0`を公開する担当者向けです。

## Source

- [ ] `feature/unity-target`をreviewし、release対象branchへmergeする
- [ ] working treeがclean
- [ ] `package.json`と`package-lock.json`が`0.2.0`
- [ ] 生成コードのgenerator versionが`0.2.0`
- [ ] Source Contract／IR protocolを意図せず変更していない

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

- [ ] Node testが全件成功
- [ ] Installer／repairの回帰testが成功
- [ ] verify lock testが成功
- [ ] Unreal Editor／Automation／Shipping Cook Packageが成功
- [ ] Unity EditMode Testが成功
- [ ] Unity Windows x64 IL2CPP Player Buildが成功
- [ ] npm pack内容に`src`、`schemas`、`scripts`、`docs`が含まれる

## Cross-target gate

```powershell
node src/cli.ts target parity test/fixtures/create-wall.md `
  --unreal-profile examples/unreal/profiles/ue-5.8-editor.json `
  --unity-profile examples/unity/profiles/unity-6-il2cpp.json `
  --out .crdd-ir/release/target-parity.json
```

- [ ] `IR-TARGET-001`が成功
- [ ] `IR-PARITY-001`が成功
- [ ] `equivalent`が`true`

## Documentation

- [ ] READMEのinstall／generate／verifyコマンドが実装と一致
- [ ] v0.2.0 release notesにCompatibility、Upgrade、Known boundariesがある
- [ ] Unity IntegrationとTarget Parityのリンクが有効
- [ ] Submodule利用者へ検証済みcommitとtagを案内できる

## Publish

```powershell
git tag -a v0.2.0 -m "CRDD IR v0.2.0"
git push origin <release-branch>
git push origin v0.2.0
```

- [ ] tagがrelease commitを指す
- [ ] GitHub Release titleが`CRDD IR v0.2.0`
- [ ] release bodyへ`docs/releases/v0.2.0.md`を反映
- [ ] Source archiveとtagからclean checkoutできる
- [ ] 適用先でSubmoduleを`v0.2.0`へ固定して再検証する
