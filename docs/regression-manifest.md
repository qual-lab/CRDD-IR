# Product regression manifest

生成物のownership SHA-256は、テキストの改行をLFへ正規化して計算します。Windowsの
Git checkoutでLFがCRLFへ変換されても、内容が同一なら`unchanged`として扱われます。
実際の内容変更は従来どおりconflictになります。リポジトリ内の標準生成物については
`.gitattributes`でもLFを固定しています。

Generate one deterministic regression set for every CRDD Operation used by a
product:

```powershell
node tools/CRDD-IR/src/cli.ts test regression `
  contracts/ApplyRecord.md `
  contracts/ReviseRecord.md `
  --out-dir evidence/crdd-ir/Regression
```

The output contains:

```text
Regression/
├─ regression.manifest.json
├─ apply-record.conformance.json
└─ revise-record.conformance.json
```

`regression.manifest.json` conforms to
`schemas/regression-manifest.schema.json`. Operations are sorted by ID and each
entry records:

- the product adapter key;
- the project-relative CRDD source path and newline-normalized source SHA-256;
- the normalized IR SHA-256;
- the Conformance Bundle path and SHA-256;
- success, failure, and total case counts;
- CRDD trace IDs.

The manifest and bundles are generated transactionally. CRDD-IR refuses to
overwrite a product-edited generated bundle unless `--force` is explicitly
provided. Re-running with the same inputs produces byte-identical output.

The installed `tools/crdd-ir.ps1 generate` and `verify` commands generate this
set automatically under:

```text
<configured evidence directory>/Regression/
```

A product test runner should resolve `adapterKey` to its product-owned adapter,
execute every referenced bundle, and fail the product regression gate when:

- an adapter key is missing;
- a bundle hash does not match;
- any case fails;
- the executed Operation set differs from the manifest.
