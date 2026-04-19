/**
 * Lazy entry: identical to eager-entry except it imports from lazy.ts.
 * Cold-start should be dramatically faster; first-parse slightly slower
 * (factory materializes z.object on first call); parse-all should be
 * within ±5% of eager (the deferred cost is paid across all schemas here).
 *
 * Import order MUST put `./prelude` first so __t0 is captured before any
 * schema module evaluates.
 */
import { schemas } from '../schemas/lazy';
import { __t0 } from './prelude';

const __t1 = process.hrtime.bigint();

type ParseableSchema = { parse: (input: unknown) => unknown };
type SchemaRow = { schema: ParseableSchema; sample: unknown };
const typed = schemas as ReadonlyArray<SchemaRow>;
if (typed.length === 0) {
  throw new Error('No schemas in bundle — regenerate with `tsx src/schemas/generate.ts`');
}

const firstStart = process.hrtime.bigint();
typed[0].schema.parse(typed[0].sample);
const firstEnd = process.hrtime.bigint();

const all1Start = process.hrtime.bigint();
for (let i = 0; i < typed.length; i++) {
  typed[i].schema.parse(typed[i].sample);
}
const all1End = process.hrtime.bigint();

const all2Start = process.hrtime.bigint();
for (let i = 0; i < typed.length; i++) {
  typed[i].schema.parse(typed[i].sample);
}
const all2End = process.hrtime.bigint();

const ns = (a: bigint, b: bigint) => Number(a - b);
const ms = (a: bigint, b: bigint) => ns(a, b) / 1e6;

process.stdout.write(
  JSON.stringify({
    variant: 'lazy',
    count: typed.length,
    coldStartMs: ms(__t1, __t0),
    firstParseMs: ms(firstEnd, firstStart),
    parseAllFirstMs: ms(all1End, all1Start),
    parseAllSteadyMs: ms(all2End, all2Start),
  }) + '\n',
);
