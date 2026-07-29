import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { compileMarkdown, type CompilationResult } from "./compiler.ts";
import { generateConformanceBundle } from "./conformance.ts";
import { generateTransactionally, type GenerationChange } from "./generation.ts";
import { generateTestManifest } from "./test-manifest.ts";

export type RegressionManifest = {
  protocol: "crdd-ir/regression-manifest-v0.1";
  operations: Array<{
    id: string;
    adapterKey: string;
    source: {
      path: string;
      sha256: string;
      irSha256: string;
    };
    conformance: {
      path: string;
      sha256: string;
      cases: number;
      successCases: number;
      failureCases: number;
    };
    traces: string[];
  }>;
};

export async function generateRegressionManifest(
  sources: string[],
  outDir: string,
  options: { dryRun?: boolean; force?: boolean; rootDir?: string } = {},
): Promise<{ manifest: RegressionManifest; changes: GenerationChange[] }> {
  if (sources.length === 0) {
    throw new Error("Regression manifest requires at least one CRDD Markdown source");
  }
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const compilations = await Promise.all(sources.map(async (source) => ({
    compilation: await compileMarkdown(source),
    sourceSha256: digest((await readFile(source, "utf8")).replace(/\r\n?/g, "\n")),
    sourcePath: portableSourcePath(rootDir, source),
  })));
  rejectOperationCollisions(compilations.map((item) => item.compilation));

  const bundleFiles: Array<{ name: string; content: string; sha256: string }> = [];
  const operations: RegressionManifest["operations"] = [];
  for (const item of compilations.sort((left, right) =>
    left.compilation.ir.operation.id.localeCompare(right.compilation.ir.operation.id)
  )) {
    const { compilation } = item;
    const bundle = generateConformanceBundle(
      compilation.ir,
      generateTestManifest(compilation.ir),
    );
    const content = `${JSON.stringify(bundle, null, 2)}\n`;
    const name = `${fileSlug(compilation.ir.operation.id)}.conformance.json`;
    const sha256 = digest(content);
    bundleFiles.push({ name, content, sha256 });
    operations.push({
      id: compilation.ir.operation.id,
      adapterKey: compilation.ir.operation.id,
      source: {
        path: item.sourcePath,
        sha256: item.sourceSha256,
        irSha256: compilation.digest,
      },
      conformance: {
        path: name,
        sha256,
        cases: bundle.cases.length,
        successCases: bundle.cases.filter((testCase) => testCase.expected.ok).length,
        failureCases: bundle.cases.filter((testCase) => !testCase.expected.ok).length,
      },
      traces: [...compilation.ir.operation.traces].sort(),
    });
  }
  const manifest: RegressionManifest = {
    protocol: "crdd-ir/regression-manifest-v0.1",
    operations,
  };
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const files = [
    ...bundleFiles,
    {
      name: "regression.manifest.json",
      content: manifestContent,
      sha256: digest(manifestContent),
    },
  ];
  const changes = await generateTransactionally({
    outDir,
    files,
    dryRun: options.dryRun,
    force: options.force,
  });
  return { manifest, changes };
}

function portableSourcePath(rootDir: string, source: string): string {
  const path = relative(rootDir, resolve(source)).replaceAll("\\", "/");
  if (path === ".." || path.startsWith("../") || path.length === 0) {
    throw new Error(`Regression source must be inside the project root: ${source}`);
  }
  return path;
}

function rejectOperationCollisions(compilations: CompilationResult[]): void {
  const byId = new Map<string, string[]>();
  const byFile = new Map<string, string[]>();
  for (const compilation of compilations) {
    const idKey = compilation.ir.operation.id.toLowerCase();
    byId.set(idKey, [...(byId.get(idKey) ?? []), compilation.sourceMap.sourcePath]);
    const fileKey = fileSlug(compilation.ir.operation.id).toLowerCase();
    byFile.set(fileKey, [...(byFile.get(fileKey) ?? []), compilation.ir.operation.id]);
  }
  const duplicateIds = [...byId].filter(([, owners]) => owners.length > 1);
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate regression operation ID(s): ${
        duplicateIds.map(([id, owners]) => `${id} (${owners.join(", ")})`).join("; ")
      }`,
    );
  }
  const fileCollisions = [...byFile].filter(([, owners]) => owners.length > 1);
  if (fileCollisions.length > 0) {
    throw new Error(
      `Regression bundle filename collision(s): ${
        fileCollisions.map(([file, owners]) => `${file} (${owners.join(", ")})`).join("; ")
      }`,
    );
  }
}

function fileSlug(value: string): string {
  const slug = value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!slug) throw new Error(`Operation ID cannot form a safe output name: "${value}"`);
  return slug;
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
