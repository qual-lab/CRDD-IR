import { createHash } from "node:crypto";

export function normalizeGeneratedText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function generatedTextSha256(value: string | Buffer): string {
  const text = typeof value === "string" ? value : value.toString("utf8");
  return createHash("sha256").update(normalizeGeneratedText(text)).digest("hex");
}
