import type { FieldDefinition } from "./model.ts";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.ts";

type Token =
  | { kind: "reference"; value: string; offset: number }
  | { kind: "number"; value: number; unit?: string; offset: number }
  | { kind: "string"; value: string; offset: number }
  | { kind: "boolean"; value: boolean; offset: number }
  | { kind: "function"; value: "all" | "any" | "count" | "sum" | "join_count" | "join_sum"; offset: number }
  | { kind: "identifier"; value: string; offset: number }
  | { kind: "operator"; value: string; offset: number }
  | { kind: "paren"; value: "(" | ")"; offset: number }
  | { kind: "comma"; value: ","; offset: number };

export type ExpressionNode =
  | { kind: "reference"; path: string }
  | { kind: "literal"; value: number | string | boolean; unit?: string }
  | { kind: "unary"; operator: "!" | "-"; operand: ExpressionNode }
  | { kind: "binary"; operator: string; left: ExpressionNode; right: ExpressionNode }
  | { kind: "quantifier"; operator: "all" | "any"; collection: ExpressionNode; predicate: ExpressionNode }
  | {
      kind: "aggregate";
      operator: "count" | "sum";
      collection: ExpressionNode;
      alias: string;
      value?: ExpressionNode;
      predicate: ExpressionNode;
    }
  | {
      kind: "joinAggregate";
      operator: "join_count" | "join_sum";
      leftCollection: ExpressionNode;
      leftAlias: string;
      rightCollection: ExpressionNode;
      rightAlias: string;
      value?: ExpressionNode;
      predicate: ExpressionNode;
    };

type ValueType = {
  kind: "number" | "boolean" | "string" | "array" | "object" | "map" | "union" | "opaque";
  unit?: string;
  minimum?: number;
  maximum?: number;
};

export function normalizeSourceExpression(
  expression: string,
  fields: Record<string, FieldDefinition>,
  unitRegistry: UnitRegistry = defaultUnitRegistry,
): string {
  const ast = parseSourceExpression(expression);
  const inferred = inferAndNormalize(ast, fields, unitRegistry);
  if (containsAggregate(ast) && inferred.kind === "number" &&
      (inferred.minimum === undefined || inferred.maximum === undefined ||
       !Number.isSafeInteger(inferred.minimum) || !Number.isSafeInteger(inferred.maximum))) {
    throw new Error("aggregate arithmetic requires statically safe minimum/maximum and collection bounds");
  }
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
    let left = parseMultiplicative();
    while (tokens[cursor]?.kind === "operator" && ["+", "-"].includes(tokens[cursor].value)) {
      const operator = tokens[cursor++].value;
      left = { kind: "binary", operator, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative(): ExpressionNode {
    let left = parseUnary();
    while (tokens[cursor]?.kind === "operator" && ["*", "/"].includes(tokens[cursor].value)) {
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
    if (token.kind === "function") {
      const opening = tokens[cursor++];
      if (opening?.kind !== "paren" || opening.value !== "(") {
        throw syntaxError(expression, token.offset, `function ${token.value} requires (`);
      }
      const collection = parseOr();
      if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, `function ${token.value} requires more arguments`);
      if (token.value === "all" || token.value === "any") {
        const predicate = parseOr();
        const closing = tokens[cursor++];
        if (closing?.kind !== "paren" || closing.value !== ")") throw syntaxError(expression, token.offset, `function ${token.value} requires closing )`);
        return { kind: "quantifier", operator: token.value, collection, predicate };
      }
      const alias = tokens[cursor++];
      if (alias?.kind !== "identifier") throw syntaxError(expression, token.offset, `function ${token.value} requires an item alias`);
      if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, `function ${token.value} requires more arguments`);
      if (token.value === "count" || token.value === "sum") {
        const first = parseOr();
        let value: ExpressionNode | undefined;
        let predicate = first;
        if (token.value === "sum") {
          value = first;
          if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, "function sum requires a predicate");
          predicate = parseOr();
        }
        const closing = tokens[cursor++];
        if (closing?.kind !== "paren" || closing.value !== ")") throw syntaxError(expression, token.offset, `function ${token.value} requires closing )`);
        return { kind: "aggregate", operator: token.value, collection, alias: alias.value, ...(value ? { value } : {}), predicate };
      }
      const rightCollection = parseOr();
      if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, `function ${token.value} requires a right alias`);
      const rightAlias = tokens[cursor++];
      if (rightAlias?.kind !== "identifier") throw syntaxError(expression, token.offset, `function ${token.value} requires a right alias`);
      if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, `function ${token.value} requires more arguments`);
      const first = parseOr();
      let value: ExpressionNode | undefined;
      let predicate = first;
      if (token.value === "join_sum") {
        value = first;
        if (tokens[cursor++]?.kind !== "comma") throw syntaxError(expression, token.offset, "function join_sum requires a predicate");
        predicate = parseOr();
      }
      const closing = tokens[cursor++];
      if (closing?.kind !== "paren" || closing.value !== ")") throw syntaxError(expression, token.offset, `function ${token.value} requires closing )`);
      return { kind: "joinAggregate", operator: token.value, leftCollection: collection, leftAlias: alias.value, rightCollection, rightAlias: rightAlias.value, ...(value ? { value } : {}), predicate };
    }
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
    const operator = rest.match(/^(&&|\|\||>=|<=|==|!=|>|<|\+|-|\*|\/|!)/);
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
    const fn = rest.match(/^(join_count|join_sum|all|any|count|sum)\b/);
    if (fn) {
      tokens.push({ kind: "function", value: fn[1] as Extract<Token, { kind: "function" }>["value"], offset });
      offset += fn[0].length;
      continue;
    }
    const reference = rest.match(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*/);
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
    if (rest[0] === ",") {
      tokens.push({ kind: "comma", value: ",", offset });
      offset += 1;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0], offset });
      offset += identifier[0].length;
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
    if (field.type === "integer" || field.type === "number") return { kind: "number", unit: field.unit, minimum: field.minimum, maximum: field.maximum };
    return { kind: field.type, unit: field.unit };
  }
  if (node.kind === "literal") {
    return { kind: typeof node.value as ValueType["kind"], unit: node.unit,
      ...(typeof node.value === "number" ? { minimum: node.value, maximum: node.value } : {}) };
  }
  if (node.kind === "quantifier") {
    if (node.collection.kind !== "reference") throw new Error(`${node.operator} collection must be a reference`);
    const collection = fields[node.collection.path];
    if (!collection || (collection.type !== "array" && collection.type !== "map")) {
      throw new Error(`${node.operator} collection must reference an array or map`);
    }
    const item = collection.type === "array" ? collection.items : collection.values;
    const scoped = { ...fields };
    if (item.type === "object") {
      for (const [path, field] of flattenItemFields(item.properties)) scoped[`item.${path}`] = field;
    } else {
      scoped["item.value"] = item;
    }
    const predicate = inferAndNormalize(node.predicate, scoped, unitRegistry);
    if (predicate.kind !== "boolean") throw new Error(`${node.operator} predicate must be boolean`);
    return { kind: "boolean" };
  }
  if (node.kind === "aggregate") {
    const collection = collectionDefinition(node.collection, fields, node.operator);
    const item = collection.type === "array" ? collection.items : collection.values;
    const scoped = withAlias(fields, node.alias, item);
    const predicate = inferAndNormalize(node.predicate, scoped, unitRegistry);
    if (predicate.kind !== "boolean") throw new Error(`${node.operator} predicate must be boolean`);
    const limit = collection.maxItems;
    if (limit === undefined) throw new Error(`${node.operator} collection requires maxItems for overflow proof`);
    if (node.operator === "count") return { kind: "number", minimum: 0, maximum: limit };
    const value = inferAndNormalize(node.value!, scoped, unitRegistry);
    if (value.kind !== "number") throw new Error("sum value must be numeric");
    if (value.minimum === undefined || value.maximum === undefined) throw new Error("sum value requires numeric minimum/maximum bounds");
    return aggregateRange(value, limit);
  }
  if (node.kind === "joinAggregate") {
    const leftCollection = collectionDefinition(node.leftCollection, fields, node.operator);
    const rightCollection = collectionDefinition(node.rightCollection, fields, node.operator);
    const left = leftCollection.type === "array" ? leftCollection.items : leftCollection.values;
    const right = rightCollection.type === "array" ? rightCollection.items : rightCollection.values;
    if (leftCollection.maxItems === undefined || rightCollection.maxItems === undefined) throw new Error(`${node.operator} collections require maxItems for overflow proof`);
    const limit = leftCollection.maxItems * rightCollection.maxItems;
    if (!Number.isSafeInteger(limit)) throw new Error(`${node.operator} pair count can overflow`);
    if (node.leftAlias === node.rightAlias) throw new Error(`${node.operator} aliases must be distinct`);
    const scoped = withAlias(withAlias(fields, node.leftAlias, left), node.rightAlias, right);
    const predicate = inferAndNormalize(node.predicate, scoped, unitRegistry);
    if (predicate.kind !== "boolean") throw new Error(`${node.operator} predicate must be boolean`);
    if (node.operator === "join_count") return { kind: "number", minimum: 0, maximum: limit };
    const value = inferAndNormalize(node.value!, scoped, unitRegistry);
    if (value.kind !== "number") throw new Error("join_sum value must be numeric");
    if (value.minimum === undefined || value.maximum === undefined) throw new Error("join_sum value requires numeric minimum/maximum bounds");
    return aggregateRange(value, limit);
  }
  if (node.kind === "unary") {
    const operand = inferAndNormalize(node.operand, fields, unitRegistry);
    if (node.operator === "!" && operand.kind !== "boolean") throw new Error("operator ! requires boolean");
    if (node.operator === "-" && operand.kind !== "number") throw new Error("unary - requires number");
    return node.operator === "-" ? { ...operand, minimum: operand.maximum === undefined ? undefined : -operand.maximum, maximum: operand.minimum === undefined ? undefined : -operand.minimum } : operand;
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
  if (["+", "-", "*", "/"].includes(node.operator)) {
    normalizePair(node.left, left, node.right, right, unitRegistry);
    if (left.kind !== "number") throw new Error(`operator ${node.operator} requires numeric operands`);
    return arithmeticRange(node.operator, left, right);
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
  if (node.kind === "quantifier") {
    return `${node.operator}(${printExpression(node.collection)}, ${printExpression(node.predicate)})`;
  }
  if (node.kind === "aggregate") {
    return `${node.operator}(${printExpression(node.collection)}, ${node.alias}, ${node.value ? `${printExpression(node.value)}, ` : ""}${printExpression(node.predicate)})`;
  }
  if (node.kind === "joinAggregate") {
    return `${node.operator}(${printExpression(node.leftCollection)}, ${node.leftAlias}, ${printExpression(node.rightCollection)}, ${node.rightAlias}, ${node.value ? `${printExpression(node.value)}, ` : ""}${printExpression(node.predicate)})`;
  }

  const precedence = operatorPrecedence(node.operator);
  const text = `${printExpression(node.left, precedence)} ${node.operator} ${printExpression(node.right, precedence + 1)}`;
  return precedence < parentPrecedence ? `(${text})` : text;
}

function collectionDefinition(node: ExpressionNode, fields: Record<string, FieldDefinition>, operator: string): Extract<FieldDefinition, { type: "array" | "map" }> {
  if (node.kind !== "reference") throw new Error(`${operator} collection must be a reference`);
  const collection = fields[node.path];
  if (!collection || (collection.type !== "array" && collection.type !== "map")) throw new Error(`${operator} collection must reference an array or map`);
  return collection;
}

function aggregateRange(value: ValueType, limit: number): ValueType {
  const candidates = [0, value.minimum! * limit, value.maximum! * limit];
  return { kind: "number", unit: value.unit, minimum: Math.min(...candidates), maximum: Math.max(...candidates) };
}

function arithmeticRange(operator: string, left: ValueType, right: ValueType): ValueType {
  if (left.minimum === undefined || left.maximum === undefined || right.minimum === undefined || right.maximum === undefined) {
    return { kind: "number", unit: left.unit ?? right.unit };
  }
  let values: number[];
  if (operator === "+") values = [left.minimum + right.minimum, left.maximum + right.maximum];
  else if (operator === "-") values = [left.minimum - right.maximum, left.maximum - right.minimum];
  else if (operator === "*") values = [left.minimum * right.minimum, left.minimum * right.maximum, left.maximum * right.minimum, left.maximum * right.maximum];
  else {
    if (right.minimum <= 0 && right.maximum >= 0) throw new Error("division range includes zero");
    values = [left.minimum / right.minimum, left.minimum / right.maximum, left.maximum / right.minimum, left.maximum / right.maximum];
  }
  return { kind: "number", unit: left.unit ?? right.unit, minimum: Math.min(...values), maximum: Math.max(...values) };
}

function containsAggregate(node: ExpressionNode): boolean {
  if (node.kind === "aggregate" || node.kind === "joinAggregate") return true;
  if (node.kind === "binary") return containsAggregate(node.left) || containsAggregate(node.right);
  if (node.kind === "unary") return containsAggregate(node.operand);
  if (node.kind === "quantifier") return containsAggregate(node.predicate);
  return false;
}

function withAlias(fields: Record<string, FieldDefinition>, alias: string, item: FieldDefinition): Record<string, FieldDefinition> {
  if (["input", "state", "previous", "item"].includes(alias)) throw new Error(`reserved collection alias "${alias}"`);
  const scoped = { ...fields };
  if (item.type === "object") {
    for (const [path, field] of flattenItemFields(item.properties)) scoped[`${alias}.${path}`] = field;
  } else scoped[`${alias}.value`] = item;
  return scoped;
}

function flattenItemFields(
  fields: Record<string, FieldDefinition>,
  prefix = "",
): Array<[string, FieldDefinition]> {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [[path, field] as [string, FieldDefinition],
      ...(field.type === "object" ? flattenItemFields(field.properties, path) : [])];
  });
}

function operatorPrecedence(operator: string): number {
  if (operator === "||") return 1;
  if (operator === "&&") return 2;
  if (["==", "!=", ">", ">=", "<", "<="].includes(operator)) return 3;
  if (operator === "+" || operator === "-") return 4;
  return 5;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("numeric literal must be finite");
  return Object.is(value, -0) ? "0" : value.toString();
}

function syntaxError(expression: string, offset: number, message: string): Error {
  return new Error(`${message} at column ${offset + 1} in "${expression}"`);
}
