import { InvalidInputError } from '@frontmcp/sdk';

/** The largest count a grep regex repeats by (`{m,n}`). */
export const MAX_GREP_REPEAT = 100;
/** The most instructions a grep regex compiles to. */
export const MAX_GREP_PROGRAM = 2000;
/**
 * The most parts of a grep regex its compiler visits, once its repeats are spelled out: a bound on the work of
 * compiling it, which a part that compiles to no instruction, such as an empty group, still costs.
 */
export const MAX_GREP_COMPILE_VISITS = 10 * MAX_GREP_PROGRAM;
/** How many steps the regex of one `result_query` takes at most: a bound on its run time, whatever the data. */
export const MAX_GREP_STEPS = 20_000_000;

export interface GrepQuery {
  pattern: string;
  /** Read `pattern` as a regular expression, not a literal. */
  regex?: boolean;
  ignoreCase?: boolean;
  /** A path in each item to search; the whole item when left out. */
  field?: string;
}

type CharTest = (char: string) => boolean;
type Assertion = 'start' | 'end' | 'word' | 'notWord';
type Node =
  | { kind: 'char'; test: CharTest }
  | { kind: 'assert'; at: Assertion }
  | { kind: 'seq'; items: Node[] }
  | { kind: 'alt'; options: Node[] }
  | { kind: 'repeat'; node: Node; min: number; max: number };
type Instruction =
  | { op: 'char'; test: CharTest }
  | { op: 'assert'; at: Assertion }
  | { op: 'split'; first: number; second: number }
  | { op: 'jmp'; to: number }
  | { op: 'match' };

const isWordChar: CharTest = (char) => /\w/.test(char);
const SHORTHANDS: Record<string, CharTest> = {
  d: (char) => char >= '0' && char <= '9',
  D: (char) => !(char >= '0' && char <= '9'),
  w: isWordChar,
  W: (char) => !isWordChar(char),
  s: (char) => /\s/.test(char),
  S: (char) => !/\s/.test(char),
};
const CONTROL_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', '0': '\0' };
const LINE_BREAKS = new Set(['\n', '\r', ' ', ' ']);
// Any number of digits, so a count over the limit is refused, not read as the text `{10000}`.
const BOUNDS = /^\{(\d+)(,(\d*))?\}/;

/**
 * How RegExp folds case without the `u` flag (ES Canonicalize): a character's upper case, unless that is more than one
 * character or moves a non-ASCII character into ASCII. So `σ`, `ς` and `Σ` are one character to `ignoreCase`.
 */
function canonicalize(char: string): string {
  const upper = char.toUpperCase();
  if (upper.length !== 1) return char;
  return char.charCodeAt(0) >= 128 && upper.charCodeAt(0) < 128 ? char : upper;
}

/** `text` with each character folded as {@link canonicalize} folds it, so its length stays the same. */
function canonicalText(text: string): string {
  let folded = '';
  for (const char of text) folded += canonicalize(char);
  return folded;
}

function refuse(pattern: string, problem: string): never {
  throw new InvalidInputError(`grep.pattern ${JSON.stringify(pattern)} has ${problem}`);
}

/** Reads the regex subset grep runs: literals, `.`, classes, `\d \w \s \b`, `^ $`, groups, `|` and quantifiers. */
class PatternParser {
  private at = 0;

  constructor(
    private readonly source: string,
    private readonly ignoreCase: boolean,
  ) {}

  parse(): Node {
    const node = this.alternation();
    if (this.at < this.source.length) refuse(this.source, 'an unmatched ")"');
    return node;
  }

  private peek(): string | undefined {
    return this.source[this.at];
  }

  private eat(char: string): boolean {
    if (this.source[this.at] !== char) return false;
    this.at++;
    return true;
  }

  /** One character, which with `ignoreCase` is any character RegExp folds to the same one. */
  private literal(char: string): CharTest {
    if (!this.ignoreCase) return (next) => next === char;
    const folded = canonicalize(char);
    return (next) => next === char || canonicalize(next) === folded;
  }

  private alternation(): Node {
    const options = [this.sequence()];
    while (this.eat('|')) options.push(this.sequence());
    return options.length === 1 ? options[0] : { kind: 'alt', options };
  }

  private sequence(): Node {
    const items: Node[] = [];
    while (this.at < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.quantified(this.atom()));
    }
    return { kind: 'seq', items };
  }

  private quantified(node: Node): Node {
    const bounds = this.bounds();
    if (!bounds) return node;
    if (node.kind === 'assert') refuse(this.source, 'a quantifier on an anchor');
    this.eat('?');
    if (this.bounds()) refuse(this.source, 'nothing to repeat');
    return { kind: 'repeat', node, ...bounds };
  }

  private bounds(): { min: number; max: number } | undefined {
    const char = this.peek();
    if (char === '*' || char === '+' || char === '?') {
      this.at++;
      return { min: char === '+' ? 1 : 0, max: char === '?' ? 1 : Infinity };
    }
    const match = char === '{' ? BOUNDS.exec(this.source.slice(this.at)) : null;
    if (!match) return undefined;
    this.at += match[0].length;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    if (min > MAX_GREP_REPEAT || (max !== Infinity && max > MAX_GREP_REPEAT)) {
      refuse(this.source, `a repeat count over ${MAX_GREP_REPEAT}`);
    }
    if (max < min) refuse(this.source, 'a repeat range out of order');
    return { min, max };
  }

  private atom(): Node {
    const char = this.source[this.at++];
    switch (char) {
      case '(':
        return this.group();
      case '[':
        return this.charClass();
      case '.':
        return { kind: 'char', test: (next) => !LINE_BREAKS.has(next) };
      case '^':
        return { kind: 'assert', at: 'start' };
      case '$':
        return { kind: 'assert', at: 'end' };
      case '\\':
        return this.escape();
      case '*':
      case '+':
      case '?':
        return refuse(this.source, 'nothing to repeat');
      default:
        return { kind: 'char', test: this.literal(char) };
    }
  }

  private group(): Node {
    if (this.eat('?') && !this.eat(':')) refuse(this.source, 'a lookaround or a named group, which grep does not run');
    const node = this.alternation();
    if (!this.eat(')')) refuse(this.source, 'an unclosed "("');
    return node;
  }

  private escape(): Node {
    const char = this.peek();
    if (char === 'b' || char === 'B') {
      this.at++;
      return { kind: 'assert', at: char === 'b' ? 'word' : 'notWord' };
    }
    const escaped = this.escaped();
    return { kind: 'char', test: typeof escaped === 'string' ? this.literal(escaped) : escaped };
  }

  /** The character or the shorthand class after a `\`. */
  private escaped(): string | CharTest {
    const char = this.source[this.at++];
    if (char === undefined) return refuse(this.source, 'a "\\" at its end');
    const shorthand = SHORTHANDS[char];
    if (shorthand) return shorthand;
    const control = CONTROL_ESCAPES[char];
    if (control !== undefined) return control;
    if (/[A-Za-z0-9]/.test(char)) refuse(this.source, `"\\${char}", which grep does not run`);
    return char;
  }

  private charClass(): Node {
    const negated = this.eat('^');
    const tests: CharTest[] = [];
    while (!this.eat(']')) {
      if (this.at >= this.source.length) refuse(this.source, 'an unclosed "["');
      const low = this.classMember();
      const next = this.source[this.at + 1];
      if (typeof low === 'string' && this.peek() === '-' && next !== undefined && next !== ']') {
        this.at++;
        const high = this.classMember();
        if (typeof high !== 'string' || high < low) refuse(this.source, 'a range out of order');
        tests.push(this.range(low, high));
      } else {
        // A literal folds as RegExp does once, so it is not folded again; \d \w \s hold no character case changes.
        tests.push(typeof low === 'string' ? this.literal(low) : low);
      }
    }
    const matches: CharTest = (char) => tests.some((test) => test(char));
    return { kind: 'char', test: negated ? (char) => !matches(char) : matches };
  }

  /** The characters from `low` to `high`; with `ignoreCase`, any character RegExp folds to the same one as one of them. */
  private range(low: string, high: string): CharTest {
    const within: CharTest = (char) => char >= low && char <= high;
    if (!this.ignoreCase) return within;
    return (char) => {
      const folded = canonicalize(char);
      return [char, folded, folded.toLowerCase(), char.toLowerCase()].some(
        (member) => member.length === 1 && within(member) && canonicalize(member) === folded,
      );
    };
  }

  private classMember(): string | CharTest {
    if (!this.eat('\\')) return this.source[this.at++];
    return this.eat('b') ? '\b' : this.escaped();
  }
}

function compile(pattern: string, node: Node, program: Instruction[], visits = { count: 0 }): void {
  if (++visits.count > MAX_GREP_COMPILE_VISITS) {
    refuse(pattern, `more than ${MAX_GREP_COMPILE_VISITS} parts once its repeats are spelled out`);
  }
  const emit = (instruction: Instruction): number => {
    if (program.length >= MAX_GREP_PROGRAM)
      refuse(pattern, `more than ${MAX_GREP_PROGRAM} steps once its repeats are spelled out`);
    return program.push(instruction) - 1;
  };
  const split = (): Extract<Instruction, { op: 'split' }> => {
    const instruction = { op: 'split' as const, first: program.length + 1, second: -1 };
    emit(instruction);
    return instruction;
  };
  switch (node.kind) {
    case 'char':
      emit({ op: 'char', test: node.test });
      return;
    case 'assert':
      emit({ op: 'assert', at: node.at });
      return;
    case 'seq':
      for (const item of node.items) compile(pattern, item, program, visits);
      return;
    case 'alt': {
      const exits: Array<Extract<Instruction, { op: 'jmp' }>> = [];
      node.options.forEach((option, index) => {
        if (index === node.options.length - 1) return compile(pattern, option, program, visits);
        const fork = split();
        compile(pattern, option, program, visits);
        const exit = { op: 'jmp' as const, to: -1 };
        emit(exit);
        exits.push(exit);
        fork.second = program.length;
      });
      for (const exit of exits) exit.to = program.length;
      return;
    }
    case 'repeat': {
      for (let copy = 0; copy < node.min; copy++) compile(pattern, node.node, program, visits);
      if (node.max === Infinity) {
        const start = program.length;
        const loop = split();
        compile(pattern, node.node, program, visits);
        emit({ op: 'jmp', to: start });
        loop.second = program.length;
        return;
      }
      const skips: Array<Extract<Instruction, { op: 'split' }>> = [];
      for (let copy = node.min; copy < node.max; copy++) {
        skips.push(split());
        compile(pattern, node.node, program, visits);
      }
      for (const skip of skips) skip.second = program.length;
    }
  }
}

function holds(at: Assertion, text: string, position: number): boolean {
  if (at === 'start') return position === 0;
  if (at === 'end') return position === text.length;
  const boundary = isWordChar(text[position - 1] ?? '') !== isWordChar(text[position] ?? '');
  return at === 'word' ? boundary : !boundary;
}

/** A grep regex, run in time linear in its text (no backtracking), and refused past {@link MAX_GREP_STEPS} steps. */
export class GrepRegex {
  private readonly program: Instruction[] = [];
  private readonly marks: number[];
  private generation = 0;
  private steps = 0;

  constructor(pattern: string, ignoreCase = false) {
    compile(pattern, new PatternParser(pattern, ignoreCase).parse(), this.program);
    this.program.push({ op: 'match' });
    this.marks = new Array<number>(this.program.length).fill(0);
  }

  /** Whether the pattern matches somewhere in `text`. */
  test(text: string): boolean {
    let threads = this.closure([0], text, 0);
    for (let position = 0; threads !== true && position < text.length; position++) {
      const char = text[position];
      const next = [0];
      for (const pc of threads) {
        if ((this.program[pc] as Extract<Instruction, { op: 'char' }>).test(char)) next.push(pc + 1);
      }
      this.spend(threads.length);
      threads = this.closure(next, text, position + 1);
    }
    return threads === true;
  }

  /** The `char` instructions the threads from `seeds` wait on at `position`, or true when one of them matched. */
  private closure(seeds: number[], text: string, position: number): number[] | true {
    const generation = ++this.generation;
    const waiting: number[] = [];
    const stack = seeds.slice();
    while (stack.length > 0) {
      const pc = stack.pop() as number;
      if (this.marks[pc] === generation) continue;
      this.marks[pc] = generation;
      this.spend(1);
      const instruction = this.program[pc];
      if (instruction.op === 'match') return true;
      if (instruction.op === 'char') waiting.push(pc);
      else if (instruction.op === 'jmp') stack.push(instruction.to);
      else if (instruction.op === 'split') stack.push(instruction.second, instruction.first);
      else if (holds(instruction.at, text, position)) stack.push(pc + 1);
    }
    return waiting;
  }

  private spend(steps: number): void {
    this.steps += steps;
    if (this.steps > MAX_GREP_STEPS) {
      throw new InvalidInputError(
        `grep stopped after ${MAX_GREP_STEPS} steps: search a deeper path or a field, or use a literal pattern`,
      );
    }
  }
}

/** The test of a grep: a literal, or a {@link GrepRegex}. */
export function grepMatcher({ pattern, regex, ignoreCase }: GrepQuery): (text: string) => boolean {
  if (regex) {
    const compiled = new GrepRegex(pattern, ignoreCase);
    return (text) => compiled.test(text);
  }
  if (!ignoreCase) return (text) => text.includes(pattern);
  // Folded as a regex folds them, on both sides: a lowercased Σ at a word's end is ς, which `σ` would miss.
  const needle = canonicalText(pattern);
  return (text) => canonicalText(text).includes(needle);
}
