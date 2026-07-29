import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateAssets, getAssetDefinitions } from "../src/assets.ts";
import { compileMarkdown } from "../src/compiler.ts";
import { validateIr } from "../src/ir.ts";

const businessSource = new URL(
  "../examples/authorize-invoice/05_SPEC/01_Behavior_Specification.md",
  import.meta.url,
);

test("core compiles a non-game operation without game extensions", async () => {
  const result = await compileMarkdown(fileURLToPath(businessSource));
  assert.equal(result.ir.operation.id, "AuthorizeInvoice");
  assert.deepEqual(result.ir.operation.extensions?.["com.example.audit"], {
    protocol: "example/audit-v1",
    data: { category: "billing", retention_days: 2555 },
  });
  assert.deepEqual(getAssetDefinitions(result.ir), []);
  assert.deepEqual(generateAssets(result.ir), []);
});

test("core validates extension envelopes without interpreting target-owned data", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(businessSource))).ir);
  const extension = ir.operation.extensions?.["com.example.audit"];
  assert.ok(extension);
  if (!extension) return;
  extension.data = { targetOwned: { anyShape: [1, true, "value"] } };
  assert.deepEqual(validateIr(ir).filter((item) => item.severity === "error"), []);

  extension.protocol = "";
  assert.ok(validateIr(ir).some((item) => item.path.endsWith(".protocol")));
});

test("legacy asset IR remains readable while new IR uses extensions", async () => {
  const ir = structuredClone((await compileMarkdown(fileURLToPath(businessSource))).ir);
  delete ir.operation.extensions;
  ir.operation.assets = [];
  assert.deepEqual(getAssetDefinitions(ir), []);
  assert.deepEqual(validateIr(ir).filter((item) => item.severity === "error"), []);
});
