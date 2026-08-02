/**
 * `subscriptions/listen` — SEP-2575.
 *
 * Replaces the HTTP GET stream and `resources/subscribe`/`unsubscribe` with a
 * single long-lived POST-response stream carrying only the notification types
 * the client explicitly opted in to.
 */
import { expect, test } from '@frontmcp/testing';

import {
  INVALID_PARAMS,
  mcpStatelessFetch,
  META_SUBSCRIPTION_ID,
  openMcpStatelessStream,
} from './helpers/mcp-stateless-client';

test.describe('protocol 2026-07-28 — subscriptions/listen', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('opens an SSE response stream', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-1',
      params: { notifications: { toolsListChanged: true } },
    });

    try {
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      stream.close();
    }
  });

  test('sets X-Accel-Buffering: no on the stream', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-2',
      params: { notifications: { toolsListChanged: true } },
    });

    try {
      expect(stream.headers.get('x-accel-buffering')).toBe('no');
    } finally {
      stream.close();
    }
  });

  test('acknowledges the subscription as its first message', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-3',
      params: { notifications: { toolsListChanged: true, resourcesListChanged: true } },
    });

    try {
      const ack = await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');

      expect(ack.params.notifications).toBeDefined();
      expect(ack.params.notifications.toolsListChanged).toBe(true);
      // The acknowledgement must be the FIRST message on the subscription.
      expect(stream.received()[0].method).toBe('notifications/subscriptions/acknowledged');
    } finally {
      stream.close();
    }
  });

  test('tags every subscription message with the subscriptionId', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-4',
      params: { notifications: { toolsListChanged: true } },
    });

    try {
      const ack = await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');
      expect(ack.params._meta?.[META_SUBSCRIPTION_ID]).toBe('sub-4');
    } finally {
      stream.close();
    }
  });

  test('omits notification types the server cannot honor', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-5',
      params: { notifications: { toolsListChanged: true, promptsListChanged: true } },
    });

    try {
      const ack = await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');
      // Only types the server actually supports may appear in the ack set.
      for (const [key, value] of Object.entries(ack.params.notifications)) {
        expect(typeof value === 'boolean' || Array.isArray(value)).toBe(true);
        expect(['toolsListChanged', 'promptsListChanged', 'resourcesListChanged', 'resourceSubscriptions']).toContain(
          key,
        );
      }
    } finally {
      stream.close();
    }
  });

  test('does not send unrequested notification types', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-6',
      params: { notifications: { resourcesListChanged: true } },
    });

    try {
      const ack = await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');
      expect(ack.params.notifications.toolsListChanged).toBeUndefined();
    } finally {
      stream.close();
    }
  });

  test('accepts resourceSubscriptions in place of resources/subscribe', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-7',
      params: { notifications: { resourceSubscriptions: ['proto://config'] } },
    });

    try {
      const ack = await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');
      expect(ack.params.notifications.resourceSubscriptions).toEqual(['proto://config']);
    } finally {
      stream.close();
    }
  });

  test('does not deliver request-scoped notifications on the listen stream', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'sub-8',
      params: { notifications: { toolsListChanged: true } },
    });

    try {
      await stream.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged');
      await new Promise((r) => setTimeout(r, 500));

      const methods = stream.received().map((m) => m.method);
      expect(methods).not.toContain('notifications/progress');
      expect(methods).not.toContain('notifications/message');
    } finally {
      stream.close();
    }
  });
});

test.describe('protocol 2026-07-28 — subscriptions/listen validation', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('rejects a non-array resourceSubscriptions with -32602', async ({ server }) => {
    // Must fail BEFORE the SSE headers are committed — once the stream is open
    // there is no way to send a JSON-RPC error instead.
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'bad-1',
      params: { notifications: { resourceSubscriptions: 42 } },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    expect(res.json().error.code).toBe(INVALID_PARAMS);
  });

  test('rejects a non-object notifications filter', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'bad-2',
      params: { notifications: 'everything' },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(INVALID_PARAMS);
  });

  test('rejects an id that is not a string or number', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: { nested: true } as unknown as string,
      params: { notifications: { toolsListChanged: true } },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(INVALID_PARAMS);
  });
});
