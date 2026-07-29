import { readFile } from "node:fs/promises";

export const PROJECT_CONFIG_PROTOCOL = "crdd-ir/project-config-v0.2";

export interface ProjectTargetConfig {
  output: string;
  profile?: string;
  options?: Record<string, unknown>;
}

export interface ProjectConfig {
  protocol: typeof PROJECT_CONFIG_PROTOCOL;
  toolRoot: string;
  sources: string[];
  evidence: string;
  targets: Record<string, ProjectTargetConfig>;
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
  const config = record(value, "config");
  rejectUnknown(config, ["protocol", "toolRoot", "sources", "evidence", "targets"], "config");
  if (config.protocol !== PROJECT_CONFIG_PROTOCOL) {
    throw new Error(`config.protocol must be "${PROJECT_CONFIG_PROTOCOL}"`);
  }
  projectPath(config.toolRoot, "config.toolRoot");
  projectPath(config.evidence, "config.evidence");
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error("config.sources must be a non-empty array");
  }
  config.sources.forEach((source, index) => projectPath(source, `config.sources[${index}]`));
  if (new Set(config.sources).size !== config.sources.length) {
    throw new Error("config.sources must not contain duplicates");
  }

  const targets = record(config.targets, "config.targets");
  if (Object.keys(targets).length === 0) throw new Error("config.targets must not be empty");
  for (const [id, rawTarget] of Object.entries(targets)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`config.targets.${id} has an invalid target ID`);
    const target = record(rawTarget, `config.targets.${id}`);
    rejectUnknown(target, ["output", "profile", "options"], `config.targets.${id}`);
    projectPath(target.output, `config.targets.${id}.output`);
    if (target.profile !== undefined) projectPath(target.profile, `config.targets.${id}.profile`);
    if (target.options !== undefined) record(target.options, `config.targets.${id}.options`);
  }
  return value as ProjectConfig;
}

function projectPath(value: unknown, path: string): string {
  const result = string(value, path);
  if (/^[A-Za-z]:[\\/]/.test(result) || /^[\\/]/.test(result)) {
    throw new Error(`${path} must be relative to the project root`);
  }
  if (result.split(/[\\/]/).includes("..")) throw new Error(`${path} must not escape the project root`);
  return result;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function record(value: unknown, path: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, any>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown field(s): ${unknown.join(", ")}`);
}
