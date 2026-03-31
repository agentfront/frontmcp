---
name: multi-instance-cleanup
reference: production-node-sdk
level: advanced
description: 'Shows how multiple SDK instances can coexist without conflicts, and how to implement proper cleanup to prevent memory leaks from event listeners, timers, and provider resources.'
tags: [production, sdk, node, multi, instance, cleanup]
features:
  - 'Implementing `onDestroy()` in providers to clean up timers and listeners'
  - 'Ensuring multiple instances coexist without sharing global state'
  - 'Testing that dispose removes all event listeners (no leaks)'
  - 'Verifying one instance still works after another is disposed'
---

# Multi-Instance Coexistence and Cleanup

Shows how multiple SDK instances can coexist without conflicts, and how to implement proper cleanup to prevent memory leaks from event listeners, timers, and provider resources.

## Code

```typescript
// src/providers/polling.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const POLLER = Symbol('Poller');

@Provider({ token: POLLER, scope: ProviderScope.GLOBAL })
export class PollingProvider {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private listeners: Array<() => void> = [];

  async onInit(): Promise<void> {
    // Start a polling interval
    this.intervalId = setInterval(() => {
      this.listeners.forEach((fn) => fn());
    }, 10_000);
  }

  addListener(fn: () => void): void {
    this.listeners.push(fn);
  }

  async onDestroy(): Promise<void> {
    // Clean up timer — prevents dangling intervals after dispose
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    // Remove all listener references — prevents memory leaks
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

    // Clean up both — no shared global state
    await client1.close();
    await server1.dispose();

    // Instance 2 still works after instance 1 is disposed
    const result = await client2.callTool('my_tool', { input: 'still-alive' });
    expect(result).toBeDefined();

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

- Implementing `onDestroy()` in providers to clean up timers and listeners
- Ensuring multiple instances coexist without sharing global state
- Testing that dispose removes all event listeners (no leaks)
- Verifying one instance still works after another is disposed

## Related

- See `production-node-sdk` for the full memory and cleanup checklist
