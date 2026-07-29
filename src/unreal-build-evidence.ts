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
  verificationLock?: {
    runId: string;
    project: string;
    status: "acquired" | "released";
    waitMilliseconds: number;
    holdMilliseconds?: number;
    recoveredAbandoned: boolean;
    acquiredAt: string;
    releasedAt?: string;
    outcome?: "succeeded" | "failed";
  };
  packageFiles: Array<{ path: string; sha256: string }>;
};

export async function createUnrealBuildEvidence(
  plan: UnrealTargetPlan,
  execution: UnrealExecutionEvidence,
  packageDirectory?: string,
  verificationLock?: UnrealBuildEvidence["verificationLock"],
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
    ...(verificationLock ? { verificationLock } : {}),
    packageFiles,
  };
}

export async function loadVerificationLockEvidence(
  eventPath: string,
  runId: string,
): Promise<NonNullable<UnrealBuildEvidence["verificationLock"]>> {
  const events = (await readFile(eventPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Error(`Invalid verify event JSON at line ${index + 1}`);
      }
    })
    .filter((event) => event.runId === runId);
  const acquired = events.find((event) => event.event === "verify.lock.acquired");
  if (!acquired) throw new Error(`Verify lock run "${runId}" has no acquired event`);
  const released = events.find((event) => event.event === "verify.lock.released");
  const project = requireString(acquired.project, "project");
  const acquiredAt = requireTimestamp(acquired.timestamp, "acquired timestamp");
  const waitMilliseconds = requireNonNegativeInteger(
    acquired.waitMilliseconds,
    "waitMilliseconds",
  );
  const recoveredAbandoned = acquired.recoveredAbandoned;
  if (typeof recoveredAbandoned !== "boolean") {
    throw new Error("Verify lock acquired event is missing recoveredAbandoned");
  }
  return {
    runId,
    project,
    status: released ? "released" : "acquired",
    waitMilliseconds,
    recoveredAbandoned,
    acquiredAt,
    ...(released
      ? {
        holdMilliseconds: requireNonNegativeInteger(
          released.holdMilliseconds,
          "holdMilliseconds",
        ),
        releasedAt: requireTimestamp(released.timestamp, "released timestamp"),
        outcome: requireOutcome(released.outcome),
      }
      : {}),
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Verify lock event is missing ${label}`);
  }
  return value;
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Verify lock event has invalid ${label}`);
  }
  return timestamp;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Verify lock event has invalid ${label}`);
  }
  return value;
}

function requireOutcome(value: unknown): "succeeded" | "failed" {
  if (value !== "succeeded" && value !== "failed") {
    throw new Error("Verify lock released event has invalid outcome");
  }
  return value;
}
