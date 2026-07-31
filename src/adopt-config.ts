import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { runDoctor } from "./doctor.ts";
import { loadProjectConfig } from "./project-config.ts";

type InstallEntry = { path: string; kind: "file" | "managed-block"; sha256: string };
type InstallManifest = {
  protocol: "crdd-ir/install-manifest-v0.2";
  toolVersion: string;
  files: InstallEntry[];
};

export type AdoptConfigResult = {
  protocol: "crdd-ir/adopt-config-v0.1";
  config: string;
  manifest: string;
  oldSha256: string;
  newSha256: string;
  changed: boolean;
  adopted: boolean;
};

export async function adoptProjectConfig(
  configPath: string,
  options: { dryRun?: boolean } = {},
): Promise<AdoptConfigResult> {
  const absoluteConfig = resolve(configPath);
  await loadProjectConfig(absoluteConfig);
  const report = await runDoctor(absoluteConfig);
  const unsafe = report.checks.filter((check) =>
    check.status === "fail" && !(
      check.code === "CRDD_MANAGED_FILE_MODIFIED" &&
      check.path !== undefined && resolve(check.path) === absoluteConfig
    )
  );
  if (unsafe.length > 0) {
    throw new Error(`Config adoption rejected by project safety checks:\n${unsafe
      .map((check) => `${check.code}: ${check.message}${check.path ? ` (${check.path})` : ""}`)
      .join("\n")}`);
  }

  const root = dirname(absoluteConfig);
  const manifestPath = resolve(root, ".crdd-ir.install.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as InstallManifest;
  if (manifest.protocol !== "crdd-ir/install-manifest-v0.2" || !Array.isArray(manifest.files)) {
    throw new Error(`Invalid installation manifest: ${manifestPath}`);
  }
  const relativeConfig = relative(root, absoluteConfig).replace(/\\/g, "/");
  const matches = manifest.files.filter((entry) => entry.path.replace(/\\/g, "/") === relativeConfig);
  if (matches.length !== 1 || matches[0].kind !== "file") {
    throw new Error(`Installation manifest must own exactly one file entry for ${relativeConfig}`);
  }

  const content = await readFile(absoluteConfig, "utf8");
  const newSha256 = createHash("sha256").update(content).digest("hex");
  const oldSha256 = matches[0].sha256;
  const changed = oldSha256 !== newSha256;
  if (changed && !options.dryRun) {
    matches[0].sha256 = newSha256;
    const temporaryPath = `${manifestPath}.adopt-config.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, manifestPath);
  }
  return {
    protocol: "crdd-ir/adopt-config-v0.1",
    config: absoluteConfig,
    manifest: manifestPath,
    oldSha256,
    newSha256,
    changed,
    adopted: changed && !options.dryRun,
  };
}
