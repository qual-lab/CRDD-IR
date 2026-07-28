import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateAssets } from "./assets.ts";
import { compileMarkdown, type CompilationResult } from "./compiler.ts";
import { generateUnreal } from "./unreal.ts";

export type BatchTarget = "ir" | "unreal" | "assets";

export type BatchManifest = {
  protocol: "crdd-ir/batch-v0.1";
  target: BatchTarget;
  operations: Array<{
    id: string;
    source: string;
    digest: string;
    outputDirectory: string;
    files: Array<{ path: string; sha256: string }>;
  }>;
};

export async function generateBatch(
  sources: string[],
  outDir: string,
  target: BatchTarget,
): Promise<BatchManifest> {
  if (sources.length === 0) throw new Error("Batch requires at least one CRDD Markdown source");
  const compilations = await Promise.all(sources.map((source) => compileMarkdown(source)));
  rejectDuplicateOperations(compilations);
  const operations: BatchManifest["operations"] = [];
  const manifestPath = resolve(outDir, "batch.manifest.json");
  const previous = await loadPreviousManifest(manifestPath);

  for (const compilation of compilations.sort((a, b) =>
    a.ir.operation.id.localeCompare(b.ir.operation.id)
  )) {
    const operationDir = resolve(outDir, compilation.ir.operation.id);
    await mkdir(operationDir, { recursive: true });
    const files = target === "ir"
      ? [{ name: `${compilation.ir.operation.id}.ir.json`, content: compilation.canonicalJson }]
      : target === "unreal"
        ? generateUnreal(compilation.ir)
        : generateAssets(compilation.ir);
    if (target === "assets" && files.length === 0) {
      throw new Error(`Operation "${compilation.ir.operation.id}" declares no assets`);
    }
    const hashedFiles = files.map((file) => ({
      path: file.name,
      sha256: "sha256" in file
        ? file.sha256
        : createHash("sha256").update(file.content).digest("hex"),
      content: file.content,
    }));
    const previousOperation = previous?.target === target
      ? previous.operations.find((entry) =>
        entry.id === compilation.ir.operation.id && entry.digest === compilation.digest
      )
      : undefined;
    const cacheHit = previousOperation &&
      await outputsMatch(operationDir, previousOperation.files);
    if (!cacheHit) {
      for (const file of hashedFiles) {
        await writeIfChanged(resolve(operationDir, file.path), file.content);
      }
    }
    operations.push({
      id: compilation.ir.operation.id,
      source: compilation.sourceMap.sourcePath.replaceAll("\\", "/"),
      digest: compilation.digest,
      outputDirectory: compilation.ir.operation.id,
      files: hashedFiles
        .map(({ path, sha256 }) => ({ path, sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    });
  }

  const manifest: BatchManifest = {
    protocol: "crdd-ir/batch-v0.1",
    target,
    operations,
  };
  await mkdir(outDir, { recursive: true });
  await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function loadPreviousManifest(path: string): Promise<BatchManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as BatchManifest;
    if (value.protocol !== "crdd-ir/batch-v0.1" || !Array.isArray(value.operations)) {
      throw new Error("unsupported batch manifest");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    const recovery = `${path}.corrupt.${Date.now()}`;
    await rename(path, recovery);
    console.warn(`Recovered corrupt batch manifest as ${recovery}`);
    return undefined;
  }
}

async function outputsMatch(
  directory: string,
  files: Array<{ path: string; sha256: string }>,
): Promise<boolean> {
  try {
    return (await Promise.all(files.map(async (file) =>
      createHash("sha256")
        .update(await readFile(resolve(directory, file.path)))
        .digest("hex") === file.sha256
    ))).every(Boolean);
  } catch {
    return false;
  }
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, "utf8") === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, content, "utf8");
}

function rejectDuplicateOperations(compilations: CompilationResult[]): void {
  const sourcesByOperation = new Map<string, string[]>();
  for (const compilation of compilations) {
    const id = compilation.ir.operation.id;
    sourcesByOperation.set(id, [
      ...(sourcesByOperation.get(id) ?? []),
      compilation.sourceMap.sourcePath,
    ]);
  }
  const duplicates = [...sourcesByOperation]
    .filter(([, sources]) => sources.length > 1)
    .map(([id, sources]) => `${id} (${sources.join(", ")})`);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate operation ID(s) in batch: ${duplicates.join("; ")}`);
  }
}
