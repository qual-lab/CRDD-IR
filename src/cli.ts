#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { formatDiagnostics, loadIr, validateIr } from "./ir.ts";
import { simulate } from "./simulator.ts";
import { generateTestManifest } from "./test-manifest.ts";
import { generateUnreal } from "./unreal.ts";
import type { SimulationRequest } from "./model.ts";

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  console.error((error as Error).message);
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
    const raw = JSON.parse(await readFile(path, "utf8"));
    const diagnostics = validateIr(raw);
    if (diagnostics.length === 0) {
      console.log(`OK ${path}`);
      return;
    }
    console.log(formatDiagnostics(diagnostics));
    if (diagnostics.some((item) => item.severity === "error")) process.exitCode = 1;
    return;
  }

  if (command === "simulate") {
    const irPath = required(argv[1], "IR file");
    const inputPath = option(argv, "--input");
    if (!inputPath) throw new Error("Missing --input <file>");
    const ir = await loadIr(irPath);
    const request = JSON.parse(await readFile(inputPath, "utf8")) as SimulationRequest;
    console.log(JSON.stringify(simulate(ir, request), null, 2));
    return;
  }

  if (command === "test" && subcommand === "generate") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadIr(irPath);
    const out = option(argv, "--out") ?? "generated/place-wall.test-manifest.json";
    await writeJson(out, generateTestManifest(ir));
    console.log(`Generated ${out}`);
    return;
  }

  if (command === "generate" && subcommand === "unreal") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadIr(irPath);
    const outDir = option(argv, "--out-dir") ?? "generated/unreal";
    await mkdir(outDir, { recursive: true });
    for (const file of generateUnreal(ir)) {
      const path = resolve(outDir, file.name);
      await writeFile(path, file.content, "utf8");
      console.log(`Generated ${path}`);
    }
    return;
  }

  if (command === "view" && subcommand === "trace") {
    const irPath = required(argv[2], "IR file");
    const ir = await loadIr(irPath);
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

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function printHelp(): void {
  console.log(`crdd-ir

Commands:
  lint <ir.json>
  simulate <ir.json> --input <input.json>
  test generate <ir.json> [--out <file>]
  generate unreal <ir.json> [--out-dir <directory>]
  view trace <ir.json>`);
}
