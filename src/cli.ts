#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { DiagnosticError, diagnosticEnvelope, unexpectedDiagnostic } from "./diagnostics.ts";
import { runDoctor } from "./doctor.ts";
import { loadAdapter } from "./adapter.ts";
import { generateAssets } from "./assets.ts";
import { generateBatch, type BatchTarget } from "./batch.ts";
import { compileMarkdown } from "./compiler.ts";
import { generateConformanceBundle } from "./conformance.ts";
import { formatDiagnostics, loadIr, validateIr } from "./ir.ts";
import { createProcessAdapter } from "./process-adapter.ts";
import { loadProjectConfig } from "./project-config.ts";
import { simulate } from "./simulator.ts";
import { generateTestManifest } from "./test-manifest.ts";
import { runTestManifest } from "./test-runner.ts";
import { generateEvidenceMarkdown, generateTraceabilityManifest } from "./traceability.ts";
import { generateTransactionally } from "./generation.ts";
import { generateUnreal } from "./unreal.ts";
import { parseUnrealAutomationReport } from "./unreal-report.ts";
import type { SimulationRequest, TestManifest } from "./model.ts";

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  if (args.includes("--format") && option(args, "--format") === "json") {
    const diagnostics = error instanceof DiagnosticError
      ? error.diagnostics
      : [unexpectedDiagnostic(error)];
    const source = error instanceof DiagnosticError ? error.source : undefined;
    console.log(JSON.stringify(diagnosticEnvelope(diagnostics, source), null, 2));
  } else {
    console.error((error as Error).message);
  }
  process.exitCode = 1;
}

async function main(argv: string[]): Promise<void> {
  const [command, subcommand] = argv;
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "lint") {
    const path = required(argv[1], "IR file");
    if (extname(path).toLowerCase() === ".md") {
      const compilation = await compileMarkdown(path);
      console.log(`OK ${path}`);
      console.log(`IR SHA-256 ${compilation.digest}`);
      return;
    }
    const raw = JSON.parse(await readFile(path, "utf8"));
    const diagnostics = validateIr(raw);
    if (option(argv, "--format") === "json") {
      console.log(JSON.stringify({
        protocol: "crdd-ir/diagnostics-v0.1",
        ok: !diagnostics.some((item) => item.severity === "error"),
        source: path,
        diagnostics,
      }, null, 2));
      if (diagnostics.some((item) => item.severity === "error")) process.exitCode = 1;
      return;
    }
    if (diagnostics.length === 0) {
      console.log(`OK ${path}`);
      return;
    }
    console.log(formatDiagnostics(diagnostics));
    if (diagnostics.some((item) => item.severity === "error")) process.exitCode = 1;
    return;
  }

  if (command === "compile") {
    const sourcePath = required(argv[1], "CRDD Markdown file");
    const compilation = await compileMarkdown(sourcePath);
    const out = option(argv, "--out");
    if (out) {
      await writeText(out, compilation.canonicalJson);
      console.log(`Generated ${out}`);
    } else {
      process.stdout.write(compilation.canonicalJson);
    }
    console.error(`IR SHA-256 ${compilation.digest}`);
    return;
  }

  if (command === "batch") {
    const target = required(argv[1], "batch target") as BatchTarget;
    if (!["ir", "unreal", "assets"].includes(target)) {
      throw new Error(`Unsupported batch target: ${target}`);
    }
    const outDir = option(argv, "--out-dir") ?? `generated/batch/${target}`;
    const sources = operandsAfter(argv, 2);
    const manifest = await generateBatch(sources, outDir, target, {
      layout: argv.includes("--flat") ? "flat" : "operation-directories",
      force: argv.includes("--force"),
    });
    console.log(`Generated ${manifest.operations.length} operation(s) in ${resolve(outDir)}`);
    return;
  }

  if (command === "check") {
    const sourcePath = required(argv[1], "CRDD Markdown file");
    const compilation = await compileMarkdown(sourcePath);
    if (option(argv, "--format") === "json") {
      console.log(JSON.stringify({
        protocol: "crdd-ir/diagnostics-v0.1",
        ok: true,
        source: sourcePath,
        diagnostics: [],
        digest: compilation.digest,
      }, null, 2));
      return;
    }
    console.log(`OK ${sourcePath}`);
    console.log(`IR SHA-256 ${compilation.digest}`);
    return;
  }

  if (command === "project" && subcommand === "check") {
    const configPath = required(argv[2], "project config file");
    await loadProjectConfig(configPath);
    console.log(`OK ${configPath}`);
    return;
  }

  if (command === "project" && subcommand === "doctor") {
    const configPath = required(argv[2], "project config file");
    const report = await runDoctor(configPath);
    if (option(argv, "--format") === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.table(report.checks.map((check) => ({
        status: check.status.toUpperCase(),
        code: check.code,
        message: check.message,
        path: check.path ?? "",
      })));
      console.log(report.ok ? "Project is ready." : "Project is not ready.");
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "simulate") {
    const irPath = required(argv[1], "IR file");
    const inputPath = option(argv, "--input");
    if (!inputPath) throw new Error("Missing --input <file>");
    const ir = await loadInput(irPath);
    const request = JSON.parse(await readFile(inputPath, "utf8")) as SimulationRequest;
    console.log(JSON.stringify(simulate(ir, request), null, 2));
    return;
  }

  if (command === "test" && subcommand === "generate") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const out = option(argv, "--out") ?? `generated/${fileSlug(ir.operation.id)}.test-manifest.json`;
    await writeJson(out, generateTestManifest(ir));
    console.log(`Generated ${out}`);
    return;
  }

  if (command === "test" && subcommand === "bundle") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const manifestPath = option(argv, "--manifest");
    const manifest = manifestPath
      ? JSON.parse(await readFile(manifestPath, "utf8")) as TestManifest
      : generateTestManifest(ir);
    const out = option(argv, "--out") ?? `generated/${fileSlug(ir.operation.id)}.conformance.json`;
    await writeJson(out, generateConformanceBundle(ir, manifest));
    console.log(`Generated ${out}`);
    return;
  }

  if (command === "test" && subcommand === "run") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const manifestPath = option(argv, "--manifest");
    const manifest = manifestPath
      ? JSON.parse(await readFile(manifestPath, "utf8")) as TestManifest
      : generateTestManifest(ir);
    const adapterPath = option(argv, "--adapter");
    const processCommand = option(argv, "--command");
    if (adapterPath && processCommand) throw new Error("Use either --adapter or --command, not both");
    const timeoutMs = numberOption(argv, "--timeout-ms") ?? 5_000;
    const adapter = adapterPath
      ? await loadAdapter(adapterPath)
      : processCommand
        ? createProcessAdapter({
            command: processCommand,
            args: options(argv, "--arg"),
            operation: ir.operation.id,
            timeoutMs,
          })
        : undefined;
    const report = await runTestManifest(ir, manifest, adapter);
    console.log(`Adapter: ${adapter?.name ?? "reference-simulator"}`);
    console.table(
      report.results.map((result) => ({
        status: result.passed ? "PASS" : "FAIL",
        case: result.id,
        message: result.message,
      })),
    );
    console.log(`${report.passed}/${report.total} contract tests passed`);
    if (report.failed > 0) process.exitCode = 1;
    return;
  }

  if (command === "generate" && subcommand === "unreal") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const outDir = option(argv, "--out-dir") ?? "generated/unreal";
    await runGeneration(outDir, generateUnreal(ir), argv);
    return;
  }

  if (command === "generate" && subcommand === "assets") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const outDir = option(argv, "--out-dir") ?? "generated/assets";
    const files = generateAssets(ir);
    if (files.length === 0) throw new Error(`Operation "${ir.operation.id}" declares no assets`);
    await runGeneration(outDir, files, argv);
    return;
  }

  if (command === "generate" && subcommand === "evidence") {
    const sourcePath = required(argv[2], "CRDD Markdown file");
    if (extname(sourcePath).toLowerCase() !== ".md") {
      throw new Error("Evidence generation requires CRDD Markdown source");
    }
    const compilation = await compileMarkdown(sourcePath);
    const testManifest = generateTestManifest(compilation.ir);
    const bundle = generateConformanceBundle(compilation.ir, testManifest);
    const generatedFiles = generateUnreal(compilation.ir);
    const assetFiles = generateAssets(compilation.ir);
    const unrealReportPath = option(argv, "--unreal-report");
    const execution = unrealReportPath
      ? parseUnrealAutomationReport(await readFile(unrealReportPath, "utf8"), compilation.ir.operation.id)
      : undefined;
    const traceability = generateTraceabilityManifest(
      compilation.ir,
      sourcePath,
      compilation.digest,
      generatedFiles,
      testManifest,
      bundle,
      execution,
      assetFiles,
    );
    const outDir = option(argv, "--out-dir") ?? "07_Quality/CRDD_IR";
    if (execution) await writeJson(resolve(outDir, "unreal-execution.json"), execution);
    await writeJson(resolve(outDir, "traceability.manifest.json"), traceability);
    await writeText(resolve(outDir, "evidence.md"), generateEvidenceMarkdown(traceability));
    console.log(`Generated ${resolve(outDir, "traceability.manifest.json")}`);
    console.log(`Generated ${resolve(outDir, "evidence.md")}`);
    if (execution) console.log(`Generated ${resolve(outDir, "unreal-execution.json")}`);
    if (execution && (execution.summary.failed > 0 || execution.summary.notRun > 0)) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "view" && subcommand === "trace") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadInput(irPath);
    const rows = [
      ...ir.operation.traces.map((trace) => ({ artifact: ir.operation.id, trace })),
      ...ir.operation.errors.flatMap((error) =>
        error.traces.map((trace) => ({ artifact: `error:${error.code}`, trace })),
      ),
    ];
    console.table(rows);
    return;
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function runGeneration(
  outDir: string,
  files: ReturnType<typeof generateUnreal>,
  argv: string[],
): Promise<void> {
  const changes = await generateTransactionally({
    outDir,
    files,
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  });
  console.table(changes);
  if (argv.includes("--dry-run")) {
    if (changes.some((change) => change.action === "conflict")) process.exitCode = 1;
    return;
  }
  console.log(`Generated ${files.length} file(s) in ${resolve(outDir)}`);
}

async function loadInput(path: string) {
  return extname(path).toLowerCase() === ".md"
    ? (await compileMarkdown(path)).ir
    : loadIr(path);
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function options(argv: string[], name: string): string[] {
  return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
}

function numberOption(argv: string[], name: string): number | undefined {
  const value = option(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function operandsAfter(argv: string[], start: number): string[] {
  const result: string[] = [];
  for (let index = start; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) {
      if (!["--flat", "--force"].includes(argv[index])) index += 1;
      continue;
    }
    result.push(argv[index]);
  }
  return result;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
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

function printHelp(): void {
  console.log(`crdd-ir

Commands:
  compile <spec.md> [--out <debug-ir.json>]
  batch <ir|unreal|assets> <spec.md>... [--out-dir <directory>] [--flat] [--force]
  check <spec.md> [--format json]
  project check <crdd-ir.config.json>
  project doctor <crdd-ir.config.json> [--format json]
  lint <ir.json> [--format json]
  simulate <ir.json> --input <input.json>
  test generate <ir.json> [--out <file>]
  test bundle <ir.json> [--manifest <file>] [--out <file>]
  test run <ir.json> [--manifest <file>] [--adapter <module>]
                                      [--command <executable> [--arg <value>...]]
                                      [--timeout-ms <milliseconds>]
  generate unreal <ir.json> [--out-dir <directory>] [--dry-run] [--force]
  generate assets <ir.json> [--out-dir <directory>] [--dry-run] [--force]
  generate evidence <spec.md> [--out-dir <directory>] [--unreal-report <index.json>]
  view trace <ir.json>`);
}
