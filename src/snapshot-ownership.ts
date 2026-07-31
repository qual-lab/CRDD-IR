import { createHash } from "node:crypto";
import type { FieldDefinition, Operation } from "./model.ts";

const descriptor = {
  protocol: "crdd-ir/snapshot-ownership-v0.1",
  guarantees: [
    "initial-state-to-result-deep-copy",
    "result-to-initial-state-isolation",
    "input-to-result-deep-copy",
    "rollback-state-deep-copy",
    "nested-primitive-order-preserved",
    "nested-empty-collection-preserved",
  ],
};

export function requiresSnapshotOwnership(operation: Operation): boolean {
  const visit = (field: FieldDefinition, nested: boolean): boolean => {
    if (field.type === "array") {
      if (nested && field.items.type !== "object") return true;
      return visit(field.items, true);
    }
    if (field.type === "object") return Object.values(field.properties).some((child) => visit(child, true));
    if (field.type === "map") return visit(field.values, true);
    if (field.type === "union") return field.variants.some((variant) => visit(variant, true));
    return false;
  };
  return [...Object.values(operation.input), ...Object.values(operation.state)].some((field) => visit(field, false));
}

export function snapshotOwnershipMarker(): string {
  return Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64");
}

export function snapshotOwnershipDigestFromGenerated(
  files: Array<{ content: string }>,
): string {
  const markers = files.flatMap((file) =>
    [...file.content.matchAll(/CRDD-SNAPSHOT-OWNERSHIP:\s*([A-Za-z0-9+/=]+)/g)].map((match) => match[1])
  );
  const unique = [...new Set(markers)].sort();
  return createHash("sha256").update(JSON.stringify(unique)).digest("hex");
}
