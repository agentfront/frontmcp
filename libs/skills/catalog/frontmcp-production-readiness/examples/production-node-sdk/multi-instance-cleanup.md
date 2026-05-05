---
name: multi-instance-cleanup
reference: production-node-sdk
level: advanced
description: 'Shows how multiple SDK instances can coexist without conflicts, and how to clean up timers and listeners — given that `@Provider` classes have **no** `onInit` / `onDestroy` lifecycle hooks. The pattern is: initialize in the constructor, expose an explicit `stop()` method, and have the host app call it before `server.dispose()`.'
tags:
  - production
  - sdk
  - node
  - multi
  - instance
  - cleanup
features:
  - Explicit `stop()` method on providers (since `@Provider` classes have no `onDestroy` lifecycle hook)
  - Ensuring multiple instances coexist without sharing global state
  - Testing that dispose removes all event listeners (no leaks)
  - Verifying one instance still works after another is disposed
---

# Multi-Instance Coexistence and Cleanup

Shows how multiple SDK instances can coexist without conflicts, and how to clean up timers and listeners — given that `@Provider` classes have **no** `onInit` / `onDestroy` lifecycle hooks. The pattern is: initialize in the constructor, expose an explicit `stop()` method, and have the host app call it before `server.dispose()`.

## Code

```typescript
// src/providers/polling.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const POLLER = Symbol('Poller');

@Provider({ token: POLLER, scope: ProviderScope.GLOBAL })
export class PollingProvider {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private listeners: Array<() => void> = [];

  constructor() {
    // Init at construction time — there is no async onInit hook on providers.
    this.intervalId = setInterval(() => {
      this.listeners.forEach((fn) => fn());
    }, 10_000);
    // Don't keep the event loop alive on its own.
    this.intervalId.unref?.();
  }

  addListener(fn: () => void): void {
    this.listeners.push(fn);
  }

  /**
   * Explicit cleanup. Host app calls this before `server.dispose()`.
   * (Providers have no onDestroy hook, so this is the explicit pattern.)
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.listeners.length = 0;
  }
}
```

```typescript
// test/multi-instance.spec.ts
import { create } from '../src/index';

describe('Multi-instance coexistence', () => {
  it('should run two instances side by side without conflicts', async () => {
    // Create two independent instances
    const server1 = await create();
    const server2 = await create();

    const client1 = await server1.connect();
    const client2 = await server2.connect();

    // Both should work independently
    const tools1 = await client1.listTools();
    const tools2 = await client2.listTools();

    expect(tools1.tools.length).toBeGreaterThan(0);
    expect(tools2.tools.length).toBeGreaterThan(0);

    // Clean up instance 1: stop providers (cancels timers / clears listeners),
    // then dispose the server. The framework does NOT call provider.stop() for
    // you — it's the host app's responsibility, which is why the provider
    // exposes the explicit method.
    server1.scope.providers.get(BackgroundJobProvider).stop();
    await client1.close();
    await server1.dispose();

    // Instance 2 still works after instance 1 is disposed
    const result = await client2.callTool('my_tool', { input: 'still-alive' });
    expect(result).toBeDefined();

    server2.scope.providers.get(BackgroundJobProvider).stop();
    await client2.close();
    await server2.dispose();
  });

  it('should not leak event listeners after dispose', async () => {
    const initialListeners = process.listenerCount('SIGTERM');

    const server = await create();
    const client = await server.connect();

    await client.close();
    await server.dispose();

    // No dangling SIGTERM listeners after dispose
    expect(process.listenerCount('SIGTERM')).toBe(initialListeners);
  });
});
```

## What This Demonstrates

- Explicit `stop()` method on providers (since `@Provider` classes have no `onDestroy` lifecycle hook)
- Ensuring multiple instances coexist without sharing global state
- Testing that dispose removes all event listeners (no leaks)
- Verifying one instance still works after another is disposed

## Related

- See `production-node-sdk` for the full memory and cleanup checklist
