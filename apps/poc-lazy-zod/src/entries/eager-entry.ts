/**
 * Eager entry: measures cold-start (time to complete module init),
 * first-parse, and parse-all.
 *
 * Hrtime markers must be captured BEFORE the schemas import so that
 * module-load cost (eager z.object construction) shows up in coldStart.
 */
// Prelude captures __t0 BEFORE the schemas import (ES modules evaluate in
// import order, depth-first). This is the whole point: we want coldStart to
// cover the time spent constructing every eager `z.object({...})` at module load.
import { schemas } from '../schemas/eager';
import { __t0 } from './prelude';

const __t1 = process.hrtime.bigint();

// first parse — hand-authored shape at index 0
const firstStart = process.hrtime.bigint();
(schemas[0].schema as any).parse(schemas[0].sample);
const firstEnd = process.hrtime.bigint();

// parse-all pass 1: iterate every schema (for lazy, this materializes each on first touch)
const all1Start = process.hrtime.bigint();
for (let i = 0; i < schemas.length; i++) {
  (schemas[i].schema as any).parse(schemas[i].sample);
}
const all1End = process.hrtime.bigint();

// parse-all pass 2: steady-state — all schemas already constructed.
// This is what tells us whether the lazy wrapper adds ongoing per-parse overhead.
const all2Start = process.hrtime.bigint();
for (let i = 0; i < schemas.length; i++) {
  (schemas[i].schema as any).parse(schemas[i].sample);
}
const all2End = process.hrtime.bigint();

const ns = (a: bigint, b: bigint) => Number(a - b);
const ms = (a: bigint, b: bigint) => ns(a, b) / 1e6;

process.stdout.write(
  JSON.stringify({
    variant: 'eager',
    count: schemas.length,
    coldStartMs: ms(__t1, __t0),
    firstParseMs: ms(firstEnd, firstStart),
    parseAllFirstMs: ms(all1End, all1Start),
    parseAllSteadyMs: ms(all2End, all2Start),
  }) + '\n',
);
