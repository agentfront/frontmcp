// file: libs/adapters/src/skills/__tests__/resource-change-notification.spec.ts

import {
  buildResourceChangeNotification,
  ClassificationRegistry,
  classifyOperations,
  renderResourceUri,
} from '../index';

describe('renderResourceUri', () => {
  it('substitutes single-placeholder templates with the URL-encoded value', () => {
    const r = renderResourceUri('mcp+op://acme/users/{id}', { id: '42' });
    expect(r).toEqual({ ok: true, uri: 'mcp+op://acme/users/42' });
  });

  it('URL-encodes values that contain reserved characters', () => {
    const r = renderResourceUri('mcp+op://acme/users/{id}', { id: 'a b/c#d' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.uri).toBe(`mcp+op://acme/users/${encodeURIComponent('a b/c#d')}`);
    }
  });

  it('coerces number and boolean args to strings', () => {
    expect(renderResourceUri('mcp+op://x/{n}', { n: 0 })).toEqual({ ok: true, uri: 'mcp+op://x/0' });
    expect(renderResourceUri('mcp+op://x/{b}', { b: false })).toEqual({ ok: true, uri: 'mcp+op://x/false' });
  });

  it('substitutes multiple placeholders preserving order', () => {
    const r = renderResourceUri('mcp+op://acme/users/{userId}/posts/{postId}', { userId: '7', postId: '12' });
    expect(r).toEqual({ ok: true, uri: 'mcp+op://acme/users/7/posts/12' });
  });

  it('returns missing list when a placeholder is unresolved', () => {
    const r = renderResourceUri('mcp+op://acme/users/{id}', {});
    expect(r).toEqual({ ok: false, missing: ['id'] });
  });

  it('collects every missing placeholder in source order', () => {
    const r = renderResourceUri('mcp+op://acme/users/{userId}/posts/{postId}', { postId: '12' });
    expect(r).toEqual({ ok: false, missing: ['userId'] });

    const r2 = renderResourceUri('mcp+op://acme/users/{userId}/posts/{postId}', {});
    expect(r2).toEqual({ ok: false, missing: ['userId', 'postId'] });
  });

  it('treats null / undefined / object values as missing (no fabrication)', () => {
    expect(renderResourceUri('mcp+op://x/{a}', { a: null })).toEqual({ ok: false, missing: ['a'] });
    expect(renderResourceUri('mcp+op://x/{a}', { a: undefined })).toEqual({ ok: false, missing: ['a'] });
    expect(renderResourceUri('mcp+op://x/{a}', { a: { nested: 1 } })).toEqual({ ok: false, missing: ['a'] });
  });

  it('returns ok with the template verbatim when there are no placeholders', () => {
    expect(renderResourceUri('mcp+op://acme/users', { id: 'ignored' })).toEqual({
      ok: true,
      uri: 'mcp+op://acme/users',
    });
  });

  it('handles empty / non-string template', () => {
    expect(renderResourceUri('', { id: '1' })).toEqual({ ok: false, missing: [] });
    expect(renderResourceUri(undefined as unknown as string, {})).toEqual({ ok: false, missing: [] });
  });

  it('tolerates a non-object args (treats as empty)', () => {
    expect(renderResourceUri('mcp+op://x/{a}', null)).toEqual({ ok: false, missing: ['a'] });
    expect(renderResourceUri('mcp+op://x/{a}', 'string-args')).toEqual({ ok: false, missing: ['a'] });
  });
});

describe('buildResourceChangeNotification', () => {
  it('returns null with reason=no-emit when the classification has no emit', () => {
    const result = buildResourceChangeNotification({ emit: undefined }, { id: '42' });
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('no-emit');
  });

  it('builds an updated notification with a rendered URI', () => {
    const result = buildResourceChangeNotification(
      {
        emit: {
          kind: 'updated',
          pathTemplate: '/users/{id}',
          resourceUriTemplate: 'mcp+op://acme/users/{id}',
        },
      },
      { id: '42' },
    );
    expect(result.notification).toEqual({
      method: 'notifications/resources/updated',
      params: { uri: 'mcp+op://acme/users/42' },
    });
    expect(result.reason).toBeUndefined();
  });

  it('builds a list_changed notification (no URI in params, per MCP spec)', () => {
    const result = buildResourceChangeNotification(
      {
        emit: {
          kind: 'listChanged',
          pathTemplate: '/users',
          resourceUriTemplate: 'mcp+op://acme/users',
        },
      },
      {},
    );
    expect(result.notification).toEqual({ method: 'notifications/resources/list_changed' });
  });

  it('suppresses the notification when the template has unresolved placeholders (updated)', () => {
    const result = buildResourceChangeNotification(
      {
        emit: { kind: 'updated', pathTemplate: '/u/{id}', resourceUriTemplate: 'mcp+op://acme/u/{id}' },
      },
      {},
    );
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('unresolved-template');
    expect(result.missing).toEqual(['id']);
  });

  it('suppresses the notification when the template has unresolved placeholders (listChanged)', () => {
    // A `listChanged` event on a path that requires {id} substitution
    // (e.g. /users/{id}/posts) should also be suppressed when the args
    // can't satisfy the template — surfaces misconfigurations rather than
    // silently emitting against an under-rendered URI.
    const result = buildResourceChangeNotification(
      {
        emit: {
          kind: 'listChanged',
          pathTemplate: '/users/{id}/posts',
          resourceUriTemplate: 'mcp+op://acme/users/{id}/posts',
        },
      },
      {},
    );
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('unresolved-template');
    expect(result.missing).toEqual(['id']);
  });
});

describe('ClassificationRegistry', () => {
  it('registers and looks up by tool name', () => {
    const r = new ClassificationRegistry();
    const classified = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);
    r.register('acme.getUser', classified[0]);

    expect(r.lookup('acme.getUser')).toEqual(classified[0]);
    expect(r.size()).toBe(1);
  });

  it('register() returns the previous classification when overwriting', () => {
    const r = new ClassificationRegistry();
    const [a] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users' }]);
    const [b] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);

    expect(r.register('acme.getUser', a)).toBeUndefined();
    expect(r.register('acme.getUser', b)).toEqual(a);
    expect(r.lookup('acme.getUser')).toEqual(b);
  });

  it('throws on register with empty toolName', () => {
    const r = new ClassificationRegistry();
    const [c] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);
    expect(() => r.register('', c)).toThrow(/non-empty string/);
  });

  it('registerAll partitions added vs replaced and uses ${specId}.${operationId}', () => {
    const r = new ClassificationRegistry();
    const ops = classifyOperations('acme', [
      { operationId: 'getUser', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
    ]);

    expect(r.registerAll(ops)).toEqual({ added: 2, replaced: 0 });
    expect(r.size()).toBe(2);
    expect(r.lookup('acme.getUser')?.operationId).toBe('getUser');

    // Re-register one of them
    expect(r.registerAll([ops[0]])).toEqual({ added: 0, replaced: 1 });
    expect(r.size()).toBe(2);
  });

  it('unregister and clear behave as expected', () => {
    const r = new ClassificationRegistry();
    const [c] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);
    r.register('acme.getUser', c);

    expect(r.unregister('acme.getUser')).toBe(true);
    expect(r.unregister('acme.getUser')).toBe(false);
    expect(r.size()).toBe(0);

    r.register('acme.getUser', c);
    r.clear();
    expect(r.size()).toBe(0);
  });

  it('getAll returns a snapshot in insertion order', () => {
    const r = new ClassificationRegistry();
    const ops = classifyOperations('acme', [
      { operationId: 'a', method: 'GET', path: '/a' },
      { operationId: 'b', method: 'GET', path: '/b' },
      { operationId: 'c', method: 'GET', path: '/c' },
    ]);
    r.registerAll(ops);

    const snapshot = r.getAll();
    expect(snapshot.map((s) => s.toolName)).toEqual(['acme.a', 'acme.b', 'acme.c']);
  });

  it('buildNotificationForCall returns no-emit when tool is not registered', () => {
    const r = new ClassificationRegistry();
    const result = r.buildNotificationForCall('unknown', {});
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('no-emit');
  });

  it('buildNotificationForCall returns no-emit for read-only ops', () => {
    const r = new ClassificationRegistry();
    const [c] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);
    r.register('acme.getUser', c);

    const result = r.buildNotificationForCall('acme.getUser', { id: '42' });
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('no-emit');
  });

  it('buildNotificationForCall emits updated for a PUT with rendered args', () => {
    const r = new ClassificationRegistry();
    const ops = classifyOperations('acme', [
      { operationId: 'getUser', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
    ]);
    r.registerAll(ops);

    const result = r.buildNotificationForCall('acme.updateUser', { id: '42' });
    expect(result.notification).toEqual({
      method: 'notifications/resources/updated',
      params: { uri: 'mcp+op://acme/users/42' },
    });
  });

  it('buildNotificationForCall emits list_changed for a DELETE on parent collection', () => {
    const r = new ClassificationRegistry();
    const ops = classifyOperations('acme', [
      { operationId: 'listUsers', method: 'GET', path: '/users' },
      { operationId: 'getUser', method: 'GET', path: '/users/{id}' },
      { operationId: 'deleteUser', method: 'DELETE', path: '/users/{id}' },
    ]);
    r.registerAll(ops);

    const result = r.buildNotificationForCall('acme.deleteUser', { id: '42' });
    expect(result.notification).toEqual({ method: 'notifications/resources/list_changed' });
  });

  it('buildNotificationForCall surfaces missing placeholders without emitting', () => {
    const r = new ClassificationRegistry();
    const ops = classifyOperations('acme', [
      { operationId: 'getUser', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
    ]);
    r.registerAll(ops);

    const result = r.buildNotificationForCall('acme.updateUser', {});
    expect(result.notification).toBeNull();
    expect(result.reason).toBe('unresolved-template');
    expect(result.missing).toEqual(['id']);
  });
});
