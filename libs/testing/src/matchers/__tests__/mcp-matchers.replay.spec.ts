import type { ReplayReport } from '../../replay/replay-session';
import { mcpMatchers } from '../mcp-matchers';

import type {} from '../matcher-types';

expect.extend(mcpMatchers);

const clean: ReplayReport = { file: 'calls.jsonl', calls: [], differences: [] };

const changed: ReplayReport = {
  file: 'calls.jsonl',
  calls: [],
  differences: [
    {
      line: 2,
      method: 'tools/call',
      name: 'quote',
      outcome: 'changed',
      changes: [{ path: 'structuredContent.price', recorded: 12, replayed: 15 }],
    },
  ],
};

describe('toMatchRecording', () => {
  it('passes when every call answered as recorded', () => {
    expect(clean).toMatchRecording();
    expect(() => expect(clean).not.toMatchRecording()).toThrow('every call answered as recorded');
  });

  it('fails with the calls that differ and how', () => {
    expect(changed).not.toMatchRecording();
    expect(() => expect(changed).toMatchRecording()).toThrow(
      'line 2 tools/call quote: changed\n    structuredContent.price: 12 -> 15',
    );
  });

  it('fails for a value that is not a replay report', () => {
    expect(() => expect({ calls: [] }).toMatchRecording()).toThrow('replaySession()');
  });
});
