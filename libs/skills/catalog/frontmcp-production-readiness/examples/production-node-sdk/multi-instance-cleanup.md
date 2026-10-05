---
name: multi-instance-cleanup
reference: production-node-sdk
level: advanced
description: 'Shows how multiple SDK instances can coexist without conflicts, and how to clean up timers and listeners — given that `@Provider` classes have **no** `onInit` / `onDestroy` lifecycle hooks. The pattern is: initialize in the constructor, expose a `stop()` method, and register it with `scope.onDispose()` from a factory provider so `server.dispose()` runs it.'
tags:
  - production
  - sdk
  - node
  - multi
  - instance
  - cleanup
features:
  - '`stop()` registered with `scope.onDispose()` from a factory provider that injects `ScopeEntry` (since `@Provider` classes have no `onDestroy` lifecycle hook)'
  - Ensuring multiple instances coexist without sharing global state
  - Testing that dispose removes all event listeners (no leaks)
  - Verifying one instance still works after another is disposed
---

# Multi-Instance Coexistence and Cleanup

Shows how multiple SDK instances can coexist without conflicts, and how to clean up timers and listeners — given that `@Provider` classes have **no** `onInit` / `onDestroy` lifecycle hooks. The pattern is: initialize in the constructor, expose a `stop()` method, and register it with `scope.onDispose()` from a factory provider so `server.dispose()` runs it.

## Code

```typescript
// src/providers/polling.provider.ts
import { ScopeEntry } from '@frontmcp/sdk';

export class Poller {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private readonly listeners: Array<() => void> = [];

  constructor() {
    // Init at construction time — there is no async onInit hook on providers.
    this.intervalId = setInterval(() => {
      this.listeners.forEach((listener) => listener());
    }, 10_000);
    // Don't keep the event loop alive on its own.
    this.intervalId.unref?.();
  }

  addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.listeners.length = 0;
  }
}

// Register it with `providers: [pollerProvider]`; tools resolve the instance with `this.get(Poller)`.
export const pollerProvider = {
  name: 'Poller',
  provide: Poller,
  inject: () => [ScopeEntry],
  useFactory: (scope: ScopeEntry) => {
    const poller = new Poller();
    // Each instance's server.dispose() runs its own scope's dispose callbacks.
    scope.onDispose(() => poller.stop());
    return poller;
  },
};
```

```typescript
// test/multi-instance.spec.ts
import { create } from '../src/index';

describe('Multi-instance coexistence', () => {
  it('should run two instances side by side without conflicts', async () => {
    // Create two independent instances
    const server1 = await create();
    const server2 = await create();

    // Both should work independently
    const { tools: tools1 } = await server1.listTools();
    const { tools: tools2 } = await server2.listTools();

    expect(tools1.length).toBeGreaterThan(0);
    expect(tools2.length).toBeGreaterThan(0);

    // dispose() runs instance 1's onDispose callbacks, which stop its poller.
    await server1.dispose();

    // Instance 2 still works after instance 1 is disposed
    const result = await server2.callTool('my_tool', { input: 'still-alive' });
    expect(result.isError).toBeFalsy();

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

- `stop()` registered with `scope.onDispose()` from a factory provider that injects `ScopeEntry` (since `@Provider` classes have no `onDestroy` lifecycle hook)
- Ensuring multiple instances coexist without sharing global state
- Testing that dispose removes all event listeners (no leaks)
- Verifying one instance still works after another is disposed

## Related

- See `production-node-sdk` for the full memory and cleanup checklist
- See `create-plugin-hooks` in `frontmcp-development` (Server Lifecycle Hooks) for `scope.onDispose()`
