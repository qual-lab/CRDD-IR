export type AssetDefinition = {
  id: string;
  type: "box" | "cylinder";
  dimensions: {
    length: { value: number; unit: "m" };
    width: { value: number; unit: "m" };
    height: { value: number; unit: "m" };
  };
  material: {
    baseColor: [number, number, number];
  };
  collision: {
    shape: "box" | "capsule" | "sphere" | "ndop26";
  };
  lod: {
    group: "None" | "SmallProp" | "LargeProp" | "LevelArchitecture";
  };
  placement: {
    location: {
      x: { value: number; unit: "m" };
      y: { value: number; unit: "m" };
      z: { value: number; unit: "m" };
    };
    rotation: {
      pitch: { value: number; unit: "deg" };
      yaw: { value: number; unit: "deg" };
      roll: { value: number; unit: "deg" };
    };
  };
  traces: string[];
};
