import { readFile } from "node:fs/promises";

export const PROJECT_CONFIG_PROTOCOL = "crdd-ir/project-config-v0.1";

const rootKeys = new Set([
  "protocol",
  "toolRoot",
  "source",
  "assetSource",
  "generatedSource",
  "generatedAssets",
  "evidence",
  "unreal",
]);
const unrealKeys = new Set([
  "project",
  "engineRoot",
  "editorTarget",
  "gameTarget",
  "configuration",
  "integrationPlugin",
  "editorProfile",
  "shippingProfile",
]);
const configurations = new Set(["Debug", "DebugGame", "Development", "Shipping", "Test"]);

export interface ProjectConfig {
  protocol: typeof PROJECT_CONFIG_PROTOCOL;
  toolRoot: string;
  source: string | string[];
  assetSource?: string;
  generatedSource: string;
  generatedAssets: string;
  evidence: string;
  unreal: null | {
    project: string;
    engineRoot: string;
    editorTarget: string;
    gameTarget?: string;
    configuration: string;
    integrationPlugin: "CRDDIRIntegration";
    editorProfile: string;
    shippingProfile: string;
  };
}

export async function loadProjectConfig(path: string): Promise<ProjectConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid CRDD-IR project config ${path}: ${(error as Error).message}`);
  }
  return validateProjectConfig(value);
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  const config = object(value, "config");
  rejectUnknown(config, rootKeys, "config");
  if (config.protocol !== PROJECT_CONFIG_PROTOCOL) {
    throw new Error(`config.protocol must be "${PROJECT_CONFIG_PROTOCOL}"`);
  }

  for (const key of ["toolRoot", "generatedSource", "generatedAssets", "evidence"]) {
    projectPath(config[key], `config.${key}`);
  }
  if (Array.isArray(config.source)) {
    if (config.source.length === 0) throw new Error("config.source must not be empty");
    config.source.forEach((source, index) => projectPath(source, `config.source[${index}]`));
    if (new Set(config.source).size !== config.source.length) {
      throw new Error("config.source must not contain duplicates");
    }
  } else {
    projectPath(config.source, "config.source");
  }
  if (config.assetSource !== undefined) {
    projectPath(config.assetSource, "config.assetSource");
    const sources = Array.isArray(config.source) ? config.source : [config.source];
    if (!sources.includes(config.assetSource as string)) {
      throw new Error("config.assetSource must also be listed in config.source");
    }
  }
  if (!Object.hasOwn(config, "unreal")) throw new Error("config.unreal is required");

  if (config.unreal !== null) {
    const unreal = object(config.unreal, "config.unreal");
    rejectUnknown(unreal, unrealKeys, "config.unreal");
    projectPath(unreal.project, "config.unreal.project");
    nonEmpty(unreal.engineRoot, "config.unreal.engineRoot");
    string(unreal.editorTarget, "config.unreal.editorTarget");
    if (unreal.gameTarget !== undefined) {
      nonEmpty(unreal.gameTarget, "config.unreal.gameTarget");
    }
    if (!configurations.has(string(unreal.configuration, "config.unreal.configuration"))) {
      throw new Error("config.unreal.configuration is not supported");
    }
    if (unreal.integrationPlugin !== "CRDDIRIntegration") {
      throw new Error('config.unreal.integrationPlugin must be "CRDDIRIntegration"');
    }
    projectPath(unreal.editorProfile, "config.unreal.editorProfile");
    projectPath(unreal.shippingProfile, "config.unreal.shippingProfile");
  }

  return value as ProjectConfig;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown field(s): ${unknown.join(", ")}`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function nonEmpty(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.trim().length === 0) throw new Error(`${path} must not be empty`);
  return result;
}

function projectPath(value: unknown, path: string): string {
  const result = nonEmpty(value, path).replaceAll("\\", "/");
  if (/^(?:[A-Za-z]:\/|\/|\/\/)/.test(result)) {
    throw new Error(`${path} must be relative to the project root`);
  }
  if (result.split("/").includes("..")) {
    throw new Error(`${path} must not escape the project root`);
  }
  return result;
}
