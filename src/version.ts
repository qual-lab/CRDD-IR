import packageMetadata from "../package.json" with { type: "json" };

export const TOOL_VERSION = packageMetadata.version;
