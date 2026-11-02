---
name: create-duty
description: Run recurring work in exactly one process of the machine or project with @Duty, a lease that one process holds and another takes over when the holder dies
---

# Duties: Recurring Work in One Process

A duty is a provider class with a `run()` method that the server calls every `every`, in one process at a time. When
several copies of a server run on one machine (a stdio server per client, several HTTP workers), all of them start the
duty, and the one holding its lease runs it. The lease lives in a store every process shares, so when the holder exits
or hangs, another process takes the duty over once the lease runs out.

## When to Use This Skill

### Must Use

- Recurring work that must not run in every process: pruning a cache the servers on a machine share, compacting a
  SQLite file, re-indexing a project
- Several copies of the server run at once on one machine, and the work must run once per interval among them

### Recommended

- Replacing a `setInterval()` started in a provider's `onReady()` when the copies of the server would repeat the work
  or conflict over it

### Skip When

- Each process needs its own copy of the work, such as refreshing an in-memory cache: start a timer in a provider's
  `onReady()` (see `create-provider`)
- A client triggers the work and needs retries or progress (see `create-job`)
- The server runs serverless or on the edge: a duty needs a long-lived process, and is not started there

> **Decision:** Use `@Duty` when work must run on a schedule in one process of the machine (`scope: 'machine'`) or of
> the project (`scope: 'workspace'`).

## Prerequisites

- `@frontmcp/storage-sqlite` installed, where the leases live by default. A server with a top-level `redis` keeps them
  in Redis instead.
- A server `info.name`: leases are per server name, so two servers with a duty of the same name don't share it.

## Steps

### Step 1: Write the duty

```typescript
import { Duty, type DutyInterface, type DutyRunContext } from '@frontmcp/sdk';

import { CacheStore } from './cache.store';

@Duty({ name: 'prune-cache', every: '10m', scope: 'machine' })
export class PruneCacheDuty implements DutyInterface {
  constructor(private readonly cache: CacheStore) {}

  async run({ signal }: DutyRunContext): Promise<void> {
    for (const key of await this.cache.expiredKeys()) {
      if (signal.aborted) return; // the lease was lost or the server is shutting down
      await this.cache.delete(key);
    }
  }
}
```

A duty is a GLOBAL provider: its constructor gets its dependencies injected, and it can implement `onBootstrap()`,
`onReady()` and `onShutdown()` like any provider.

### Step 2: Register it in `providers`

```typescript
@App({ name: 'cache', providers: [CacheStore, PruneCacheDuty] })
class CacheApp {}
```

`@FrontMcp({ providers })` and a plugin's `providers` work too. The duty starts once the server serves (the
`onReady()` phase) and stops at shutdown, before the providers it depends on.

### Step 3 (optional): Run duties from a script

`createContainer()` builds a duty without starting it. To run duties without serving MCP, ask for it:

```typescript
const container = await createContainer({
  apps: [CacheApp],
  runDuties: true,
  info: { name: 'cache-server' }, // the server's info.name, so the script and the server share the leases (default 'frontmcp')
});
// ...
await container.dispose(); // stops the duties and releases their leases
```

## `@Duty` Options

| Field     | Type                                                        | Default                                 | Notes                                                                                                                  |
| --------- | ----------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`    | `string`                                                    | The class name                          | The lease's name in the server. Set it when the build renames classes                                                  |
| `every`   | `number` (ms) or `'500ms'`, `'30s'`, `'5m'`, `'1h'`, `'1d'` | Required                                | From 1 ms to 2147483647 ms (about 24.8 days)                                                                           |
| `scope`   | `'machine'` or `'workspace'`                                | Required                                | `'workspace'`: one holder per project root: the nearest folder at or above the working directory with a `package.json` |
| `leaseMs` | `number`                                                    | Three intervals, between 3000 and 60000 | At least 1000 (stores keep a TTL in whole seconds). How soon another process takes over from a holder that died        |

An invalid option throws `InvalidDecoratorMetadataError` (`INVALID_DECORATOR_METADATA`) when the class is decorated,
for example `@Duty invalid metadata for "every": every must be milliseconds or a duration such as "30s", "5m", "1h"`. A
class without `run()` fails to compile, and throws `@Duty invalid metadata for "run": <Class> has no run() method`.

## How the Lease Works

- **Acquire.** Each process sets the lease key to its own id with a TTL of `leaseMs`, only if the key is absent. The one
  whose id is stored holds the duty.
- **Renew.** The holder extends the TTL every third of `leaseMs`, only while the key still holds its id. The others try
  to acquire at the same pace.
- **Expire.** The store's TTL decides when a lease ends; processes never compare their clocks. A killed or hung holder
  stops renewing, and another process takes the duty over within `leaseMs` plus a third of it.
- **Release.** At shutdown the holder aborts the run in flight, waits for it, and deletes the key only while it still
  holds its id. Another process takes over at its next check.
- **Before each run** the holder renews the lease. A holder paused past its lease (SIGSTOP, a long GC pause) finds the
  key taken when it wakes, and does not run. A run in flight when the lease is lost sees `signal` aborted.
- **Once per interval.** A run that would start while the last one is still running is skipped, not queued. A run
  failure is logged and the holder keeps the lease. A process that takes the lease over waits until an interval has
  passed since the last run started, in whichever process ran it.

## Where Leases Live

| Server config                        | Store                                                                    | Key                                                |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------- |
| No top-level `redis` (the default)   | SQLite file `~/.frontmcp/duties.sqlite` (`$FRONTMCP_HOME/duties.sqlite`) | `frontmcp:duty:<info.name>:<duty name>`            |
| A top-level `redis` (Redis provider) | That Redis                                                               | `frontmcp:duty:<hostname>:<info.name>:<duty name>` |

A `'workspace'` duty's key ends with the SHA-256 of the project root. The store never falls back to memory: a missing
`@frontmcp/storage-sqlite` or an unreachable Redis is logged as `Provider "<Class>" failed in onReady(): <cause>`, and
the duty does not run.

## Log Lines

| Level   | Message                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------- |
| info    | `Duty "<name>" runs in this process every <ms> ms` (this process took the lease)               |
| warn    | `Duty "<name>" lost its lease; another process runs it now`                                    |
| warn    | `Duty "<name>": the lease store failed: <cause>` (that check or run is skipped and retried)    |
| error   | `Duty "<name>" failed: <cause>` (the run threw; the lease is kept)                             |
| verbose | `Duty "<name>" is still running; skipping this run`                                            |
| warn    | `Duty "<name>" does not run in a serverless or edge deployment: it needs a long-lived process` |

## Common Patterns

| Pattern              | Correct                                                   | Incorrect                                             | Why                                                                      |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Shared periodic work | `@Duty({ every, scope })` in `providers`                  | `setInterval()` in a provider's `onReady()`           | Every copy of the server would run the interval                          |
| Long runs            | Check `signal.aborted` between steps                      | Ignore `signal`                                       | A run that lost its lease keeps going until it looks                     |
| Stable names         | `@Duty({ name: 'prune-cache', ... })` in a minified build | Rely on the class name after minification             | The lease key comes from the name                                        |
| Scripts              | `createContainer({ runDuties: true, info: { name } })`    | Expect `createContainer()` to start duties on its own | A container never runs duties unless asked, so scripts and workers don't |

## Verification Checklist

### Configuration

- [ ] The duty class has `run()` and is in a `providers` array
- [ ] `scope` matches who shares the work: the whole machine, or one project
- [ ] `@frontmcp/storage-sqlite` is installed, or the server has a top-level `redis`
- [ ] A `name` is set when the build minifies class names

### Runtime

- [ ] Started several times, the server logs `runs in this process` once
- [ ] Killing that process makes another log it within `leaseMs` plus a third of it
- [ ] Long runs return when `signal` is aborted

## Troubleshooting

| Problem                                   | Cause                                                                     | Solution                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The duty never runs                       | Not in `providers`; a `createContainer()` without `runDuties`; serverless | Register it; pass `runDuties: true`; run it in a long-lived process              |
| `failed in onReady()` naming the duty     | The lease store can't be opened                                           | Install `@frontmcp/storage-sqlite`, or check the `redis` connection              |
| It runs in two processes at once          | Different `info.name` or duty `name`, or `'workspace'` in two projects    | Give them the same names; use `'machine'` to share across projects               |
| A takeover is slow after a crash          | The lease must expire first                                               | Lower `leaseMs` (at least 1000)                                                  |
| `lost its lease` while the holder is busy | The event loop was blocked longer than the lease                          | Keep runs asynchronous, move CPU-heavy work off the main thread, raise `leaseMs` |

## Reference

- [Providers](https://frontmcp.dev/reference/sdk/provider)
- Related skills: `create-provider` (lifecycle hooks, `createContainer()`), `create-job`, `decorators-guide`,
  `setup-sqlite`
