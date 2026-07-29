import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { compileMarkdown } from "./compiler.ts";
import { loadProjectConfig } from "./project-config.ts";
import { analyzeTestCoverage, generateTestManifest } from "./test-manifest.ts";
import { analyzeMutationCoverage } from "./mutation.ts";
import { getTargetAdapter, validateTargetProfile } from "./target-registry.ts";

export type DoctorCheck = {
  code: string;
  status: "pass" | "warning" | "fail";
  message: string;
  path?: string;
};

export type DoctorReport = {
  protocol: "crdd-ir/doctor-v0.1";
  ok: boolean;
  checks: DoctorCheck[];
};

type InstallManifest = {
  protocol: string;
  toolVersion: string;
  files: Array<{ path: string; kind: "file" | "managed-block"; sha256: string }>;
};

export async function runDoctor(configPath: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const root = dirname(resolve(configPath));
  const config = await loadProjectConfig(configPath);
  checks.push(pass("CRDD_CONFIG_VALID", "Project configuration is valid", configPath));

  const nodeVersion = Number(process.versions.node.split(".")[0]);
  checks.push(nodeVersion >= 22
    ? pass("CRDD_NODE_SUPPORTED", `Node ${process.versions.node} is supported`)
    : fail("CRDD_NODE_UNSUPPORTED", `Node 22 or newer is required; found ${process.versions.node}`));

  const paths = {
    toolRoot: inside(root, config.toolRoot),
    sources: config.sources.map((source) => inside(root, source)),
    outputs: Object.fromEntries(Object.entries(config.targets)
      .map(([id, target]) => [id, inside(root, target.output)])),
    evidence: inside(root, config.evidence),
  };
  for (const source of paths.sources) {
    await checkFile(source, "CRDD_SOURCE_PRESENT", "CRDD source exists", checks);
  }
  await checkFile(resolve(paths.toolRoot, "src/cli.ts"), "CRDD_TOOL_PRESENT", "Compiler CLI exists", checks);
  checkOutputSeparation(paths, checks);

  try {
    const compilations = await Promise.all(paths.sources.map((source) => compileMarkdown(source)));
    const duplicates = compilations
      .map((item) => item.ir.operation.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) throw new Error(`Duplicate operation ID(s): ${[...new Set(duplicates)].join(", ")}`);
    for (const [targetId, targetConfig] of Object.entries(config.targets)) {
      const adapter = getTargetAdapter(targetId);
      const profile = targetConfig.profile
        ? validateTargetProfile(adapter, JSON.parse(await readFile(inside(root, targetConfig.profile), "utf8")))
        : undefined;
      if (adapter.profileRequired && profile === undefined) {
        throw new Error(`Target "${targetId}" requires a profile`);
      }
      const generatedNames = new Map<string, string[]>();
      for (const [operationIndex, compilation] of compilations.entries()) {
        for (const file of adapter.generate({ compilation, operationIndex, profile })) {
          const key = file.name.toLowerCase();
          generatedNames.set(key, [...(generatedNames.get(key) ?? []), compilation.ir.operation.id]);
        }
      }
      const collisions = [...generatedNames]
        .filter(([, operations]) => operations.length > 1)
        .map(([name, operations]) => `${name} (${operations.join(", ")})`);
      if (collisions.length > 0) {
        throw new Error(`Generated ${targetId} file collision(s): ${collisions.join("; ")}`);
      }
      checks.push(pass(
        "CRDD_GENERATED_NAMES_UNIQUE",
        `${targetId}: generated filenames are unique across ${compilations.length} operation(s)`,
      ));
    }
    for (const [index, compilation] of compilations.entries()) {
      checks.push(pass(
        "CRDD_SOURCE_COMPILES",
        `Source compiles deterministically as ${compilation.ir.operation.id} (${compilation.digest})`,
        paths.sources[index],
      ));
      const manifest = generateTestManifest(compilation.ir);
      const coverage = analyzeTestCoverage(compilation.ir, manifest);
      checks.push(coverage.uncovered.length === 0
        ? pass(
          "CRDD_REQUIREMENTS_COVERED",
          `${compilation.ir.operation.id}: all ${coverage.requirements} requirements have failure cases`,
        )
        : fail(
          "CRDD_REQUIREMENTS_UNCOVERED",
          `${compilation.ir.operation.id}: uncovered ${coverage.uncovered.join(", ")}`,
        ));
      const mutation = analyzeMutationCoverage(compilation.ir, manifest);
      checks.push(mutation.survived.length === 0
        ? pass(
          "CRDD_MUTATIONS_KILLED",
          `${compilation.ir.operation.id}: killed all ${mutation.total} deterministic mutants`,
        )
        : fail(
          "CRDD_MUTATIONS_SURVIVED",
          `${compilation.ir.operation.id}: surviving ${mutation.survived.join(", ")}`,
        ));
    }
  } catch (error) {
    checks.push(fail("CRDD_SOURCE_INVALID", (error as Error).message));
  }

  for (const output of [...Object.values(paths.outputs), paths.evidence]) {
    const existingParent = await nearestExistingParent(output);
    try {
      await access(existingParent, constants.W_OK);
      checks.push(pass("CRDD_OUTPUT_WRITABLE", "Output parent is writable", output));
    } catch {
      checks.push(fail("CRDD_OUTPUT_NOT_WRITABLE", "Output parent is not writable", output));
    }
  }

  await checkInstallation(root, paths.toolRoot, checks);
  return {
    protocol: "crdd-ir/doctor-v0.1",
    ok: !checks.some((check) => check.status === "fail"),
    checks,
  };
}

function inside(root: string, value: string): string {
  if (isAbsolute(value)) throw new Error(`Project path must be relative: ${value}`);
  const result = resolve(root, value);
  const relation = relative(root, result);
  if (relation === ".." || relation.startsWith(`..\\`) || relation.startsWith("../")) {
    throw new Error(`Project path escapes repository: ${value}`);
  }
  return result;
}

function checkOutputSeparation(
  paths: {
    toolRoot: string;
    sources: string[];
    outputs: Record<string, string>;
    evidence: string;
  },
  checks: DoctorCheck[],
): void {
  const outputs = [...Object.values(paths.outputs), paths.evidence];
  const duplicates = outputs.filter((path, index) => outputs.indexOf(path) !== index);
  if (duplicates.length > 0) {
    checks.push(fail("CRDD_OUTPUT_COLLISION", "Target output and evidence paths must be distinct"));
  } else {
    checks.push(pass("CRDD_OUTPUTS_SEPARATE", "Generated output paths are distinct"));
  }
  for (const output of outputs) {
    if (
      overlaps(output, paths.toolRoot) ||
      paths.sources.some((source) => overlaps(output, source) || overlaps(output, dirname(source)))
    ) {
      checks.push(fail("CRDD_OUTPUT_OVERLAP", "Output path overlaps compiler or source", output));
    }
  }
}

function overlaps(left: string, right: string): boolean {
  return contains(left, right) || contains(right, left);
}

function contains(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" ||
    (relation !== ".." && !relation.startsWith(`..\\`) && !relation.startsWith("../") && !isAbsolute(relation));
}

async function checkInstallation(root: string, toolRoot: string, checks: DoctorCheck[]): Promise<void> {
  const manifestPath = resolve(root, ".crdd-ir.install.json");
  let manifest: InstallManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as InstallManifest;
  } catch {
    checks.push(warning("CRDD_INSTALL_MANIFEST_MISSING", "Installation ownership manifest is missing", manifestPath));
    return;
  }
  if (manifest.protocol !== "crdd-ir/install-manifest-v0.2" || !Array.isArray(manifest.files)) {
    checks.push(fail("CRDD_INSTALL_MANIFEST_INVALID", "Installation ownership manifest is invalid", manifestPath));
    return;
  }
  try {
    const packageVersion = JSON.parse(await readFile(resolve(toolRoot, "package.json"), "utf8")).version;
    checks.push(packageVersion === manifest.toolVersion
      ? pass("CRDD_TOOL_VERSION_MATCH", `Installed integration matches tool ${packageVersion}`)
      : fail(
        "CRDD_TOOL_VERSION_MISMATCH",
        `Integration ${manifest.toolVersion} does not match tool ${packageVersion}; rerun installer`,
      ));
  } catch {
    checks.push(fail("CRDD_TOOL_PACKAGE_INVALID", "Tool package metadata cannot be read"));
  }
  for (const entry of manifest.files) {
    const path = inside(root, entry.path);
    try {
      const content = await readFile(path, "utf8");
      const owned = entry.kind === "managed-block" ? extractManagedBlock(content) : content;
      const digest = createHash("sha256").update(owned).digest("hex");
      if (digest !== entry.sha256) {
        checks.push(fail("CRDD_MANAGED_FILE_MODIFIED", "Managed content differs from installation manifest", path));
      }
    } catch {
      checks.push(fail("CRDD_MANAGED_FILE_MISSING", "Managed file is missing", path));
    }
  }
  if (!checks.some((check) => check.code.startsWith("CRDD_MANAGED_FILE_"))) {
    checks.push(pass("CRDD_MANAGED_FILES_INTACT", "All installer-managed content matches its manifest"));
  }
}

function extractManagedBlock(content: string): string {
  const begin = "<!-- CRDD-IR:BEGIN -->";
  const end = "<!-- CRDD-IR:END -->";
  const start = content.indexOf(begin);
  const finish = content.indexOf(end, start);
  if (start < 0 || finish < start) throw new Error("managed block missing");
  return content.slice(start, finish + end.length);
}

async function checkFile(
  path: string,
  code: string,
  message: string,
  checks: DoctorCheck[],
): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
    checks.push(pass(code, message, path));
  } catch {
    checks.push(fail(`${code}_MISSING`, `${message}: missing`, path));
  }
}

async function nearestExistingParent(path: string): Promise<string> {
  let candidate = path;
  while (true) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
}

function pass(code: string, message: string, path?: string): DoctorCheck {
  return { code, status: "pass", message, ...(path ? { path } : {}) };
}
function warning(code: string, message: string, path?: string): DoctorCheck {
  return { code, status: "warning", message, ...(path ? { path } : {}) };
}
function fail(code: string, message: string, path?: string): DoctorCheck {
  return { code, status: "fail", message, ...(path ? { path } : {}) };
}
