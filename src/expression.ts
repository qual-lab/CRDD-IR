import { parseSourceExpression, type ExpressionNode } from "./source-expression.ts";

type Context = Record<string, unknown>;

export function evaluateExpression(expression: string, context: Context): unknown {
  return evaluateNode(parseSourceExpression(expression), context);
}

function evaluateNode(node: ExpressionNode, context: Context): unknown {
  if (node.kind === "reference") return getPath(context, node.path);
  if (node.kind === "literal") return node.value;
  if (node.kind === "unary") {
    const value = evaluateNode(node.operand, context);
    if (node.operator === "!") {
      if (typeof value !== "boolean") throw new Error("Operator ! requires a boolean operand");
      return !value;
    }
    if (typeof value !== "number") throw new Error("Unary - requires a numeric operand");
    return -value;
  }
  if (node.kind === "quantifier") {
    const collection = evaluateNode(node.collection, context);
    const items = Array.isArray(collection)
      ? collection
      : typeof collection === "object" && collection !== null
        ? Object.values(collection)
        : undefined;
    if (!items) throw new Error(`${node.operator} requires an array or map`);
    const evaluateItem = (item: unknown) => {
      const scopedItem = typeof item === "object" && item !== null && !Array.isArray(item)
        ? item
        : { value: item };
      const result = evaluateNode(node.predicate, { ...context, item: scopedItem });
      if (typeof result !== "boolean") throw new Error(`${node.operator} predicate must evaluate to boolean`);
      return result;
    };
    return node.operator === "all" ? items.every(evaluateItem) : items.some(evaluateItem);
  }
  if (node.kind === "aggregate") {
    const items = collectionItems(evaluateNode(node.collection, context), node.operator);
    let total = 0;
    for (const item of items) {
      const scoped = { ...context, [node.alias]: scopedItem(item) };
      if (evaluateNode(node.predicate, scoped) !== true) continue;
      if (node.operator === "count") total = checkedAdd(total, 1);
      else {
        const value = evaluateNode(node.value!, scoped);
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("sum value must be finite numeric");
        total = checkedAdd(total, value);
      }
    }
    return total;
  }
  if (node.kind === "joinAggregate") {
    const left = collectionItems(evaluateNode(node.leftCollection, context), node.operator);
    const right = collectionItems(evaluateNode(node.rightCollection, context), node.operator);
    let total = 0;
    for (const leftItem of left) for (const rightItem of right) {
      const scoped = { ...context, [node.leftAlias]: scopedItem(leftItem), [node.rightAlias]: scopedItem(rightItem) };
      if (evaluateNode(node.predicate, scoped) !== true) continue;
      if (node.operator === "join_count") total = checkedAdd(total, 1);
      else {
        const value = evaluateNode(node.value!, scoped);
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("join_sum value must be finite numeric");
        total = checkedAdd(total, value);
      }
    }
    return total;
  }

  const left = evaluateNode(node.left, context);
  const right = evaluateNode(node.right, context);
  if (node.operator === "&&" || node.operator === "||") {
    if (typeof left !== "boolean" || typeof right !== "boolean") {
      throw new Error(`Operator ${node.operator} requires boolean operands`);
    }
    return node.operator === "&&" ? left && right : left || right;
  }
  if (["+", "-", "*", "/"].includes(node.operator)) {
    if (typeof left !== "number" || typeof right !== "number") {
      throw new Error(`Operator ${node.operator} requires numeric operands`);
    }
    if (node.operator === "+") return checkedAdd(left, right);
    if (node.operator === "-") return checkedAdd(left, -right);
    if (node.operator === "*") {
      const result = left * right;
      if (!Number.isFinite(result) || (Number.isInteger(left) && Number.isInteger(right) && !Number.isSafeInteger(result))) throw new Error("arithmetic overflow");
      return result;
    }
    if (right === 0) throw new Error("division by zero");
    return left / right;
  }
  return compare(node.operator, left, right);
}

function collectionItems(value: unknown, operator: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) return Object.values(value);
  throw new Error(`${operator} requires an array or map`);
}

function scopedItem(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value };
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isFinite(result) || (Number.isInteger(left) && Number.isInteger(right) && !Number.isSafeInteger(result))) {
    throw new Error("aggregate overflow");
  }
  return result;
}

export function extractReferences(expression: string): string[] {
  return [...expression.matchAll(/\b(?:input|state|previous|item)\.[A-Za-z_][A-Za-z0-9_.]*/g)].map(
    (match) => match[0],
  );
}

function compare(operator: string, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">=": return (left as number) >= (right as number);
    case "<=": return (left as number) <= (right as number);
    case ">": return (left as number) > (right as number);
    case "<": return (left as number) < (right as number);
    default: throw new Error(`Unsupported operator ${operator}`);
  }
}

export function getPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null || !(part in current)) {
      throw new Error(`Unknown reference "${path}"`);
    }
    return (current as Record<string, unknown>)[part];
  }, root);
}
