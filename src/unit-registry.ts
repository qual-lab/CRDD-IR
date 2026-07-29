export type UnitDefinition = {
  dimension: string;
  factor: number;
};

export class UnitRegistry {
  readonly #definitions: ReadonlyMap<string, UnitDefinition>;

  constructor(definitions: Record<string, UnitDefinition> = {}) {
    for (const [symbol, definition] of Object.entries(definitions)) {
      if (!symbol || !definition.dimension || !Number.isFinite(definition.factor) || definition.factor <= 0) {
        throw new Error(`Invalid unit definition "${symbol}"`);
      }
    }
    this.#definitions = new Map(Object.entries(definitions));
  }

  compatible(left: string, right: string): boolean {
    if (left === right) return true;
    const leftDefinition = this.#definitions.get(left);
    const rightDefinition = this.#definitions.get(right);
    return leftDefinition !== undefined &&
      rightDefinition !== undefined &&
      leftDefinition.dimension === rightDefinition.dimension;
  }

  convert(value: number, from: string, to: string): number {
    if (from === to) return value;
    const fromDefinition = this.#definitions.get(from);
    const toDefinition = this.#definitions.get(to);
    if (!fromDefinition || !toDefinition || fromDefinition.dimension !== toDefinition.dimension) {
      throw new Error(`incompatible units "${from}" and "${to}"`);
    }
    return value * fromDefinition.factor / toDefinition.factor;
  }
}

export const defaultUnitRegistry = new UnitRegistry({
  m: { dimension: "length", factor: 1 },
  cm: { dimension: "length", factor: 0.01 },
  mm: { dimension: "length", factor: 0.001 },
});
