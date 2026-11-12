import { formatBaselineAsComment, parseBaselineFromComment } from '../baseline-store';

const START = '<!-- PERF_BASELINE_START -->';
const END = '<!-- PERF_BASELINE_END -->';

describe('parseBaselineFromComment', () => {
  it('reads back the baseline a comment was formatted from', () => {
    const baseline = { release: 'v1.0.0', timestamp: '2026-11-12T00:00:00.000Z', tests: {} };
    const comment = formatBaselineAsComment(baseline as never);
    expect(parseBaselineFromComment(comment)).toEqual(baseline);
  });

  it('reads JSON directly after the fence and before a closing fence without line breaks', () => {
    expect(parseBaselineFromComment(`${START}\`\`\`json{"release":"v2"}\`\`\`${END}`)).toEqual({ release: 'v2' });
  });

  it('returns null for an empty or unparsable block', () => {
    expect(parseBaselineFromComment(`${START}\`\`\`json\n\`\`\`${END}`)).toBeNull();
    expect(parseBaselineFromComment(`${START}\`\`\`json\n{not json}\n\`\`\`${END}`)).toBeNull();
  });

  it('returns null at once for a JSON fence that is never closed, after a long run of whitespace', () => {
    expect(parseBaselineFromComment(`${START}\n\`\`\`json${' '.repeat(5000)}\n${END}`)).toBeNull();
  });
});
