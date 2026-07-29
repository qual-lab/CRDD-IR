import type { UnrealConfigPatch } from "./unreal-target.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withInterprocessLock } from "./interprocess-lock.ts";

export type UnrealConfigEdit = {
  file: string;
  content: string;
};

export function renderUnrealConfigEdits(
  currentFiles: Record<string, string>,
  patches: UnrealConfigPatch[],
): UnrealConfigEdit[] {
  const byFile = new Map<string, UnrealConfigPatch[]>();
  for (const patch of patches) {
    const file = patch.platform
      ? `Config/${patch.platform}/${patch.file}`
      : `Config/${patch.file}`;
    byFile.set(file, [...(byFile.get(file) ?? []), patch]);
  }
  return [...byFile].sort(([left], [right]) => left.localeCompare(right))
    .map(([file, filePatches]) => ({
      file,
      content: applyUnrealConfigPatches(currentFiles[file] ?? "", filePatches),
    }));
}

export async function applyUnrealConfigToProject(
  projectRoot: string,
  patches: UnrealConfigPatch[],
  dryRun = false,
): Promise<UnrealConfigEdit[]> {
  return withInterprocessLock(resolve(projectRoot, "Config"), () =>
    applyUnrealConfigLocked(projectRoot, patches, dryRun)
  );
}

async function applyUnrealConfigLocked(
  projectRoot: string,
  patches: UnrealConfigPatch[],
  dryRun: boolean,
): Promise<UnrealConfigEdit[]> {
  const files = [...new Set(patches.map((patch) =>
    patch.platform
      ? `Config/${patch.platform}/${patch.file}`
      : `Config/${patch.file}`
  ))];
  const current: Record<string, string> = {};
  for (const file of files) {
    try {
      current[file] = await readFile(resolve(projectRoot, file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const edits = renderUnrealConfigEdits(current, patches);
  if (dryRun) return edits;
  const transaction = randomUUID();
  const staged: Array<{ temporary: string; target: string }> = [];
  try {
    for (const edit of edits) {
      const target = resolve(projectRoot, edit.file);
      const temporary = `${target}.crdd-tmp-${transaction}`;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, edit.content, "utf8");
      staged.push({ temporary, target });
    }
    for (const edit of staged) await rename(edit.temporary, edit.target);
  } finally {
    await Promise.all(staged.map((edit) => unlink(edit.temporary).catch(() => undefined)));
  }
  return edits;
}

export function applyUnrealConfigPatches(
  current: string,
  patches: UnrealConfigPatch[],
): string {
  const owners = [...new Set(patches.map((patch) => patch.owner))].sort();
  let result = normalize(current);
  for (const owner of owners) {
    const owned = patches.filter((patch) => patch.owner === owner);
    const withoutBlock = removeOwnerBlock(result, owner);
    rejectUnmanagedConflicts(withoutBlock, owned);
    const block = renderOwnerBlock(owner, owned);
    result = `${withoutBlock.trimEnd()}${withoutBlock.trim() ? "\n\n" : ""}${block}\n`;
  }
  return result;
}

export function removeUnrealConfigOwner(current: string, owner: string): string {
  const result = removeOwnerBlock(normalize(current), owner).trimEnd();
  return result ? `${result}\n` : "";
}

function renderOwnerBlock(owner: string, patches: UnrealConfigPatch[]): string {
  const sections = new Map<string, UnrealConfigPatch[]>();
  for (const patch of patches) {
    sections.set(patch.section, [...(sections.get(patch.section) ?? []), patch]);
  }
  const lines = [`; CRDD-IR:${owner}:BEGIN`];
  for (const [section, sectionPatches] of [...sections].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`[${section}]`);
    for (const patch of sectionPatches.sort((a, b) =>
      `${a.key}|${a.operation}|${a.value ?? ""}`.localeCompare(
        `${b.key}|${b.operation}|${b.value ?? ""}`,
      )
    )) {
      const prefix = patch.operation === "add"
        ? "+"
        : patch.operation === "remove"
          ? "-"
          : patch.operation === "clear"
            ? "!"
            : "";
      lines.push(`${prefix}${patch.key}=${patch.operation === "clear" ? "ClearArray" : patch.value}`);
    }
  }
  lines.push(`; CRDD-IR:${owner}:END`);
  return lines.join("\n");
}

function removeOwnerBlock(current: string, owner: string): string {
  const escaped = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n); CRDD-IR:${escaped}:BEGIN\\n[\\s\\S]*?\\n; CRDD-IR:${escaped}:END(?:\\n|$)`,
    "g",
  );
  return current.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n");
}

function rejectUnmanagedConflicts(current: string, patches: UnrealConfigPatch[]): void {
  let section = "";
  const unmanaged = new Set<string>();
  for (const rawLine of current.split("\n")) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const keyMatch = /^[+!\-]?([^=;\s]+)\s*=/.exec(line);
    if (keyMatch && section) unmanaged.add(`${section}|${keyMatch[1]}`.toLowerCase());
  }
  const conflicts = patches
    .filter((patch) => unmanaged.has(`${patch.section}|${patch.key}`.toLowerCase()))
    .map((patch) => `[${patch.section}] ${patch.key}`);
  if (conflicts.length > 0) {
    throw new Error(`Unmanaged Unreal Config conflict(s): ${[...new Set(conflicts)].join(", ")}`);
  }
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
