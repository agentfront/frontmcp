/**
 * `tasks.store: false` and `elicitation.store: false` keep that state in memory even when the server has a top-level
 * `redis` or `sqlite`; a value they do not take, or one that names a backend next to them, fails the boot.
 */
import { frontMcpMetadataSchema } from '../front-mcp.metadata';

const redis = { provider: 'redis', host: 'localhost' };

function parse(options: Record<string, unknown>): Record<string, Record<string, unknown> | undefined> {
  const parsed: unknown = frontMcpMetadataSchema.parse({
    info: { name: 'store-off', version: '1.0.0' },
    apps: [],
    ...options,
  });
  return parsed as Record<string, Record<string, unknown> | undefined>;
}

describe('frontMcpMetadataSchema — tasks.store', () => {
  it('keeps store: false', () => {
    expect(parse({ tasks: { store: false } })['tasks']?.['store']).toBe(false);
  });

  it.each([true, 'memory'])('refuses store: %j with the value it takes', (store) => {
    expect(() => parse({ tasks: { store } })).toThrow('tasks.store must be false (tasks kept in memory)');
  });

  it.each([{ redis }, { sqlite: { path: '/tmp/tasks.sqlite' } }])('refuses store: false next to %j', (backend) => {
    expect(() => parse({ tasks: { store: false, ...backend } })).toThrow(
      'tasks.store: false keeps tasks in memory, so it takes no tasks.redis or tasks.sqlite',
    );
  });
});

describe('frontMcpMetadataSchema — elicitation.store', () => {
  it('keeps store: false', () => {
    expect(parse({ elicitation: { enabled: true, store: false } })['elicitation']?.['store']).toBe(false);
  });

  it.each([true, 'memory'])('refuses store: %j with the value it takes', (store) => {
    expect(() => parse({ elicitation: { enabled: true, store } })).toThrow(
      'elicitation.store must be false (elicitation kept in memory)',
    );
  });

  it('refuses store: false next to elicitation.redis', () => {
    expect(() => parse({ elicitation: { enabled: true, store: false, redis } })).toThrow(
      'elicitation.store: false keeps elicitation in memory, so it takes no elicitation.redis',
    );
  });
});
