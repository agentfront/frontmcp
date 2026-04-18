/**
 * Reads results/results.json and prints a comparison table.
 * Evaluates the 5-criteria go/no-go gate and prints a verdict.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const RESULTS = path.join(ROOT, 'results', 'results.json');

type Measurement = {
  variant: 'eager' | 'lazy';
  coldStartMs: number;
  firstParseMs: number;
  parseAllFirstMs: number;
  parseAllSteadyMs: number;
  count: number;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(0.95 * (s.length - 1)))];
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const stddev = (xs: number[]): number => {
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / xs.length);
};

function agg(rs: Measurement[], key: keyof Measurement) {
  const xs = rs.map((r) => r[key] as number);
  return { median: median(xs), p95: p95(xs), mean: mean(xs), stddev: stddev(xs) };
}

function fmt(n: number, unit = 'ms', digits = 2) {
  return `${n.toFixed(digits)} ${unit}`;
}

function pct(lazy: number, eager: number) {
  const d = ((lazy - eager) / eager) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const { config, bundleSizes, runs } = raw as {
    config: { N: number; warmup: number; nodeArgs: string[]; nodeVersion: string };
    bundleSizes: { eagerBytes: number; lazyBytes: number; deltaPct: number };
    runs: Measurement[];
  };

  const eager = runs.filter((r) => r.variant === 'eager');
  const lazy = runs.filter((r) => r.variant === 'lazy');

  const coldEager = agg(eager, 'coldStartMs');
  const coldLazy = agg(lazy, 'coldStartMs');
  const firstEager = agg(eager, 'firstParseMs');
  const firstLazy = agg(lazy, 'firstParseMs');
  const all1Eager = agg(eager, 'parseAllFirstMs');
  const all1Lazy = agg(lazy, 'parseAllFirstMs');
  const all2Eager = agg(eager, 'parseAllSteadyMs');
  const all2Lazy = agg(lazy, 'parseAllSteadyMs');

  const header = [
    '',
    '========================================================================',
    `  POC Lazy-Zod Results  (node ${config.nodeVersion}, N=${config.N}, warmup=${config.warmup})`,
    `  node args: ${config.nodeArgs.length ? config.nodeArgs.join(' ') : '(none)'}`,
    '========================================================================',
    '',
  ].join('\n');
  console.log(header);

  const row = (metric: string, e: { median: number; p95: number }, l: { median: number; p95: number }, unit = 'ms') =>
    `  ${metric.padEnd(18)}  eager: ${fmt(e.median, unit).padStart(12)}  lazy: ${fmt(l.median, unit).padStart(12)}  Δmed: ${pct(l.median, e.median).padStart(8)}   p95 e/l: ${fmt(e.p95, unit, 1).padStart(9)} / ${fmt(l.p95, unit, 1)}`;

  console.log(row('cold-start', coldEager, coldLazy));
  console.log(row('first-parse', firstEager, firstLazy));
  console.log(row('parse-all(1st)', all1Eager, all1Lazy));
  console.log(row('parse-all(steady)', all2Eager, all2Lazy));
  console.log(
    `  bundle-size        eager: ${(bundleSizes.eagerBytes / 1024 / 1024).toFixed(3)} MB   lazy: ${(bundleSizes.lazyBytes / 1024 / 1024).toFixed(3)} MB   Δ: ${bundleSizes.deltaPct.toFixed(2)}%`,
  );
  console.log(`\n  NOTE: "parse-all(1st)" in lazy includes schema materialization (factory -> z.object).`);
  console.log(`        "parse-all(steady)" is the steady-state comparison — lazy should be ~eager.`);

  // ---------- gate evaluation ----------
  const ratioColdMed = coldLazy.median / coldEager.median;
  const ratioColdP95 = coldLazy.p95 / coldEager.p95;
  const firstParseAbs = firstLazy.median - firstEager.median;
  // Gate uses steady-state (pass-2) — "parse-all within ±5%" means the wrapper
  // itself adds no lasting overhead. The first-pass delta is expected to be
  // large (deferred schema construction) and is not gated here.
  const parseAllSteadyRelPct = ((all2Lazy.median - all2Eager.median) / all2Eager.median) * 100;
  const bundleDeltaPct = bundleSizes.deltaPct;

  const gate = [
    { name: 'cold-start median ratio     ≤ 0.60', pass: ratioColdMed <= 0.6, actual: ratioColdMed.toFixed(3) },
    { name: 'cold-start p95 ratio        ≤ 0.70', pass: ratioColdP95 <= 0.7, actual: ratioColdP95.toFixed(3) },
    { name: 'first-parse delta           ≤ +5 ms', pass: firstParseAbs <= 5, actual: firstParseAbs.toFixed(2) + ' ms' },
    {
      name: 'parse-all(steady) within   ±5%',
      pass: Math.abs(parseAllSteadyRelPct) <= 5,
      actual: parseAllSteadyRelPct.toFixed(2) + '%',
    },
    { name: 'bundle-size delta           ≤ +2%', pass: bundleDeltaPct <= 2, actual: bundleDeltaPct.toFixed(2) + '%' },
  ];

  console.log('\n  Gate:');
  for (const g of gate) {
    console.log(`    [${g.pass ? ' PASS ' : ' FAIL '}]  ${g.name.padEnd(36)}  actual=${g.actual}`);
  }
  const verdict = gate.every((g) => g.pass)
    ? 'PROCEED — implement @frontmcp/lazy-zod.'
    : 'ABANDON — speedup does not clear threshold.';
  console.log(`\n  Verdict: ${verdict}\n`);

  fs.writeFileSync(
    path.join(ROOT, 'results', 'summary.json'),
    JSON.stringify(
      {
        cold: { eager: coldEager, lazy: coldLazy },
        firstParse: { eager: firstEager, lazy: firstLazy },
        parseAllFirst: { eager: all1Eager, lazy: all1Lazy },
        parseAllSteady: { eager: all2Eager, lazy: all2Lazy },
        bundleSizes,
        gate,
        verdict,
      },
      null,
      2,
    ),
  );
}

main();
