type Context = Record<string, unknown>;

type Token = {
  kind: "number" | "identifier" | "operator" | "paren";
  value: string;
};

export function evaluateExpression(expression: string, context: Context): unknown {
  const tokens = tokenize(expression);
  let cursor = 0;

  function parseComparison(): unknown {
    let left = parseAdditive();
    const token = tokens[cursor];
    if (token && ["==", "!=", ">=", "<=", ">", "<"].includes(token.value)) {
      cursor += 1;
      const right = parseAdditive();
      left = compare(token.value, left, right);
    }
    return left;
  }

  function parseAdditive(): unknown {
    let left = parsePrimary();
    while (tokens[cursor] && ["+", "-"].includes(tokens[cursor].value)) {
      const operator = tokens[cursor++].value;
      const right = parsePrimary();
      if (typeof left !== "number" || typeof right !== "number") {
        throw new Error(`Operator ${operator} requires numeric operands`);
      }
      left = operator === "+" ? left + right : left - right;
    }
    return left;
  }

  function parsePrimary(): unknown {
    const token = tokens[cursor++];
    if (!token) throw new Error("Unexpected end of expression");
    if (token.kind === "number") return Number(token.value);
    if (token.kind === "identifier") return getPath(context, token.value);
    if (token.value === "(") {
      const value = parseComparison();
      if (tokens[cursor++]?.value !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    throw new Error(`Unexpected token "${token.value}"`);
  }

  const result = parseComparison();
  if (cursor !== tokens.length) throw new Error(`Unexpected token "${tokens[cursor].value}"`);
  return result;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let remaining = expression.trim();
  while (remaining.length > 0) {
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      remaining = remaining.slice(whitespace[0].length);
      continue;
    }
    const operator = remaining.match(/^(>=|<=|==|!=|>|<|\+|-)/);
    if (operator) {
      tokens.push({ kind: "operator", value: operator[1] });
      remaining = remaining.slice(operator[1].length);
      continue;
    }
    const number = remaining.match(/^\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      remaining = remaining.slice(number[0].length);
      continue;
    }
    const identifier = remaining.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      remaining = remaining.slice(identifier[0].length);
      continue;
    }
    if (remaining[0] === "(" || remaining[0] === ")") {
      tokens.push({ kind: "paren", value: remaining[0] });
      remaining = remaining.slice(1);
      continue;
    }
    throw new Error(`Unsupported expression syntax near "${remaining}"`);
  }
  return tokens;
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
