/**
 * Lazy entry: identical to eager-entry except it imports from lazy.ts.
 * Cold-start should be dramatically faster; first-parse slightly slower
 * (factory materializes z.object on first call); parse-all should be
 * within ±5% of eager (the deferred cost is paid across all schemas here).
 */
import { schemas } from '../schemas/lazy';
import { __t0 } from './prelude';

const __t1 = process.hrtime.bigint();

const firstStart = process.hrtime.bigint();
(schemas[0].schema as any).parse(schemas[0].sample);
const firstEnd = process.hrtime.bigint();

const all1Start = process.hrtime.bigint();
for (let i = 0; i < schemas.length; i++) {
  (schemas[i].schema as any).parse(schemas[i].sample);
}
const all1End = process.hrtime.bigint();

const all2Start = process.hrtime.bigint();
for (let i = 0; i < schemas.length; i++) {
  (schemas[i].schema as any).parse(schemas[i].sample);
}
const all2End = process.hrtime.bigint();

const ns = (a: bigint, b: bigint) => Number(a - b);
const ms = (a: bigint, b: bigint) => ns(a, b) / 1e6;

process.stdout.write(
  JSON.stringify({
    variant: 'lazy',
    count: schemas.length,
    coldStartMs: ms(__t1, __t0),
    firstParseMs: ms(firstEnd, firstStart),
    parseAllFirstMs: ms(all1End, all1Start),
    parseAllSteadyMs: ms(all2End, all2Start),
  }) + '\n',
);
