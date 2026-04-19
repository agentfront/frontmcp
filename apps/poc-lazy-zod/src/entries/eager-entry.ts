/**
 * Eager entry: measures cold-start (time to complete module init),
 * first-parse, and parse-all.
 *
 * Hrtime markers must be captured BEFORE the schemas import so that
 * module-load cost (eager z.object construction) shows up in coldStart.
 * ES modules evaluate in import order (depth-first), so `./prelude` MUST
 * be listed first to grab __t0 before `../schemas/eager` runs.
 */
import { schemas } from '../schemas/eager';
import { __t0 } from './prelude';

const __t1 = process.hrtime.bigint();

type ParseableSchema = { parse: (input: unknown) => unknown };
type SchemaRow = { schema: ParseableSchema; sample: unknown };
const typed = schemas as ReadonlyArray<SchemaRow>;
if (typed.length === 0) {
  throw new Error('No schemas in bundle — regenerate with `tsx src/schemas/generate.ts`');
}

// first parse — hand-authored shape at index 0
const firstStart = process.hrtime.bigint();
typed[0].schema.parse(typed[0].sample);
const firstEnd = process.hrtime.bigint();

// parse-all pass 1: iterate every schema (for lazy, this materializes each on first touch)
const all1Start = process.hrtime.bigint();
for (let i = 0; i < typed.length; i++) {
  typed[i].schema.parse(typed[i].sample);
}
const all1End = process.hrtime.bigint();

// parse-all pass 2: steady-state — all schemas already constructed.
// This is what tells us whether the lazy wrapper adds ongoing per-parse overhead.
const all2Start = process.hrtime.bigint();
for (let i = 0; i < typed.length; i++) {
  typed[i].schema.parse(typed[i].sample);
}
const all2End = process.hrtime.bigint();

const ns = (a: bigint, b: bigint) => Number(a - b);
const ms = (a: bigint, b: bigint) => ns(a, b) / 1e6;

process.stdout.write(
  JSON.stringify({
    variant: 'eager',
    count: typed.length,
    coldStartMs: ms(__t1, __t0),
    firstParseMs: ms(firstEnd, firstStart),
    parseAllFirstMs: ms(all1End, all1Start),
    parseAllSteadyMs: ms(all2End, all2Start),
  }) + '\n',
);
