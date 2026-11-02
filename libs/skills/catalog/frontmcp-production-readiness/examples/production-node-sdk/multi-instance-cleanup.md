---
name: multi-instance-cleanup
reference: production-node-sdk
level: advanced
description: 'Shows how multiple SDK instances can coexist without conflicts, and how a provider cleans up its timers and listeners: it starts them in `onReady()` and stops them in `onShutdown()`, which `server.dispose()` runs for the providers of that instance only.'
tags:
  - production
  - sdk
  - node
  - multi
  - instance
  - cleanup
features:
  - 'A provider that starts its timer in `onReady()` and stops it in `onShutdown()`, so each `server.dispose()` stops only the timer of its own instance'
  - Ensuring multiple instances coexist without sharing global state
  - Testing that dispose removes all event listeners (no leaks)
  - Verifying one instance still works after another is disposed
---

# Multi-Instance Coexistence and Cleanup

Shows how multiple SDK instances can coexist without conflicts, and how a provider cleans up its timers and listeners: it starts them in `onReady()` and stops them in `onShutdown()`, which `server.dispose()` runs for the providers of that instance only.

## Code

```typescript
// src/providers/polling.provider.ts
import { Provider, type OnReady, type OnShutdown } from '@frontmcp/sdk';

// Register it with `providers: [Poller]`; tools resolve the instance with `this.get(Poller)`.
@Provider({ name: 'Poller' })
export class Poller implements OnReady, OnShutdown {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private readonly listeners: Array<() => void> = [];

  // Runs once the instance serves (here: once `create()` returned)
  onReady(): void {
    this.intervalId = setInterval(() => {
      this.listeners.forEach((listener) => listener());
    }, 10_000);
    // Don't keep the event loop alive on its own.
    this.intervalId.unref?.();
  }

  addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  // Each instance's server.dispose() runs it for that instance's Poller only
  onShutdown(): void {
    clearInterval(this.intervalId);
    this.intervalId = undefined;
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

    // Both should work independently
    const { tools: tools1 } = await server1.listTools();
    const { tools: tools2 } = await server2.listTools();

    expect(tools1.length).toBeGreaterThan(0);
    expect(tools2.length).toBeGreaterThan(0);

    // dispose() runs instance 1's onShutdown() hooks, which stop its poller.
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

- A provider that starts its timer in `onReady()` and stops it in `onShutdown()`, so each `server.dispose()` stops only the timer of its own instance
- Ensuring multiple instances coexist without sharing global state
- Testing that dispose removes all event listeners (no leaks)
- Verifying one instance still works after another is disposed

## Related

- See `production-node-sdk` for the full memory and cleanup checklist
- See `create-provider` in `frontmcp-development` (Provider Lifecycle) for `onBootstrap()`, `onReady()` and `onShutdown()`
