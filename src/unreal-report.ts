import { createHash } from "node:crypto";

export type UnrealExecutionEvidence = {
  protocol: "crdd-ir/unreal-execution-v0.1";
  operation: string;
  reportCreatedOn: string;
  sourceReportSha256: string;
  platforms: string[];
  summary: {
    succeeded: number;
    failed: number;
    notRun: number;
  };
  tests: Array<{
    path: string;
    state: string;
    durationSeconds: number;
    warnings: number;
    errors: number;
  }>;
};

export function parseUnrealAutomationReport(
  source: string,
  operation: string,
): UnrealExecutionEvidence {
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid Unreal Automation report JSON: ${(error as Error).message}`);
  }
  if (!isRecord(value) || !Array.isArray(value.tests) || !Array.isArray(value.devices)) {
    throw new Error("Unreal Automation report is missing tests or devices");
  }

  const expectedPath = `CRDD.${operation}.Conformance`;
  const tests = value.tests
    .filter(isRecord)
    .filter(
      (test) =>
        test.fullTestPath === expectedPath ||
        (typeof test.fullTestPath === "string" &&
          (test.fullTestPath.startsWith("CRDD.Assets.") ||
            test.fullTestPath.startsWith("CRDD.Integration."))),
    )
    .map((test) => ({
      path: requireString(test, "fullTestPath"),
      state: requireString(test, "state"),
      durationSeconds: requireNumber(test, "duration"),
      warnings: requireNumber(test, "warnings"),
      errors: requireNumber(test, "errors"),
    }));
  if (tests.length === 0) {
    throw new Error(
      `Unreal Automation report contains no CRDD conformance or integration tests`,
    );
  }

  const platforms = [
    ...new Set(
      value.devices
        .filter(isRecord)
        .map((device) => device.platform)
        .filter((platform): platform is string => typeof platform === "string"),
    ),
  ].sort();

  return {
    protocol: "crdd-ir/unreal-execution-v0.1",
    operation,
    reportCreatedOn: requireString(value, "reportCreatedOn"),
    sourceReportSha256: createHash("sha256").update(source).digest("hex"),
    platforms,
    summary: {
      succeeded: tests.filter((test) => test.state === "Success").length,
      failed: tests.filter((test) => test.state === "Fail").length,
      notRun: tests.filter((test) => !["Success", "Fail"].includes(test.state)).length,
    },
    tests,
  };
}

function requireString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") throw new Error(`Unreal Automation report field "${key}" must be a string`);
  return value[key];
}

function requireNumber(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== "number") throw new Error(`Unreal Automation report field "${key}" must be a number`);
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
