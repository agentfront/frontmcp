/** How long the heavy reads keep their thread busy. */
export const HEAVY_MS = 1500;

/** Keep the calling thread busy for `ms` milliseconds, as CPU-heavy work does. */
export function spin(ms: number): number {
  const end = Date.now() + ms;
  let turns = 0;
  while (Date.now() < end) turns++;
  return turns;
}
