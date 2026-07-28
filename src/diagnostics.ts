import type { Diagnostic } from "./model.ts";

export class DiagnosticError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly source?: string;

  constructor(
    diagnostics: Diagnostic[],
    source?: string,
  ) {
    super(formatDiagnosticText(diagnostics, source));
    this.name = "DiagnosticError";
    this.diagnostics = diagnostics;
    this.source = source;
  }
}

export function formatDiagnosticText(diagnostics: Diagnostic[], source?: string): string {
  return diagnostics
    .map((item) =>
      `${item.severity.toUpperCase()} ${item.code} ${source ? `${source} ` : ""}${item.path}: ${item.message}`
    )
    .join("\n");
}

export function diagnosticEnvelope(
  diagnostics: Diagnostic[],
  source?: string,
): {
  protocol: "crdd-ir/diagnostics-v0.1";
  ok: false;
  source?: string;
  diagnostics: Diagnostic[];
} {
  return {
    protocol: "crdd-ir/diagnostics-v0.1",
    ok: false,
    ...(source ? { source } : {}),
    diagnostics,
  };
}

export function unexpectedDiagnostic(error: unknown): Diagnostic {
  return {
    code: "CRDD_INTERNAL_ERROR",
    severity: "error",
    path: "$",
    message: error instanceof Error ? error.message : String(error),
  };
}
