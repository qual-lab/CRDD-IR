import { createHash } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { CrddIr } from "./model.ts";
import type { AssetDefinition } from "./extensions/assets-model.ts";
import type { GeneratedFile } from "./unreal.ts";

export const ASSET_EXTENSION_ID = "crdd.3d-assets";
export const ASSET_EXTENSION_PROTOCOL = "crdd-ir/3d-assets-v0.1";

export function generateAssets(ir: CrddIr): GeneratedFile[] {
  const assets = getAssetDefinitions(ir);
  if (assets.length === 0) return [];
  return [
    ...assets.flatMap((asset) =>
      asset.type === "box" ? generateBox(asset) : generateCylinder(asset)
    ),
    generated(
      "assets.manifest.json",
      `${JSON.stringify(
        {
          protocol: "crdd-ir/assets-v0.2",
          operation: ir.operation.id,
          coordinateSystem: "right-handed-z-up",
          units: { distance: "cm", angle: "deg" },
          scene: { id: `${ir.operation.id}Scene` },
          assets: assets.map((asset) => ({
            id: asset.id,
            source: `${asset.id}.generated.obj`,
            previewScene: `${asset.id}Scene`,
            dimensions: {
              length: metersToCentimeters(asset.dimensions.length.value),
              width: metersToCentimeters(asset.dimensions.width.value),
              height: metersToCentimeters(asset.dimensions.height.value),
            },
            collision: structuredClone(asset.collision),
            lod: structuredClone(asset.lod),
            placement: {
              location: {
                x: metersToCentimeters(asset.placement.location.x.value),
                y: metersToCentimeters(asset.placement.location.y.value),
                z: metersToCentimeters(asset.placement.location.z.value),
              },
              rotation: {
                pitch: asset.placement.rotation.pitch.value,
                yaw: asset.placement.rotation.yaw.value,
                roll: asset.placement.rotation.roll.value,
              },
            },
            traces: asset.traces,
          })),
        },
        null,
        2,
      )}\n`,
    ),
  ];
}

export function getAssetDefinitions(ir: CrddIr): AssetDefinition[] {
  const extension = ir.operation.extensions?.[ASSET_EXTENSION_ID];
  if (extension !== undefined) {
    if (extension.protocol !== ASSET_EXTENSION_PROTOCOL) {
      throw new Error(
        `Unsupported ${ASSET_EXTENSION_ID} protocol "${extension.protocol}"`,
      );
    }
    if (!isRecord(extension.data) || !Array.isArray(extension.data.assets)) {
      throw new Error(`${ASSET_EXTENSION_ID}.data.assets must be an array`);
    }
    validateAssetDefinitions(extension.data.assets);
    return extension.data.assets as AssetDefinition[];
  }

  return [];
}

function validateAssetDefinitions(value: unknown[]): void {
  const ids = new Set<string>();
  for (const [index, asset] of value.entries()) {
    const path = `${ASSET_EXTENSION_ID}.data.assets[${index}]`;
    if (!isRecord(asset)) throw new Error(`${path} must be an object`);
    if (typeof asset.id !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(asset.id)) {
      throw new Error(`${path}.id must be a portable generated-code identifier`);
    }
    if (ids.has(asset.id)) throw new Error(`${path}.id duplicates "${asset.id}"`);
    ids.add(asset.id);
    if (asset.type !== "box" && asset.type !== "cylinder") {
      throw new Error(`${path}.type must equal "box" or "cylinder"`);
    }
    if (!isRecord(asset.dimensions)) throw new Error(`${path}.dimensions must be an object`);
    for (const axis of ["length", "width", "height"]) {
      const dimension = asset.dimensions[axis];
      if (!isRecord(dimension) || typeof dimension.value !== "number" || dimension.value <= 0) {
        throw new Error(`${path}.dimensions.${axis}.value must be greater than zero`);
      }
      if (dimension.unit !== "m") throw new Error(`${path}.dimensions.${axis}.unit must equal "m"`);
    }
    if (!isRecord(asset.material) || !Array.isArray(asset.material.baseColor) ||
        asset.material.baseColor.length !== 3 ||
        asset.material.baseColor.some((item) => typeof item !== "number" || item < 0 || item > 1)) {
      throw new Error(`${path}.material.baseColor must contain three numbers from 0 to 1`);
    }
    if (!isRecord(asset.collision) ||
        !["box", "capsule", "sphere", "ndop26"].includes(String(asset.collision.shape))) {
      throw new Error(`${path}.collision.shape is unsupported`);
    }
    if (!isRecord(asset.lod) ||
        !["None", "SmallProp", "LargeProp", "LevelArchitecture"].includes(String(asset.lod.group))) {
      throw new Error(`${path}.lod.group is unsupported`);
    }
    validatePlacement(asset.placement, `${path}.placement`);
    if (!Array.isArray(asset.traces) || asset.traces.some((trace) => typeof trace !== "string")) {
      throw new Error(`${path}.traces must be an array of strings`);
    }
  }
}

function validatePlacement(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const [groupName, fields, unit] of [
    ["location", ["x", "y", "z"], "m"],
    ["rotation", ["pitch", "yaw", "roll"], "deg"],
  ] as const) {
    const group = value[groupName];
    if (!isRecord(group)) throw new Error(`${path}.${groupName} must be an object`);
    for (const field of fields) {
      const component = group[field];
      if (!isRecord(component) || typeof component.value !== "number" ||
          !Number.isFinite(component.value) || component.unit !== unit) {
        throw new Error(`${path}.${groupName}.${field} must be a finite ${unit} value`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function removeStaleGeneratedAssets(
  outDir: string,
  expected: Set<string>,
): Promise<void> {
  const entries = await readdir(outDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      (entry.name.endsWith(".generated.obj") || entry.name.endsWith(".generated.mtl")) &&
      !expected.has(entry.name)
    ) {
      const path = resolve(outDir, entry.name);
      await unlink(path);
      console.log(`Removed stale generated asset ${path}`);
    }
  }
}

function generateBox(asset: AssetDefinition): GeneratedFile[] {
  if (asset.type !== "box") throw new Error(`Unsupported 3D asset type "${asset.type}"`);
  const length = metersToCentimeters(asset.dimensions.length.value);
  const width = metersToCentimeters(asset.dimensions.width.value);
  const height = metersToCentimeters(asset.dimensions.height.value);
  const x = length / 2;
  const y = width / 2;
  const materialName = `${asset.id}Material`;
  const traces = asset.traces.map((trace) => `# CRDD-TRACE: ${trace}`).join("\n");

  const obj = `${traces}
# Generated by crdd-ir. Units: centimeters. Do not edit.
mtllib ${asset.id}.generated.mtl
o ${asset.id}
usemtl ${materialName}
v ${n(-x)} ${n(-y)} 0
v ${n(x)} ${n(-y)} 0
v ${n(x)} ${n(y)} 0
v ${n(-x)} ${n(y)} 0
v ${n(-x)} ${n(-y)} ${n(height)}
v ${n(x)} ${n(-y)} ${n(height)}
v ${n(x)} ${n(y)} ${n(height)}
v ${n(-x)} ${n(y)} ${n(height)}
vt 0 0
vt 1 0
vt 1 1
vt 0 1
f 1/1 4/4 3/3 2/2
f 5/1 6/2 7/3 8/4
f 1/1 2/2 6/3 5/4
f 2/1 3/2 7/3 6/4
f 3/1 4/2 8/3 7/4
f 4/1 1/2 5/3 8/4
`;
  const [red, green, blue] = asset.material.baseColor;
  const mtl = `${traces}
# Generated by crdd-ir. Do not edit.
newmtl ${materialName}
Ka 0 0 0
Kd ${n(red)} ${n(green)} ${n(blue)}
Ks 0 0 0
d 1
illum 1
`;

  return [
    generated(`${asset.id}.generated.obj`, obj),
    generated(`${asset.id}.generated.mtl`, mtl),
  ];
}

function generateCylinder(asset: AssetDefinition): GeneratedFile[] {
  if (asset.type !== "cylinder") throw new Error(`Asset "${asset.id}" is not a cylinder`);
  const segments = 24;
  const radiusX = metersToCentimeters(asset.dimensions.length.value) / 2;
  const radiusY = metersToCentimeters(asset.dimensions.width.value) / 2;
  const height = metersToCentimeters(asset.dimensions.height.value);
  const materialName = `${asset.id}Material`;
  const traces = asset.traces.map((trace) => `# CRDD-TRACE: ${trace}`).join("\n");
  const vertices: string[] = [];
  const textureCoordinates: string[] = [];
  const normals: string[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    vertices.push(`v ${n(x)} ${n(y)} 0`, `v ${n(x)} ${n(y)} ${n(height)}`);
    textureCoordinates.push(
      `vt ${n(index / segments)} 0`,
      `vt ${n(index / segments)} 1`,
    );
    const normalLength = Math.hypot(
      Math.cos(angle) / Math.max(radiusX, Number.EPSILON),
      Math.sin(angle) / Math.max(radiusY, Number.EPSILON),
    );
    normals.push(
      `vn ${n(Math.cos(angle) / radiusX / normalLength)} ` +
      `${n(Math.sin(angle) / radiusY / normalLength)} 0`,
    );
  }
  const bottomCenter = segments * 2 + 1;
  const topCenter = bottomCenter + 1;
  vertices.push("v 0 0 0", `v 0 0 ${n(height)}`);
  const bottomCenterUv = segments * 2 + 1;
  const topCenterUv = bottomCenterUv + 1;
  textureCoordinates.push("vt 0.5 0.5", "vt 0.5 0.5");
  const bottomNormal = segments + 1;
  const topNormal = segments + 2;
  normals.push("vn 0 0 -1", "vn 0 0 1");

  const faces: string[] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const bottom = index * 2 + 1;
    const top = bottom + 1;
    const nextBottom = next * 2 + 1;
    const nextTop = nextBottom + 1;
    const normal = index + 1;
    const nextNormal = next + 1;
    faces.push(
      `f ${bottom}/${bottom}/${normal} ${top}/${top}/${normal} ` +
      `${nextTop}/${nextTop}/${nextNormal} ${nextBottom}/${nextBottom}/${nextNormal}`,
      `f ${bottomCenter}/${bottomCenterUv}/${bottomNormal} ` +
      `${nextBottom}/${nextBottom}/${bottomNormal} ${bottom}/${bottom}/${bottomNormal}`,
      `f ${topCenter}/${topCenterUv}/${topNormal} ` +
      `${top}/${top}/${topNormal} ${nextTop}/${nextTop}/${topNormal}`,
    );
  }

  const obj = `${traces}
# Generated by crdd-ir. Units: centimeters. Do not edit.
mtllib ${asset.id}.generated.mtl
o ${asset.id}
usemtl ${materialName}
${vertices.join("\n")}
${textureCoordinates.join("\n")}
${normals.join("\n")}
${faces.join("\n")}
`;
  const [red, green, blue] = asset.material.baseColor;
  const mtl = `${traces}
# Generated by crdd-ir. Do not edit.
newmtl ${materialName}
Ka 0 0 0
Kd ${n(red)} ${n(green)} ${n(blue)}
Ks 0 0 0
d 1
illum 1
`;
  return [
    generated(`${asset.id}.generated.obj`, obj),
    generated(`${asset.id}.generated.mtl`, mtl),
  ];
}

function generated(name: string, content: string): GeneratedFile {
  return {
    name,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function metersToCentimeters(value: number): number {
  return value * 100;
}

function n(value: number): string {
  return Number(value.toFixed(6)).toString();
}
