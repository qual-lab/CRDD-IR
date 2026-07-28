import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateAssets } from "./assets.ts";
import { compileMarkdown, type CompilationResult } from "./compiler.ts";
import { generateUnreal } from "./unreal.ts";

export type BatchTarget = "ir" | "unreal" | "assets";
export type BatchLayout = "operation-directories" | "flat";

export type BatchManifest = {
  protocol: "crdd-ir/batch-v0.1";
  target: BatchTarget;
  layout: BatchLayout;
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
  options: { layout?: BatchLayout; force?: boolean } = {},
): Promise<BatchManifest> {
  const layout = options.layout ?? "operation-directories";
  if (layout === "flat" && target !== "unreal") {
    throw new Error('Flat batch layout is supported only for target "unreal"');
  }
  if (sources.length === 0) throw new Error("Batch requires at least one CRDD Markdown source");
  const compilations = await Promise.all(sources.map((source) => compileMarkdown(source)));
  rejectDuplicateOperations(compilations);
  rejectOutputCollisions(compilations, target, layout);
  const operations: BatchManifest["operations"] = [];
  const manifestPath = resolve(outDir, "batch.manifest.json");
  const previous = await loadPreviousManifest(manifestPath);
  if (previous?.target === target && previous.layout === layout && !options.force) {
    await rejectModifiedOwnedOutputs(outDir, previous);
  }

  for (const compilation of compilations.sort((a, b) =>
    a.ir.operation.id.localeCompare(b.ir.operation.id)
  )) {
    const operationDir = layout === "flat"
      ? resolve(outDir)
      : resolve(outDir, compilation.ir.operation.id);
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
    const previousOperation = previous?.target === target && previous.layout === layout
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
      outputDirectory: layout === "flat" ? "." : compilation.ir.operation.id,
      files: hashedFiles
        .map(({ path, sha256 }) => ({ path, sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    });
  }

  const manifest: BatchManifest = {
    protocol: "crdd-ir/batch-v0.1",
    target,
    layout,
    operations,
  };
  if (layout === "flat" && previous?.target === target && previous.layout === layout) {
    const retained = new Set(
      operations.flatMap((operation) => operation.files.map((file) => file.path.toLowerCase())),
    );
    for (const file of previous.operations.flatMap((operation) => operation.files)) {
      if (!retained.has(file.path.toLowerCase())) {
        await unlink(resolve(outDir, file.path)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }
  await mkdir(outDir, { recursive: true });
  await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function rejectModifiedOwnedOutputs(
  outDir: string,
  manifest: BatchManifest,
): Promise<void> {
  const modified: string[] = [];
  for (const operation of manifest.operations) {
    const directory = manifest.layout === "flat"
      ? resolve(outDir)
      : resolve(outDir, operation.outputDirectory);
    for (const file of operation.files) {
      try {
        const actual = createHash("sha256")
          .update(await readFile(resolve(directory, file.path)))
          .digest("hex");
        if (actual !== file.sha256) modified.push(file.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  if (modified.length > 0) {
    throw new Error(
      `Refusing to overwrite modified batch output(s): ${modified.sort().join(", ")}. ` +
      "Restore them or rerun with --force.",
    );
  }
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

function rejectOutputCollisions(
  compilations: CompilationResult[],
  target: BatchTarget,
  layout: BatchLayout,
): void {
  if (layout !== "flat") return;
  const owners = new Map<string, string[]>();
  for (const compilation of compilations) {
    const names = target === "unreal"
      ? generateUnreal(compilation.ir).map((file) => file.name)
      : [];
    for (const name of names) {
      const key = name.toLowerCase();
      owners.set(key, [...(owners.get(key) ?? []), compilation.ir.operation.id]);
    }
  }
  const collisions = [...owners]
    .filter(([, operations]) => operations.length > 1)
    .map(([name, operations]) => `${name} (${operations.join(", ")})`);
  if (collisions.length > 0) {
    throw new Error(`Generated file collision(s): ${collisions.join("; ")}`);
  }
}
