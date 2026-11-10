/** @jest-environment node */
import { create, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import { createRouteChangedEvent } from '../route-changed.event';

describe('createRouteChangedEvent', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await create({
      info: { name: 'route-events', version: '1.0.0' },
      eventDefinitions: [createRouteChangedEvent(), createRouteChangedEvent('page.viewed')],
      logging: { level: LogLevel.Off },
      cacheKey: 'route-events',
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('declares the event under its name and the one given', async () => {
    const client = await server.connect();
    const names = (await client.events.list()).map((definition) => definition.name);
    await client.close();

    expect(names.sort()).toEqual(['page.viewed', 'route.changed']);
  });

  it('reaches an in-page subscriber by push when a navigation is published', async () => {
    const client = await server.connect({ session: { id: 'page', user: { sub: 'reader' } } });
    const subscription = await client.events.subscribe('route.changed');
    const next = subscription[Symbol.asyncIterator]().next();

    await server.events.publish('route.changed', { pathname: '/b', search: '', hash: '', previous: '/a' });
    const { value } = await next;
    await subscription.cancel();
    await client.close();

    expect(subscription.mode).toBe('push');
    expect(value?.data).toEqual({ pathname: '/b', search: '', hash: '', previous: '/a' });
  });

  it('refuses a navigation without the fields of its payload', async () => {
    await expect(server.events.publish('route.changed', { pathname: '/b' })).rejects.toThrow('payloadSchema');
  });
});
