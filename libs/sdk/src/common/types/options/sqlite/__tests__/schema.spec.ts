import { frontMcpMetadataSchema } from '../../../../metadata/front-mcp.metadata';
import { transportOptionsSchema } from '../../transport';
import { sqliteOptionsSchema } from '../schema';

describe('sqliteOptionsSchema', () => {
  it('keeps busyTimeoutMs (#680 — it was stripped, so the store always waited 5 s)', () => {
    const parsed = sqliteOptionsSchema.parse({ path: '/tmp/sessions.sqlite', busyTimeoutMs: 250 });
    expect(parsed.busyTimeoutMs).toBe(250);
  });

  it('leaves busyTimeoutMs unset so the storage default applies', () => {
    const parsed = sqliteOptionsSchema.parse({ path: '/tmp/sessions.sqlite' });
    expect(parsed.busyTimeoutMs).toBeUndefined();
  });

  it('accepts 0 (fail at once on a held lock)', () => {
    expect(sqliteOptionsSchema.parse({ busyTimeoutMs: 0 }).busyTimeoutMs).toBe(0);
  });

  it.each([-1, 1.5, '100'])('rejects busyTimeoutMs %p', (value) => {
    expect(sqliteOptionsSchema.safeParse({ busyTimeoutMs: value }).success).toBe(false);
  });

  it('keeps busyTimeoutMs on transport.persistence.sqlite', () => {
    const parsed = transportOptionsSchema.parse({
      persistence: { sqlite: { path: '/tmp/s.sqlite', busyTimeoutMs: 75 } },
    });
    const persistence = parsed.persistence as { sqlite?: { busyTimeoutMs?: number } };
    expect(persistence.sqlite?.busyTimeoutMs).toBe(75);
  });

  it('keeps busyTimeoutMs on the top-level @FrontMcp sqlite block and tasks.sqlite', () => {
    const parsed = frontMcpMetadataSchema.parse({
      info: { name: 'sqlite-busy', version: '1.0.0' },
      apps: [],
      sqlite: { path: '/tmp/s.sqlite', busyTimeoutMs: 125 },
      tasks: { sqlite: { path: '/tmp/t.sqlite', busyTimeoutMs: 50 } },
    }) as { sqlite?: { busyTimeoutMs?: number }; tasks?: { sqlite?: { busyTimeoutMs?: number } } };
    expect(parsed.sqlite?.busyTimeoutMs).toBe(125);
    expect(parsed.tasks?.sqlite?.busyTimeoutMs).toBe(50);
  });
});
