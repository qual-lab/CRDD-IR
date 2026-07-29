import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { GeneratedFile } from "./unreal.ts";
import { withInterprocessLock } from "./interprocess-lock.ts";
import { generatedTextSha256 } from "./content-hash.ts";

export type GenerationChange = {
  path: string;
  action: "create" | "update" | "delete" | "unchanged" | "conflict";
  message?: string;
};

type GenerationManifest = {
  protocol: "crdd-ir/generation-v0.1";
  files: Array<{ path: string; sha256: string }>;
};

export async function generateTransactionally(options: {
  outDir: string;
  files: GeneratedFile[];
  dryRun?: boolean;
  force?: boolean;
}): Promise<GenerationChange[]> {
  return withInterprocessLock(resolve(options.outDir), () => generateLocked(options), {
    timeoutMs: 30_000,
  });
}

async function generateLocked(options: {
  outDir: string;
  files: GeneratedFile[];
  dryRun?: boolean;
  force?: boolean;
}): Promise<GenerationChange[]> {
  const outDir = resolve(options.outDir);
  const manifestPath = resolve(outDir, ".crdd-generation.json");
  const previous = await loadManifest(manifestPath);
  const desired = new Map(options.files.map((file) => {
    safeName(file.name);
    return [file.name, file];
  }));
  if (desired.size !== options.files.length) throw new Error("Generated output contains duplicate file names");
  const changes: GenerationChange[] = [];

  for (const file of options.files) {
    const path = resolve(outDir, file.name);
    const current = await digestFile(path);
    const desiredSha256 = generatedTextSha256(file.content);
    const owned = previous?.files.find((entry) => entry.path === file.name);
    if (current === desiredSha256) {
      changes.push({ path: file.name, action: "unchanged" });
    } else if (current && (!owned || owned.sha256 !== current) && !options.force) {
      changes.push({
        path: file.name,
        action: "conflict",
        message: "existing file differs from the last generated SHA-256",
      });
    } else {
      changes.push({ path: file.name, action: current ? "update" : "create" });
    }
  }
  for (const owned of previous?.files ?? []) {
    if (desired.has(owned.path)) continue;
    const current = await digestFile(resolve(outDir, owned.path));
    if (!current) continue;
    if (current !== owned.sha256 && !options.force) {
      changes.push({
        path: owned.path,
        action: "conflict",
        message: "obsolete generated file was modified",
      });
    } else {
      changes.push({ path: owned.path, action: "delete" });
    }
  }
  const conflicts = changes.filter((change) => change.action === "conflict");
  if (options.dryRun) return changes;
  if (conflicts.length > 0) {
    throw new Error(
      `Generated file conflict(s): ${conflicts.map((item) => item.path).join(", ")}. ` +
      "Review changes or use --force.",
    );
  }

  await mkdir(outDir, { recursive: true });
  const transaction = randomUUID();
  const staged: Array<{ temporary: string; target: string }> = [];
  try {
    for (const file of options.files) {
      const change = changes.find((entry) => entry.path === file.name);
      if (change?.action === "unchanged") continue;
      const target = resolve(outDir, file.name);
      const temporary = resolve(outDir, `.${basename(file.name)}.crdd-tmp-${transaction}`);
      await writeFile(temporary, file.content, "utf8");
      staged.push({ temporary, target });
    }
    for (const item of staged) await rename(item.temporary, item.target);
    for (const change of changes.filter((entry) => entry.action === "delete")) {
      await unlink(resolve(outDir, change.path));
    }
    const manifest: GenerationManifest = {
      protocol: "crdd-ir/generation-v0.1",
      files: options.files
        .map((file) => ({ path: file.name, sha256: generatedTextSha256(file.content) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
    const temporaryManifest = `${manifestPath}.crdd-tmp-${transaction}`;
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryManifest, manifestPath);
  } finally {
    await Promise.all(staged.map(({ temporary }) => unlink(temporary).catch(() => undefined)));
  }
  return changes;
}

async function loadManifest(path: string): Promise<GenerationManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as GenerationManifest;
    if (value.protocol !== "crdd-ir/generation-v0.1" || !Array.isArray(value.files)) {
      throw new Error("unsupported generation manifest");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Generation ownership manifest is corrupt: ${path}`);
  }
}

async function digestFile(path: string): Promise<string | undefined> {
  try {
    return generatedTextSha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function safeName(name: string): void {
  if (name !== basename(name) || name === "." || name === "..") {
    throw new Error(`Unsafe generated file name: ${name}`);
  }
}
