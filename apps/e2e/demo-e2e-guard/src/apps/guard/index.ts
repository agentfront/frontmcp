import { App } from '@frontmcp/sdk';
import RateLimitedTool from './tools/rate-limited.tool';
import ConcurrencyMutexTool from './tools/concurrency-mutex.tool';
import ConcurrencyQueuedTool from './tools/concurrency-queued.tool';
import TimeoutTool from './tools/timeout.tool';
import CombinedGuardTool from './tools/combined-guard.tool';
import UnguardedTool from './tools/unguarded.tool';
import SlowTool from './tools/slow.tool';

@App({
  name: 'guard',
  description: 'Guard E2E testing tools',
  tools: [
    RateLimitedTool,
    ConcurrencyMutexTool,
    ConcurrencyQueuedTool,
    TimeoutTool,
    CombinedGuardTool,
    UnguardedTool,
    SlowTool,
  ],
})
export class GuardApp {}
