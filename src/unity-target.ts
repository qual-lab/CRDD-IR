export type UnityNumericProjection = {
  csharpType: "int" | "long" | "double";
  jsonRepresentation: "number" | "decimal-string";
  rounding: "reject" | "floor" | "ceil" | "nearest";
  overflow: "error";
};

export type UnityTargetProfile = {
  protocol: "crdd-ir/unity-target-v0.1";
  unityVersion: string;
  namespace: string;
  apiCompatibility: "netstandard2.1";
  scriptingBackend: "mono" | "il2cpp";
  numericProjection?: Record<string, UnityNumericProjection>;
};

export function validateUnityTargetProfile(value: unknown): UnityTargetProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unity target profile must be an object");
  }
  const profile = value as Partial<UnityTargetProfile>;
  if (profile.protocol !== "crdd-ir/unity-target-v0.1") {
    throw new Error('Unity target profile protocol must be "crdd-ir/unity-target-v0.1"');
  }
  if (!profile.unityVersion || !/^\d{4}\.\d+\.\d+[abfp]\d+$/.test(profile.unityVersion)) {
    throw new Error("Unity target profile requires an explicit Unity editor version");
  }
  if (!profile.namespace || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(profile.namespace)) {
    throw new Error("Unity target profile namespace is invalid");
  }
  if (profile.apiCompatibility !== "netstandard2.1") {
    throw new Error('Unity apiCompatibility must be "netstandard2.1"');
  }
  if (!["mono", "il2cpp"].includes(profile.scriptingBackend ?? "")) {
    throw new Error('Unity scriptingBackend must be "mono" or "il2cpp"');
  }
  for (const [unit, projection] of Object.entries(profile.numericProjection ?? {})) {
    if (!unit || !["int", "long", "double"].includes(projection.csharpType)) {
      throw new Error(`Unity numeric projection for "${unit}" has an invalid C# type`);
    }
    if (!["number", "decimal-string"].includes(projection.jsonRepresentation)) {
      throw new Error(`Unity numeric projection for "${unit}" has an invalid JSON representation`);
    }
    if (!["reject", "floor", "ceil", "nearest"].includes(projection.rounding)) {
      throw new Error(`Unity numeric projection for "${unit}" has an invalid rounding policy`);
    }
    if (projection.overflow !== "error") {
      throw new Error(`Unity numeric projection for "${unit}" must use overflow=error`);
    }
  }
  return profile as UnityTargetProfile;
}
