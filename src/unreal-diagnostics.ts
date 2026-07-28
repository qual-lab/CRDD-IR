export type NormalizedUnrealDiagnostic = {
  stableCode: string;
  tool: "UHT" | "UBT" | "Compiler" | "Cook" | "Automation";
  severity: "error" | "warning";
  sourceContract?: { path: string; line?: number };
  generated?: { path: string; line?: number };
  unrealLog?: { line: number };
  cause: string;
  recommendedFix: string;
  related: string[];
};

export function normalizeUnrealDiagnostics(
  log: string,
  sourcePath?: string,
): NormalizedUnrealDiagnostic[] {
  const diagnostics: NormalizedUnrealDiagnostic[] = [];
  for (const [index, rawLine] of log.replace(/\r\n/g, "\n").split("\n").entries()) {
    const line = sanitize(rawLine);
    if (!line) continue;
    const compiler = /([^:\s]+\.(?:h|hpp|cpp))\((\d+)(?:,\d+)?\):\s+(error|warning)\s+([A-Z]\d+):\s+(.+)/i.exec(line);
    if (compiler) {
      diagnostics.push({
        stableCode: `CRDD_UNREAL_COMPILER_${compiler[4].toUpperCase()}`,
        tool: "Compiler",
        severity: compiler[3].toLowerCase() as "error" | "warning",
        ...(sourcePath ? { sourceContract: { path: normalizePath(sourcePath) } } : {}),
        generated: { path: normalizePath(compiler[1]), line: Number(compiler[2]) },
        unrealLog: { line: index + 1 },
        cause: compiler[5],
        recommendedFix: "Update the CRDD contract or Unreal Target Profile; do not edit generated code.",
        related: [],
      });
      continue;
    }
    const generic = /(Error|Warning):\s*(.+)/i.exec(line);
    if (!generic) continue;
    const tool = detectTool(line);
    diagnostics.push({
      stableCode: stableCode(tool, generic[2]),
      tool,
      severity: generic[1].toLowerCase() as "error" | "warning",
      ...(sourcePath ? { sourceContract: { path: normalizePath(sourcePath) } } : {}),
      unrealLog: { line: index + 1 },
      cause: generic[2],
      recommendedFix: recommendation(tool),
      related: [],
    });
  }
  return diagnostics;
}

function detectTool(line: string): NormalizedUnrealDiagnostic["tool"] {
  if (/UHT|HeaderTool|Reflection/i.test(line)) return "UHT";
  if (/Cook|Package|Asset/i.test(line)) return "Cook";
  if (/Automation|Test/i.test(line)) return "Automation";
  return "UBT";
}

function stableCode(tool: NormalizedUnrealDiagnostic["tool"], message: string): string {
  const category = /cycle/i.test(message)
    ? "DEPENDENCY_CYCLE"
    : /module/i.test(message)
      ? "MODULE"
      : /asset|package/i.test(message)
        ? "ASSET"
        : /not found|cannot find|missing/i.test(message)
          ? "MISSING"
          : "FAILURE";
  return `CRDD_UNREAL_${tool.toUpperCase()}_${category}`;
}

function recommendation(tool: NormalizedUnrealDiagnostic["tool"]): string {
  if (tool === "UHT") return "Fix the Unreal declaration contract or target dialect.";
  if (tool === "Cook") return "Fix Asset ownership, Cook Rule, package path, or redirect configuration.";
  if (tool === "Automation") return "Fix the CRDD contract, generated adapter, or deterministic fixture.";
  return "Fix the Unreal Target Profile or Module Graph.";
}

function sanitize(value: string): string {
  return value
    .replace(/[A-Za-z]:\\(?:[^\\\s:]+\\)+/g, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<guid>")
    .replace(/\b(?:DESKTOP|LAPTOP)-[A-Z0-9]+\b/gi, "<host>")
    .trim();
}
function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
