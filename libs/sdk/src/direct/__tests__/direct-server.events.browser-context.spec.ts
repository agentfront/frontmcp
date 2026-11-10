import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { event, LogLevel, Tool, ToolContext } from '../../common';
import { EventsNotEnabledError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { create } from '../create';
import { type DirectMcpServer } from '../direct.types';

/**
 * A browser build without native `AsyncContext` runs one request at a time (`#async-context` → the browser
 * implementation). An open `events/stream` must not hold that turn, or every later request of the page would wait.
 */
jest.mock('#async-context', () => jest.requireActual('../../../../utils/src/async-context/browser-async-context'));

const routeChanged = event({
  name: 'route.changed',
  payloadSchema: { pathname: z.string() },
});

@Tool({ name: 'go', inputSchema: { pathname: z.string() } })
class GoTool extends ToolContext {
  async execute(input: { pathname: string }) {
    return this.events.publish(routeChanged, input);
  }
}

describe('events of a create() server on the browser async-context runtime', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await create({
      info: { name: 'browser-events', version: '1.0.0' },
      tools: [GoTool],
      eventDefinitions: [routeChanged],
      logging: { level: LogLevel.Off },
      cacheKey: 'browser-events',
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('serves other requests while a push subscription is open, and pushes to it', async () => {
    const client = await server.connect({ session: { id: 'page', user: { sub: 'reader' } } });
    const subscription = await client.events.subscribe('route.changed');
    const next = subscription[Symbol.asyncIterator]().next();

    const called = await client.callTool('go', { pathname: '/orders' });
    await server.events.publish('route.changed', { pathname: '/settings' });
    const occurrence = await next;
    await subscription.cancel();
    await client.close();

    expect(subscription.mode).toBe('push');
    expect(called).toBeDefined();
    expect(occurrence.value?.data).toEqual({ pathname: '/orders' });
  });

  it('rejects publishing on a server without events', async () => {
    const plain = await FrontMcpInstance.createDirect({
      info: { name: 'no-events', version: '1.0.0' },
      apps: [],
      logging: { level: LogLevel.Off },
    });

    await expect(plain.events.publish('route.changed', {})).rejects.toBeInstanceOf(EventsNotEnabledError);
    await plain.dispose();
  });
});
