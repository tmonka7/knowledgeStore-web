/**
 * A small calculus engine for the Mathematics page.
 *
 * Expressions are parsed into a tree, differentiated exactly (sum, product,
 * quotient, chain rule), and simplified, so the graph of an nth derivative is
 * the real derivative rather than a slope guessed from neighbouring samples.
 */

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'ln', 'log', 'sqrt', 'abs']);

const num = (value) => ({ type: 'num', value });
const isNum = (node, value) => node?.type === 'num' && Number.isFinite(node.value)
  && (value === undefined || node.value === value);

export function tokenize(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '*' && input[index + 1] === '*') {
      tokens.push({ type: 'op', value: '^' });
      index += 2;
      continue;
    }
    if ('+-*/^()'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < input.length && /[0-9.]/.test(input[end])) end += 1;
      const raw = input.slice(index, end);
      if ((raw.match(/\./g) || []).length > 1 || raw === '.') {
        throw new Error(`'${raw}' is not a number.`);
      }
      tokens.push({ type: 'num', value: Number(raw) });
      index = end;
      continue;
    }
    if (/[a-zA-Z]/.test(char)) {
      let end = index + 1;
      while (end < input.length && /[a-zA-Z]/.test(input[end])) end += 1;
      tokens.push({ type: 'id', value: input.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }
    throw new Error(`Cannot use '${char}' in an expression.`);
  }
  return tokens;
}

export function parse(input) {
  const source = String(input || '').trim();
  if (!source) throw new Error('Enter a function of x.');
  const tokens = tokenize(source);
  let index = 0;

  const peek = () => tokens[index];
  const eat = () => tokens[index++];
  const peekOp = (value) => peek()?.type === 'op' && peek().value === value;

  const startsImplicit = () => {
    const token = peek();
    if (!token) return false;
    if (token.type === 'num' || token.type === 'id') return true;
    return token.type === 'op' && token.value === '(';
  };

  function parseExpression() {
    let node = parseTerm();
    while (peekOp('+') || peekOp('-')) {
      const operator = eat().value;
      node = { type: operator === '+' ? 'add' : 'sub', left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    while (true) {
      if (peekOp('*') || peekOp('/')) {
        const operator = eat().value;
        node = { type: operator === '*' ? 'mul' : 'div', left: node, right: parseUnary() };
        continue;
      }
      if (startsImplicit()) {
        node = { type: 'mul', left: node, right: parseUnary() };
        continue;
      }
      break;
    }
    return node;
  }

  // Power binds tighter than unary minus, so -x^2 is -(x^2).
  function parseUnary() {
    if (peekOp('+')) {
      eat();
      return parseUnary();
    }
    if (peekOp('-')) {
      eat();
      return { type: 'neg', arg: parseUnary() };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (!peekOp('^')) return base;
    eat();
    return { type: 'pow', left: base, right: parseUnary() };
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error('The expression ended early.');
    if (token.type === 'num') {
      eat();
      return num(token.value);
    }
    if (token.type === 'id') {
      eat();
      if (token.value === 'x') return { type: 'var' };
      if (token.value === 'pi' || token.value === 'e') return { type: 'const', name: token.value };
      if (!FUNCTIONS.has(token.value)) throw new Error(`Unknown name '${token.value}'.`);
      if (!peekOp('(')) throw new Error(`${token.value} needs parentheses, as in ${token.value}(x).`);
      eat();
      const arg = parseExpression();
      if (!peekOp(')')) throw new Error(`Missing ) after ${token.value}.`);
      eat();
      return { type: 'call', name: token.value, arg };
    }
    if (peekOp('(')) {
      eat();
      const inner = parseExpression();
      if (!peekOp(')')) throw new Error('Missing ).');
      eat();
      return inner;
    }
    throw new Error(`Unexpected '${token.value ?? token.type}'.`);
  }

  const tree = parseExpression();
  if (index < tokens.length) throw new Error(`Unexpected '${tokens[index].value ?? tokens[index].type}'.`);
  return tree;
}

function sizeOf(node) {
  if (!node) return 0;
  if (node.left) return 1 + sizeOf(node.left) + sizeOf(node.right);
  if (node.arg) return 1 + sizeOf(node.arg);
  return 1;
}

/** Exact derivative. The caller simplifies, so intermediate zeros stay until then. */
export function derivative(node) {
  switch (node.type) {
    case 'num':
    case 'const':
      return num(0);
    case 'var':
      return num(1);
    case 'neg':
      return { type: 'neg', arg: derivative(node.arg) };
    case 'add':
    case 'sub':
      return { type: node.type, left: derivative(node.left), right: derivative(node.right) };
    case 'mul':
      return {
        type: 'add',
        left: { type: 'mul', left: derivative(node.left), right: node.right },
        right: { type: 'mul', left: node.left, right: derivative(node.right) },
      };
    case 'div':
      return {
        type: 'div',
        left: {
          type: 'sub',
          left: { type: 'mul', left: derivative(node.left), right: node.right },
          right: { type: 'mul', left: node.left, right: derivative(node.right) },
        },
        right: { type: 'pow', left: node.right, right: num(2) },
      };
    case 'pow': {
      const base = node.left;
      const exponent = node.right;
      if (exponent.type === 'num') {
        if (exponent.value === 0) return num(0);
        return {
          type: 'mul',
          left: {
            type: 'mul',
            left: num(exponent.value),
            right: { type: 'pow', left: base, right: num(exponent.value - 1) },
          },
          right: derivative(base),
        };
      }
      // u^v = e^(v ln u), so the factor is v' ln u + v u'/u.
      return {
        type: 'mul',
        left: node,
        right: {
          type: 'add',
          left: { type: 'mul', left: derivative(exponent), right: { type: 'call', name: 'ln', arg: base } },
          right: {
            type: 'mul',
            left: exponent,
            right: { type: 'div', left: derivative(base), right: base },
          },
        },
      };
    }
    case 'call': {
      const argument = node.arg;
      const chain = derivative(argument);
      const slope = {
        sin: { type: 'call', name: 'cos', arg: argument },
        cos: { type: 'neg', arg: { type: 'call', name: 'sin', arg: argument } },
        tan: {
          type: 'div',
          left: num(1),
          right: { type: 'pow', left: { type: 'call', name: 'cos', arg: argument }, right: num(2) },
        },
        asin: {
          type: 'div',
          left: num(1),
          right: {
            type: 'call',
            name: 'sqrt',
            arg: { type: 'sub', left: num(1), right: { type: 'pow', left: argument, right: num(2) } },
          },
        },
        acos: {
          type: 'neg',
          arg: {
            type: 'div',
            left: num(1),
            right: {
              type: 'call',
              name: 'sqrt',
              arg: { type: 'sub', left: num(1), right: { type: 'pow', left: argument, right: num(2) } },
            },
          },
        },
        atan: {
          type: 'div',
          left: num(1),
          right: { type: 'add', left: num(1), right: { type: 'pow', left: argument, right: num(2) } },
        },
        exp: { type: 'call', name: 'exp', arg: argument },
        ln: { type: 'div', left: num(1), right: argument },
        log: {
          type: 'div',
          left: num(1),
          right: { type: 'mul', left: argument, right: { type: 'call', name: 'ln', arg: num(10) } },
        },
        sqrt: {
          type: 'div',
          left: num(1),
          right: { type: 'mul', left: num(2), right: { type: 'call', name: 'sqrt', arg: argument } },
        },
        // Sign of the inside. At a corner the value is not finite, so the line breaks.
        abs: { type: 'div', left: argument, right: { type: 'call', name: 'abs', arg: argument } },
      }[node.name];
      if (!slope) throw new Error(`Cannot differentiate ${node.name}.`);
      return { type: 'mul', left: slope, right: chain };
    }
    default:
      throw new Error('Cannot differentiate this expression.');
  }
}

export function simplify(node) {
  if (!node || node.type === 'var' || node.type === 'const' || node.type === 'num') return node;

  if (node.type === 'neg') {
    const arg = simplify(node.arg);
    if (isNum(arg)) return num(-arg.value);
    if (arg.type === 'neg') return arg.arg;
    if (arg.type === 'mul' && isNum(arg.left)) return simplify({ type: 'mul', left: num(-arg.left.value), right: arg.right });
    return { type: 'neg', arg };
  }

  if (node.type === 'call') return { type: 'call', name: node.name, arg: simplify(node.arg) };

  let left = simplify(node.left);
  let right = simplify(node.right);

  if (node.type === 'add') {
    if (right.type === 'neg') return simplify({ type: 'sub', left, right: right.arg });
    if (left.type === 'neg') return simplify({ type: 'sub', left: right, right: left.arg });
    if (isNum(left, 0)) return right;
    if (isNum(right, 0)) return left;
    if (isNum(left) && isNum(right)) return num(left.value + right.value);
  }

  if (node.type === 'sub') {
    if (isNum(right, 0)) return left;
    if (isNum(left, 0)) return simplify({ type: 'neg', arg: right });
    if (isNum(left) && isNum(right)) return num(left.value - right.value);
  }

  if (node.type === 'mul') {
    if (right.type === 'neg') return simplify({ type: 'neg', arg: { type: 'mul', left, right: right.arg } });
    if (left.type === 'neg') return simplify({ type: 'neg', arg: { type: 'mul', left: left.arg, right } });
    if (isNum(left, 0) || isNum(right, 0)) return num(0);
    if (isNum(left, 1)) return right;
    if (isNum(right, 1)) return left;
    if (isNum(left) && isNum(right)) return num(left.value * right.value);
    if (isNum(left) && right.type === 'mul' && isNum(right.left)) {
      return simplify({ type: 'mul', left: num(left.value * right.left.value), right: right.right });
    }
  }

  if (node.type === 'div') {
    if (isNum(right, 0)) return num(NaN);
    if (isNum(left, 0)) return num(0);
    if (isNum(right, 1)) return left;
    if (isNum(left) && isNum(right)) return num(left.value / right.value);
  }

  if (node.type === 'pow') {
    if (isNum(right, 1)) return left;
    if (isNum(right, 0)) return isNum(left, 0) ? num(NaN) : num(1);
    if (isNum(left, 0) && right.type === 'num' && right.value > 0) return num(0);
    if (isNum(left) && isNum(right)) return num(left.value ** right.value);
  }

  return { ...node, left, right };
}

const PRECEDENCE = { add: 1, sub: 1, mul: 2, div: 2, pow: 3, neg: 4 };

const juxtaposed = (node) => node.type === 'var'
  || node.type === 'call'
  || node.type === 'const'
  || (node.type === 'pow' && juxtaposed(node.left));

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'undefined';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function formatAt(node, parent) {
  if (node.type === 'num') {
    const text = formatNumber(node.value);
    return node.value < 0 && parent > 0 ? `(${text})` : text;
  }
  if (node.type === 'var') return 'x';
  if (node.type === 'const') return node.name;
  if (node.type === 'call') return `${node.name}(${formatAt(node.arg, 0)})`;
  if (node.type === 'neg') {
    const text = `-${formatAt(node.arg, PRECEDENCE.neg)}`;
    return PRECEDENCE.neg < parent ? `(${text})` : text;
  }

  if (node.type === 'mul' && isNum(node.left) && juxtaposed(node.right)) {
    const text = `${formatAt(node.left, PRECEDENCE.neg)}${formatAt(node.right, PRECEDENCE.mul)}`;
    const prec = node.left.value < 0 ? PRECEDENCE.neg : PRECEDENCE.mul;
    return prec < parent ? `(${text})` : text;
  }

  const prec = PRECEDENCE[node.type] || 0;
  const symbol = { add: '+', sub: '-', mul: '*', div: '/', pow: '^' }[node.type];
  const rightPrec = node.type === 'pow' || node.type === 'sub' || node.type === 'div' ? prec + 1 : prec;
  const text = `${formatAt(node.left, prec)}${symbol === '+' || symbol === '-' ? ` ${symbol} ` : symbol}${formatAt(node.right, rightPrec)}`;
  return prec < parent ? `(${text})` : text;
}

export function format(node) {
  return formatAt(node, 0);
}

export function evaluate(node, x) {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'var':
      return x;
    case 'const':
      return node.name === 'pi' ? Math.PI : Math.E;
    case 'neg':
      return -evaluate(node.arg, x);
    case 'add':
      return evaluate(node.left, x) + evaluate(node.right, x);
    case 'sub':
      return evaluate(node.left, x) - evaluate(node.right, x);
    case 'mul':
      return evaluate(node.left, x) * evaluate(node.right, x);
    case 'div':
      return evaluate(node.left, x) / evaluate(node.right, x);
    case 'pow':
      return evaluate(node.left, x) ** evaluate(node.right, x);
    case 'call': {
      const value = evaluate(node.arg, x);
      switch (node.name) {
        case 'sin': return Math.sin(value);
        case 'cos': return Math.cos(value);
        case 'tan': return Math.tan(value);
        case 'asin': return Math.asin(value);
        case 'acos': return Math.acos(value);
        case 'atan': return Math.atan(value);
        case 'exp': return Math.exp(value);
        case 'ln': return Math.log(value);
        case 'log': return Math.log10(value);
        case 'sqrt': return Math.sqrt(value);
        case 'abs': return Math.abs(value);
        default: return NaN;
      }
    }
    default:
      return NaN;
  }
}

const MAX_ORDER = 8;
const MAX_NODES = 800;

/**
 * The function and its derivatives through `order` (at least the second).
 * `steps[0]` is f, `steps[k]` is the kth derivative.
 */
export function analyze(expression, order) {
  const requested = Number(order);
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_ORDER) {
    throw new Error(`Derivative order must be a whole number from 1 to ${MAX_ORDER}.`);
  }

  let current = simplify(parse(expression));
  const steps = [current];
  const depth = Math.max(requested, 2);
  for (let step = 0; step < depth; step += 1) {
    current = simplify(derivative(current));
    if (sizeOf(current) > MAX_NODES) {
      throw new Error(`The order ${step + 1} derivative is too large to write exactly. Try a simpler function or a lower order.`);
    }
    steps.push(current);
  }

  return {
    order: requested,
    steps,
    formula: (level) => format(steps[level]),
    at: (level, x) => evaluate(steps[level], x),
  };
}

export function sampleCurve(at, xMin, xMax, count = 480) {
  const points = [];
  const span = xMax - xMin;
  for (let index = 0; index < count; index += 1) {
    const x = xMin + (span * index) / (count - 1);
    const y = at(x);
    points.push({ x, y: Number.isFinite(y) ? y : NaN });
  }
  return points;
}

/** A vertical window that ignores a few huge samples, so an asymptote does not flatten the rest. */
export function yWindow(series) {
  const values = series.flatMap((curve) => curve.points.map((point) => point.y).filter(Number.isFinite));
  if (!values.length) return { min: -1, max: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
  let min = at(0.02);
  let max = at(0.98);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}
