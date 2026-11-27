import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { event, LogLevel, ScopeEntry } from '../../common';
import type { DirectClient } from '../client.types';
import { create } from '../create';
import type { DirectMcpServer } from '../direct.types';

const reportReady = event({
  name: 'report.ready',
  inputSchema: { team: z.string().optional() },
  payloadSchema: { reportId: z.string() },
  delivery: ['poll'],
  // With a lifecycle method, each poll subscription gets a lease the server holds
  onSubscribe: () => undefined,
});

describe('DirectMcpServer.scope', () => {
  let server: DirectMcpServer;
  let client: DirectClient;

  beforeAll(async () => {
    server = await create({
      info: { name: 'direct-server-scope', version: '1.0.0' },
      eventDefinitions: [reportReady],
      events: { poll: { nextPollMs: 30 } },
      logging: { level: LogLevel.Off },
    });
    client = await server.connect({ session: { id: 'direct-scope', user: { sub: 'ada' } } });
  });

  afterAll(async () => {
    await client.close();
    await server.dispose();
  });

  it('is the scope the server serves, with its events', () => {
    expect(server.scope).toBeInstanceOf(ScopeEntry);
    expect(server.scope?.events?.findByName('report.ready')?.name).toBe('report.ready');
  });

  it('shows what the server holds for a subscription a client made, without a cast', async () => {
    const subscription = await client.events.subscribe('report.ready', { team: 'ops' });

    const listed = (await server.scope?.events?.listSubscriptions('report.ready')) ?? [];
    await subscription.cancel();

    expect(listed).toEqual([expect.objectContaining({ mode: 'poll', arguments: { team: 'ops' } })]);
  });

  it('is read-only', () => {
    const before = server.scope;

    expect(() => {
      // @ts-expect-error the scope is read-only
      server.scope = undefined;
    }).toThrow(TypeError);
    expect(server.scope).toBe(before);
  });
});
