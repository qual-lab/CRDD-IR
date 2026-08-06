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

  const left = evaluateNode(node.left, context);
  const right = evaluateNode(node.right, context);
  if (node.operator === "&&" || node.operator === "||") {
    if (typeof left !== "boolean" || typeof right !== "boolean") {
      throw new Error(`Operator ${node.operator} requires boolean operands`);
    }
    return node.operator === "&&" ? left && right : left || right;
  }
  if (node.operator === "+" || node.operator === "-") {
    if (typeof left !== "number" || typeof right !== "number") {
      throw new Error(`Operator ${node.operator} requires numeric operands`);
    }
    return node.operator === "+" ? left + right : left - right;
  }
  return compare(node.operator, left, right);
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
