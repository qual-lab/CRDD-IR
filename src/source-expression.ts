import type { FieldDefinition } from "./model.ts";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.ts";

type Token =
  | { kind: "reference"; value: string; offset: number }
  | { kind: "number"; value: number; unit?: string; offset: number }
  | { kind: "string"; value: string; offset: number }
  | { kind: "boolean"; value: boolean; offset: number }
  | { kind: "operator"; value: string; offset: number }
  | { kind: "paren"; value: "(" | ")"; offset: number };

export type ExpressionNode =
  | { kind: "reference"; path: string }
  | { kind: "literal"; value: number | string | boolean; unit?: string }
  | { kind: "unary"; operator: "!" | "-"; operand: ExpressionNode }
  | { kind: "binary"; operator: string; left: ExpressionNode; right: ExpressionNode };

type ValueType = {
  kind: "number" | "boolean" | "string" | "array";
  unit?: string;
};

export function normalizeSourceExpression(
  expression: string,
  fields: Record<string, FieldDefinition>,
  unitRegistry: UnitRegistry = defaultUnitRegistry,
): string {
  const ast = parseSourceExpression(expression);
  inferAndNormalize(ast, fields, unitRegistry);
  return printExpression(ast);
}

export function parseSourceExpression(expression: string): ExpressionNode {
  const tokens = tokenize(expression);
  let cursor = 0;

  function parseOr(): ExpressionNode {
    let left = parseAnd();
    while (tokens[cursor]?.kind === "operator" && tokens[cursor].value === "||") {
      cursor += 1;
      left = { kind: "binary", operator: "||", left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd(): ExpressionNode {
    let left = parseComparison();
    while (tokens[cursor]?.kind === "operator" && tokens[cursor].value === "&&") {
      cursor += 1;
      left = { kind: "binary", operator: "&&", left, right: parseComparison() };
    }
    return left;
  }

  function parseComparison(): ExpressionNode {
    let left = parseAdditive();
    const token = tokens[cursor];
    if (token?.kind === "operator" && ["==", "!=", ">", ">=", "<", "<="].includes(token.value)) {
      cursor += 1;
      left = { kind: "binary", operator: token.value, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive(): ExpressionNode {
    let left = parseUnary();
    while (tokens[cursor]?.kind === "operator" && ["+", "-"].includes(tokens[cursor].value)) {
      const operator = tokens[cursor++].value;
      left = { kind: "binary", operator, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary(): ExpressionNode {
    const token = tokens[cursor];
    if (token?.kind === "operator" && (token.value === "!" || token.value === "-")) {
      cursor += 1;
      return { kind: "unary", operator: token.value, operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): ExpressionNode {
    const token = tokens[cursor++];
    if (!token) throw syntaxError(expression, expression.length, "unexpected end of expression");
    if (token.kind === "reference") return { kind: "reference", path: token.value };
    if (token.kind === "number") return { kind: "literal", value: token.value, unit: token.unit };
    if (token.kind === "string" || token.kind === "boolean") {
      return { kind: "literal", value: token.value };
    }
    if (token.kind === "paren" && token.value === "(") {
      const nested = parseOr();
      const closing = tokens[cursor++];
      if (closing?.kind !== "paren" || closing.value !== ")") {
        throw syntaxError(expression, token.offset, "missing closing parenthesis");
      }
      return nested;
    }
    throw syntaxError(expression, token.offset, `unexpected token "${token.value}"`);
  }

  const ast = parseOr();
  if (cursor !== tokens.length) {
    throw syntaxError(expression, tokens[cursor].offset, `unexpected token "${tokens[cursor].value}"`);
  }
  return ast;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const operator = rest.match(/^(&&|\|\||>=|<=|==|!=|>|<|\+|-|!)/);
    if (operator) {
      tokens.push({ kind: "operator", value: operator[1], offset });
      offset += operator[1].length;
      continue;
    }
    const numeric = rest.match(/^(\d+(?:\.\d+)?)([A-Za-z][A-Za-z0-9]*)?/);
    if (numeric) {
      tokens.push({
        kind: "number",
        value: Number(numeric[1]),
        ...(numeric[2] ? { unit: numeric[2] } : {}),
        offset,
      });
      offset += numeric[0].length;
      continue;
    }
    const stringLiteral = rest.match(/^"(?:[^"\\]|\\.)*"/);
    if (stringLiteral) {
      tokens.push({ kind: "string", value: JSON.parse(stringLiteral[0]), offset });
      offset += stringLiteral[0].length;
      continue;
    }
    const booleanLiteral = rest.match(/^(true|false)\b/);
    if (booleanLiteral) {
      tokens.push({ kind: "boolean", value: booleanLiteral[1] === "true", offset });
      offset += booleanLiteral[0].length;
      continue;
    }
    const reference = rest.match(/^(?:input|state)\.[A-Za-z_][A-Za-z0-9_.]*/);
    if (reference) {
      tokens.push({ kind: "reference", value: reference[0], offset });
      offset += reference[0].length;
      continue;
    }
    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ kind: "paren", value: rest[0], offset });
      offset += 1;
      continue;
    }
    throw syntaxError(expression, offset, `unsupported syntax near "${rest.slice(0, 20)}"`);
  }
  return tokens;
}

function inferAndNormalize(
  node: ExpressionNode,
  fields: Record<string, FieldDefinition>,
  unitRegistry: UnitRegistry,
): ValueType {
  if (node.kind === "reference") {
    const field = fields[node.path];
    if (!field) throw new Error(`references undefined field "${node.path}"`);
    return { kind: field.type, unit: field.unit };
  }
  if (node.kind === "literal") {
    return { kind: typeof node.value as ValueType["kind"], unit: node.unit };
  }
  if (node.kind === "unary") {
    const operand = inferAndNormalize(node.operand, fields, unitRegistry);
    if (node.operator === "!" && operand.kind !== "boolean") throw new Error("operator ! requires boolean");
    if (node.operator === "-" && operand.kind !== "number") throw new Error("unary - requires number");
    return operand;
  }

  const left = inferAndNormalize(node.left, fields, unitRegistry);
  const right = inferAndNormalize(node.right, fields, unitRegistry);
  if (node.operator === "&&" || node.operator === "||") {
    if (left.kind !== "boolean" || right.kind !== "boolean") {
      throw new Error(`operator ${node.operator} requires boolean operands`);
    }
    return { kind: "boolean" };
  }
  if (["==", "!=", ">", ">=", "<", "<="].includes(node.operator)) {
    normalizePair(node.left, left, node.right, right, unitRegistry);
    if ([">", ">=", "<", "<="].includes(node.operator) && left.kind !== "number") {
      throw new Error(`operator ${node.operator} requires numeric operands`);
    }
    return { kind: "boolean" };
  }
  if (node.operator === "+" || node.operator === "-") {
    normalizePair(node.left, left, node.right, right, unitRegistry);
    return left.unit ? left : right;
  }
  throw new Error(`unsupported operator "${node.operator}"`);
}

function normalizePair(
  leftNode: ExpressionNode,
  left: ValueType,
  rightNode: ExpressionNode,
  right: ValueType,
  unitRegistry: UnitRegistry,
): void {
  if (left.kind !== right.kind) throw new Error(`incompatible types "${left.kind}" and "${right.kind}"`);
  if (left.kind !== "number") return;

  if (left.unit && right.unit) {
    assertCompatibleUnits(left.unit, right.unit, unitRegistry);
    if (leftNode.kind === "literal" && rightNode.kind !== "literal") {
      convertLiteral(leftNode, right.unit, unitRegistry);
    } else if (rightNode.kind === "literal" && leftNode.kind !== "literal") {
      convertLiteral(rightNode, left.unit, unitRegistry);
    } else if (left.unit !== right.unit) {
      throw new Error(`field units "${left.unit}" and "${right.unit}" require explicit normalization`);
    }
  } else if (left.unit && rightNode.kind === "literal") {
    rightNode.unit = left.unit;
  } else if (right.unit && leftNode.kind === "literal") {
    leftNode.unit = right.unit;
  } else if (left.unit !== right.unit) {
    throw new Error(`cannot combine unit "${left.unit ?? "none"}" with "${right.unit ?? "none"}"`);
  }
}

function convertLiteral(
  node: Extract<ExpressionNode, { kind: "literal" }>,
  targetUnit: string,
  unitRegistry: UnitRegistry,
): void {
  if (typeof node.value !== "number") throw new Error("only numeric literals can carry units");
  if (!node.unit) {
    node.unit = targetUnit;
    return;
  }
  assertCompatibleUnits(node.unit, targetUnit, unitRegistry);
  if (node.unit === targetUnit) return;
  node.value = unitRegistry.convert(node.value, node.unit, targetUnit);
  node.unit = targetUnit;
}

function assertCompatibleUnits(left: string, right: string, unitRegistry: UnitRegistry): void {
  if (!unitRegistry.compatible(left, right)) {
    throw new Error(`incompatible units "${left}" and "${right}"`);
  }
}

function printExpression(node: ExpressionNode, parentPrecedence = 0): string {
  if (node.kind === "reference") return node.path;
  if (node.kind === "literal") {
    if (typeof node.value === "number") return canonicalNumber(node.value);
    return JSON.stringify(node.value);
  }
  if (node.kind === "unary") return `${node.operator}${printExpression(node.operand, 5)}`;

  const precedence = operatorPrecedence(node.operator);
  const text = `${printExpression(node.left, precedence)} ${node.operator} ${printExpression(node.right, precedence + 1)}`;
  return precedence < parentPrecedence ? `(${text})` : text;
}

function operatorPrecedence(operator: string): number {
  if (operator === "||") return 1;
  if (operator === "&&") return 2;
  if (["==", "!=", ">", ">=", "<", "<="].includes(operator)) return 3;
  return 4;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("numeric literal must be finite");
  return Object.is(value, -0) ? "0" : value.toString();
}

function syntaxError(expression: string, offset: number, message: string): Error {
  return new Error(`${message} at column ${offset + 1} in "${expression}"`);
}
