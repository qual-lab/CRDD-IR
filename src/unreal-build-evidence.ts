import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { UnrealExecutionEvidence } from "./unreal-report.ts";
import type { UnrealTargetPlan } from "./unreal-target.ts";
import { unrealTargetPlanDigest } from "./unreal-target.ts";

export type UnrealBuildEvidence = {
  protocol: "crdd-ir/unreal-build-evidence-v0.1";
  operation: string;
  target: {
    engine: string;
    dialect: string;
    platform: string;
    targetType: string;
    configuration: string;
    linkType: string;
    withEditor: boolean;
  };
  toolchain: {
    compiler?: string;
    compilerVersion?: string;
    sdk?: string;
  };
  modules: Array<{
    name: string;
    type: string;
    publicDependencies: string[];
    privateDependencies: string[];
  }>;
  hashes: {
    irSha256: string;
    targetPlanSha256: string;
    packageSha256: string;
    identitySha256: string;
  };
  stages: {
    uht: "passed" | "not-required";
    ubt: "passed";
    cook: "passed" | "not-required";
    package: "passed" | "not-required";
    automation: "passed" | "failed";
  };
  automation: {
    succeeded: number;
    failed: number;
    notRun: number;
    warnings: number;
    errors: number;
  };
  packageFiles: Array<{ path: string; sha256: string }>;
};

export async function createUnrealBuildEvidence(
  plan: UnrealTargetPlan,
  execution: UnrealExecutionEvidence,
  packageDirectory?: string,
): Promise<UnrealBuildEvidence> {
  const packageFiles = packageDirectory
    ? await hashDirectory(packageDirectory)
    : [];
  if (plan.verification.package && packageFiles.length === 0) {
    throw new Error("Shipping verification requires a non-empty package directory");
  }
  const packageSha256 = digest(canonicalJson(packageFiles));
  const stableIdentity = {
    operation: plan.operation,
    profile: {
      engine: plan.profile.engine,
      platform: plan.profile.platform,
      targetType: plan.profile.targetType,
      configuration: plan.profile.configuration,
      linkType: plan.profile.linkType,
      withEditor: plan.profile.withEditor,
      toolchain: plan.profile.toolchain ?? {},
    },
    modules: plan.modules,
    irSha256: plan.irSha256,
    targetPlanSha256: unrealTargetPlanDigest(plan),
    packageSha256,
    automation: {
      succeeded: execution.summary.succeeded,
      failed: execution.summary.failed,
      notRun: execution.summary.notRun,
      warnings: execution.tests.reduce((sum, item) => sum + item.warnings, 0),
      errors: execution.tests.reduce((sum, item) => sum + item.errors, 0),
      tests: execution.tests.map((item) => ({ path: item.path, state: item.state })),
    },
  };
  return {
    protocol: "crdd-ir/unreal-build-evidence-v0.1",
    operation: plan.operation,
    target: {
      engine: `${plan.profile.engine.major}.${plan.profile.engine.minor}.${plan.profile.engine.patch}`,
      dialect: plan.profile.engine.dialect,
      platform: plan.profile.platform,
      targetType: plan.profile.targetType,
      configuration: plan.profile.configuration,
      linkType: plan.profile.linkType,
      withEditor: plan.profile.withEditor,
    },
    toolchain: plan.profile.toolchain ?? {},
    modules: plan.modules.map((module) => ({
      name: module.name,
      type: module.type,
      publicDependencies: module.publicDependencies,
      privateDependencies: module.privateDependencies,
    })),
    hashes: {
      irSha256: plan.irSha256,
      targetPlanSha256: unrealTargetPlanDigest(plan),
      packageSha256,
      identitySha256: digest(canonicalJson(stableIdentity)),
    },
    stages: {
      uht: plan.verification.runUht ? "passed" : "not-required",
      ubt: "passed",
      cook: plan.verification.cook ? "passed" : "not-required",
      package: plan.verification.package ? "passed" : "not-required",
      automation: execution.summary.failed === 0 && execution.summary.notRun === 0
        ? "passed"
        : "failed",
    },
    automation: {
      succeeded: execution.summary.succeeded,
      failed: execution.summary.failed,
      notRun: execution.summary.notRun,
      warnings: execution.tests.reduce((sum, item) => sum + item.warnings, 0),
      errors: execution.tests.reduce((sum, item) => sum + item.errors, 0),
    },
    packageFiles,
  };
}

async function hashDirectory(root: string): Promise<Array<{ path: string; sha256: string }>> {
  const result: Array<{ path: string; sha256: string }> = [];
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        result.push({
          path: relative.replaceAll("\\", "/"),
          sha256: digest(await readFile(path)),
        });
      }
    }
  };
  if (!(await stat(root)).isDirectory()) throw new Error(`Package path is not a directory: ${basename(root)}`);
  await visit(root, "");
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
