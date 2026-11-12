---
name: create-duty
description: Run recurring work in exactly one process of the machine, the project or the cluster with @Duty, every interval or on a cron schedule, under a lease that one process holds and another takes over when the holder dies
---

# Duties: Recurring Work in One Process

A duty is a provider class with a `run()` method that the server calls every `every`, or at the times of a `cron`
expression, in one process at a time. When several copies of a server run on one machine (a stdio server per client,
several HTTP workers), or on several machines that share a Redis, all of them start the duty, and the one holding its
lease runs it. The lease lives in a store every process shares, so when the holder exits or hangs, another process
takes the duty over once the lease runs out.

## When to Use This Skill

### Must Use

- Recurring work that must not run in every process: pruning a cache the servers on a machine share, compacting a
  SQLite file, re-indexing a project
- Several copies of the server run at once on one machine, and the work must run once per interval among them
- Work on a calendar schedule: a report every weekday at 09:00 in a time zone, a cleanup on the first of the month
- Several machines run the server, and the work must run once among all of them (`scope: 'cluster'`, with Redis)

### Recommended

- Replacing a `setInterval()` started in a provider's `onReady()` when the copies of the server would repeat the work
  or conflict over it

### Skip When

- Each process needs its own copy of the work, such as refreshing an in-memory cache: start a timer in a provider's
  `onReady()` (see `create-provider`)
- A client triggers the work and needs retries or progress (see `create-job`)
- The work never ends by itself: a connection to keep open, a queue to consume, files to watch (see `create-worker`)
- The server runs serverless or on the edge: a duty needs a long-lived process, and is not started there

> **Decision:** Use `@Duty` when work must run on a schedule in one process of the machine (`scope: 'machine'`), of
> the project (`scope: 'workspace'`) or of every machine that shares the server's Redis (`scope: 'cluster'`).

## Prerequisites

- `@frontmcp/storage-sqlite` installed, where the leases live by default. A server with a top-level `redis` keeps them
  in Redis instead.
- For `scope: 'cluster'`, a top-level `redis` (a Redis provider, not Vercel KV): the one lease every machine shares
  lives there. Without it the server refuses to start.
- A distinctive server `info.name`: leases are per server name. Two servers with different names never share a lease;
  two different servers with the same name on one machine (two projects both called `demo`) share every duty of the same
  name, so only one of them runs it, just as they share the `~/.<info.name>/` data folder.

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

A duty on a calendar schedule takes `cron` instead of `every`:

```typescript
@Duty({ name: 'weekday-report', cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', scope: 'cluster' })
export class WeekdayReportDuty implements DutyInterface {
  constructor(private readonly reports: ReportService) {}

  async run({ signal }: DutyRunContext): Promise<void> {
    await this.reports.sendDaily({ signal });
  }
}
```

### Step 2: Register it in `providers`

```typescript
@App({ name: 'cache', providers: [CacheStore, PruneCacheDuty] })
class CacheApp {}
```

`@FrontMcp({ providers })` and a plugin's `providers` work too. The duty starts once the server serves (the
`onReady()` phase) and stops at shutdown, before the providers it depends on.

### Step 3 (optional): Run duties from a script

`createContainer()` builds a duty without starting it. To run duties (and workers) without serving MCP, ask for it.
Each duty's own `onReady()` runs before its first run, as in a server:

```typescript
const container = await createContainer({
  apps: [CacheApp],
  runBackground: true, // starts the @Duty and @Worker providers; runDuties: true, the older name, does the same
  info: { name: 'cache-server' }, // required with runBackground: the server's info.name, so they share its leases
  redis: { url: process.env.REDIS_URL }, // the server's redis, when it has one: needed for scope: 'cluster'
});
// ...
await container.dispose(); // stops the duties and releases their leases
```

A container without `runBackground` builds a `'cluster'` duty without Redis; one that runs duties refuses it, like a
server.

## `@Duty` Options

| Field      | Type                                                        | Default                                                    | Notes                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`     | `string`                                                    | The class name                                             | The lease's name in the server. Set it when the build renames classes                                                                                                                            |
| `every`    | `number` (ms) or `'500ms'`, `'30s'`, `'5m'`, `'1h'`, `'1d'` | One of `every` or `cron`                                   | From 1 ms to 2147483647 ms (about 24.8 days)                                                                                                                                                     |
| `cron`     | `string`                                                    | One of `every` or `cron`                                   | A cron expression of 5 fields, or 6 with seconds first (see Cron Schedules)                                                                                                                      |
| `timezone` | `string`                                                    | `'UTC'`                                                    | The IANA time zone `cron` is read in, such as `'Europe/Berlin'`. Only with `cron`                                                                                                                |
| `scope`    | `'machine'`, `'workspace'` or `'cluster'`                   | Required                                                   | `'workspace'`: one holder per project root: the nearest folder at or above the working directory with a `package.json`. `'cluster'`: one holder among the machines that share the server's Redis |
| `leaseMs`  | `number`                                                    | Three intervals, between 3000 and 60000; 60000 with `cron` | At least 1000 (stores keep a TTL in whole seconds). How soon another process takes over from a holder that died                                                                                  |

A duty has exactly one of `every` and `cron`. An invalid option throws `InvalidDecoratorMetadataError`
(`INVALID_DECORATOR_METADATA`) when the class is decorated:

| Mistake                       | Message                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| A malformed `every`           | `@Duty invalid metadata for "every": every must be milliseconds or a duration such as "30s", "5m", "1h"` |
| Both `every` and `cron`       | `@Duty invalid metadata for "cron": set either every or cron, not both`                                  |
| Neither                       | `@Duty invalid metadata for "every": a duty needs every (an interval) or cron (a cron expression)`       |
| An empty or non-string `cron` | `@Duty invalid metadata for "cron": cron must be a cron expression such as "0 9 * * 1-5"`                |
| An unknown time zone          | `@Duty invalid metadata for "timezone": timezone must be an IANA time zone such as "Europe/Berlin"`      |
| `timezone` with `every`       | `@Duty invalid metadata for "timezone": timezone applies to cron; a duty with every has none`            |
| An unknown `scope`            | `@Duty invalid metadata for "scope": scope must be 'machine', 'workspace' or 'cluster'`                  |

A class without `run()` fails to compile, and throws `@Duty invalid metadata for "run": <Class> has no run() method`.

Two mistakes are found when the server starts, in the duty's `onBootstrap()` phase, so the server (or
`createContainer()`) fails with `ProviderBootstrapError` (`PROVIDER_BOOTSTRAP_FAILED`) whose `originalError` is:

| Error                         | Code                        | Message                                                                                                                                                                                                           |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InvalidDutyCronError`        | `INVALID_DUTY_CRON`         | `Duty "<name>" has a cron expression that can't be read ("<cron>"): <reason>`                                                                                                                                     |
| `ClusterScopeNeedsRedisError` | `CLUSTER_SCOPE_NEEDS_REDIS` | `Duty "<name>" has scope 'cluster', which keeps one lease for every machine in Redis, and none is configured: set a top-level redis (@FrontMcp({ redis }) or createContainer({ redis })), or use scope 'machine'` |

The cluster check runs only where duties start: not in a serverless or edge deployment, not in a container without
`runBackground`, and not when `frontmcp build` boots the server to read it.

Two different classes whose duties share a name in one server (both `name: 'sweep'`, or two plugins'
`CacheSweeper` classes), whatever their scopes, would leave one of them never running or run the work twice, so the
second one to start fails with
`DutyNameConflictError` (`DUTY_NAME_CONFLICT`): `Duty "sweep" of server "demo" is declared by two classes in this
process (A and B): give one of them its own name with @Duty({ name })`. The same class built twice (a top-level
provider of a `splitByApp` server is built once per app) is not a conflict: its copies share one lease.

When auto-update replaces a version of an `App.esm()` package, the old version's duties stop (the run in flight
aborted and awaited, the lease released) before the new version's start, so the new class takes the name without a
`DutyNameConflictError`. The replace waits for a run in flight up to `lifecycle.shutdownHookTimeoutMs` (3000 ms by
default). A run that has not returned by then fails the replace: the new version is discarded, the old one keeps
serving, and that duty runs again once the run has returned. Their own `onShutdown()` still runs once, when the server
shuts down. When the new version fails to start (a provider's `onReady()` throws, or a worker or duty of it cannot
start, as when two of its classes share a name), it is discarded and the old version's duties run again (see
`multi-app-composition`). A lease store that cannot be opened does not fail the start: each lease check tries it again
and `/readyz` shows the duty `unhealthy` meanwhile (see Health), so the new version is swapped in and its duties run
once the store opens.

## Publishing Events

A duty tells the clients subscribed to an event what it found (see `create-event`). It takes the server's publisher in
its constructor, by the `EventPublisher` class:

```typescript
import { Duty, EventPublisher, type DutyInterface } from '@frontmcp/sdk';

import { ReportReady } from './report-ready.event';
import { ReportService } from './report.service';

@Duty({ name: 'weekday-report', cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', scope: 'cluster' })
export class WeekdayReportDuty implements DutyInterface {
  constructor(
    private readonly reports: ReportService,
    private readonly events: EventPublisher,
  ) {}

  async run(): Promise<void> {
    const report = await this.reports.buildDaily();
    await this.events.publish(ReportReady, { reportId: report.id });
  }
}
```

- Import `EventPublisher` as a value, not with `import type`. Where the build emits no constructor types (`tsx`,
  esbuild), build the duty with a factory provider that injects the `EVENT_PUBLISHER` token (see `create-worker`).
- A duty runs in the one process that holds its lease, so each run publishes once among the copies of the server.
- On a server without events, `publish()` is refused with `EventsNotEnabledError`, and the run is logged as failed.
  `createContainer()` has no server, so no publisher: a duty that takes one cannot be built there.

## Cron Schedules

`cron` takes five fields, `minute hour day-of-month month day-of-week`, or six with `second` first:

| Expression                 | Runs                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `0 9 * * 1-5`              | At 09:00, Monday to Friday                                         |
| `*/15 * * * *`             | Every 15 minutes                                                   |
| `0 0 1 * *`                | At midnight on the first of each month                             |
| `0 8-18/2 * * MON,WED,FRI` | Every second hour from 08:00 to 18:00 on three weekdays            |
| `*/10 * * * * *`           | Every 10 seconds (six fields)                                      |
| `@daily`                   | At midnight (`@yearly`, `@monthly`, `@weekly`, `@hourly` work too) |

- **Fields.** Lists (`1,15`), ranges (`1-5`), steps (`*/15`, `8-18/2`), month names (`JAN`-`DEC`) and day names
  (`SUN`-`SAT`; `0` and `7` are both Sunday). When both day-of-month and day-of-week are set, the duty runs on either:
  `0 0 13 * FRI` runs on the 13th and on every Friday. An expression with a year field, a date, or one that never
  matches (`0 0 30 2 *`) is refused at startup.
- **Time zone.** The expression is read in `timezone`, `'UTC'` by default. A time the clocks skip in spring
  (`30 2 * * *` in `Europe/Berlin` on the last Sunday of March) runs once, when the clocks resume at 03:00. A time
  they repeat in autumn runs once, the first time. A step (`*/30 * * * *`) keeps running through both.
- **First start.** A cron duty does not run when the server starts: it waits for its next scheduled time.
- **Catching up.** The store keeps the time the schedule was last taken, without expiry. A process that gets the lease
  (after a takeover, a restart, or a laptop waking up) compares it with the clock: when a scheduled time passed since,
  it runs once now, whatever the number of times missed, then continues on schedule.
- **Once per scheduled time.** The record is replaced only while it still holds what the process read, so two processes
  never both run the same scheduled time, even if both believed they held the lease. A scheduled time that comes while
  the last run is still running is skipped.
- **At most once.** A scheduled time is taken before its run starts, so a holder that dies after taking it, or
  during the run, loses that run: the process that takes over runs only the scheduled times after it. A
  `trigger: 'schedule'` workflow, whose run is a record in the job store, is recovered instead (see `create-workflow`).
- **The library.** `croner`, a dependency of `@frontmcp/sdk` with none of its own, reads the expression. It loads when
  the first duty with a `cron` is built, so a server without one never loads it.

## How the Lease Works

- **Acquire.** Each process sets the lease key to its own id with a TTL of `leaseMs`, only if the key is absent. The one
  whose id is stored holds the duty.
- **Renew.** The holder extends the TTL every third of `leaseMs`, only while the key still holds its id. The others try
  to acquire at the same pace.
- **Expire.** The store's TTL decides when a lease ends; processes never compare their clocks. A killed or hung holder
  stops renewing, and another process takes the duty over within `leaseMs` plus a third of it.
- **Give up.** A holder that could not renew for two thirds of `leaseMs` (Redis unreachable, a locked file, a hung store
  call) stops holding the duty, aborts the run in flight and contends again. The store keeps its lease at least a third
  of `leaseMs` longer, so the run has that long to end before another process can take over: a run must return
  promptly once `signal` aborts. A renew that failed is tried again after half the usual wait, so one failure alone
  does not end the lease. The holder measures this on a monotonic clock, so unless the system clock jumps (see Clocks)
  it never trusts its lease longer than the store keeps it.
- **Release.** At shutdown the holder aborts the run in flight and keeps renewing the lease until the run returns, so
  no other process starts meanwhile; then it deletes the key only while it still holds its id. Another process takes
  over at its next check. A run that ignores `signal` holds the shutdown up to `lifecycle.shutdownHookTimeoutMs`.
- **Before each run** the holder renews the lease. A holder paused past its lease (SIGSTOP, a long GC pause) finds the
  key taken when it wakes, and does not run. A run in flight when the lease is lost sees `signal` aborted.
- **Once per interval.** A run that would start while the last one is still running is skipped, not queued. A run
  failure is logged and the holder keeps the lease. A process that takes the lease over waits until an interval has
  passed since the last run started, in whichever process ran it. A `cron` duty runs at a takeover only when a
  scheduled time passed since the last run (see Cron Schedules).
- **Clocks.** On one machine every process reads the same system clock, so they never disagree about a SQLite lease.
  A forward jump of that clock (an NTP step, a laptop waking from sleep) by more than `leaseMs` ends the lease and the
  last-run marker early: another process may take over and run at once. A backward jump delays a takeover after a crash
  by the size of the jump. Redis keeps its TTLs by its own clock. A `'cluster'` cron duty reads the schedule by the
  clock of the machine that holds it: keep the machines' clocks in sync (NTP), since a scheduled time runs as early or
  late as the holder's clock is off.

## Where Leases Live

| Server config                        | Scope                      | Store                                                                    | Key                                                |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| No top-level `redis` (the default)   | `'machine'`, `'workspace'` | SQLite file `~/.frontmcp/duties.sqlite` (`$FRONTMCP_HOME/duties.sqlite`) | `frontmcp:duty:<info.name>:<duty name>`            |
| A top-level `redis` (Redis provider) | `'machine'`, `'workspace'` | That Redis                                                               | `frontmcp:duty:<hostname>:<info.name>:<duty name>` |
| A top-level `redis` (Redis provider) | `'cluster'`                | That Redis                                                               | `frontmcp:cluster:duty:<info.name>:<duty name>`    |

A `'workspace'` duty's key ends with the SHA-256 of the project root. The server and duty names are URI-encoded in the
key, so a `:` in either never makes two leases one. Next to each lease, `<key>:ran` records the last run: for an
interval it expires after one interval, for a cron it holds the time the schedule was last taken and does not expire.
The store never falls back to memory. The duty opens it at its first lease check, so the server starts even when the
store can't be opened (a missing `@frontmcp/storage-sqlite`, an unreachable Redis, an `UnsafeDutyStoreError`): each
lease check logs `Duty "<name>": the lease store failed: <cause>` and tries to open it again, and the duty runs once it
opens and this process gets the lease, without a restart. Meanwhile its `/readyz` check is `unhealthy` (see Health).

The SQLite file and its folder are created owner-only (`0600` and `0700`). A folder that the group or others can write
to, or that belongs to another user (or one above it, unless it has the sticky bit, like `/tmp`), is refused with
`UnsafeDutyStoreError` (`UNSAFE_DUTY_STORE`): `Refusing to keep duty leases under <folder> (mode <mode>): <reason>. Set
FRONTMCP_HOME to a folder only you can write to.` So two users of a machine never share leases, and nobody else can
hold or delete them.

With Redis, `'machine'` means one hostname. Containers and Kubernetes pods get their own hostnames; replicas given the
same `hostname:` (Docker Compose) share one lease, so only one of them runs a `'machine'` duty. `'cluster'` leaves the
hostname out: every server with the same `info.name` on that Redis (and Redis database) shares the lease, so one pod of
a deployment runs the duty.

## Health

Each duty adds a check named `duty:<name>` to `/readyz` (see `health-readiness-endpoints`) once the server serves. It is
`healthy`, with `details: { holdsLease }` (whether this process holds the duty's lease now), except while the lease
store cannot be opened: then it is `unhealthy` with `error: 'the lease store cannot be opened: <cause>'`, which makes
`/readyz` answer `not_ready`. A run that fails is logged, not reported here. A container has no `/readyz`, so its
duties add no check.

`/readyz` lists its checks when `health.includeDetails` is on, which is the default unless `NODE_ENV` is `production`.
A production server therefore answers `ready` or `not_ready` without `holdsLease` or the lease store's error: set
`@FrontMcp({ health: { includeDetails: true } })` to see them there.

## Log Lines

| Level   | Message                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| info    | `Duty "<name>" runs in this process every <ms> ms` (this process took the lease)                                                          |
| info    | `Duty "<name>" runs in this process on cron "<cron>" (<timezone>)` (the same, for a cron duty)                                            |
| info    | `Duty "<name>" already runs elsewhere (lease "<key>"); this one takes it over if that one stops`                                          |
| warn    | `Duty "<name>" lost its lease; another process runs it now`                                                                               |
| warn    | `Duty "<name>" could not renew its lease within <ms> ms; it stops here until it gets the lease again` (`<ms>` is two thirds of `leaseMs`) |
| warn    | `Duty "<name>": the lease store failed: <cause>` (that check or run is skipped and retried)                                               |
| error   | `Duty "<name>" failed: <cause>` (the run threw; the lease is kept)                                                                        |
| verbose | `Duty "<name>" is still running; skipping this run`                                                                                       |
| warn    | `Duty "<name>" does not run in a serverless or edge deployment: it needs a long-lived process`                                            |

## Common Patterns

| Pattern              | Correct                                                    | Incorrect                                             | Why                                                                                             |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Shared periodic work | `@Duty({ every, scope })` in `providers`                   | `setInterval()` in a provider's `onReady()`           | Every copy of the server would run the interval                                                 |
| Calendar schedules   | `@Duty({ cron: '0 9 * * 1-5', timezone, scope })`          | `every: '1d'` started at the right hour               | An interval drifts with restarts and ignores weekdays and daylight saving                       |
| Several machines     | `scope: 'cluster'` with a top-level `redis`                | `scope: 'machine'` on every pod                       | With Redis a machine lease is per hostname, so every pod would run it                           |
| Long runs            | Check `signal.aborted` between steps                       | Ignore `signal`                                       | A run that lost its lease keeps going until it looks                                            |
| Stable names         | `@Duty({ name: 'prune-cache', ... })` in a minified build  | Rely on the class name after minification             | The lease key comes from the name                                                               |
| Scripts              | `createContainer({ runBackground: true, info: { name } })` | Expect `createContainer()` to start duties on its own | A container never runs duties unless asked, so a script that only needs the providers runs none |
| `splitByApp` servers | The duty in one `@App`'s `providers`                       | The duty in the top-level `providers`                 | Every app's scope builds a top-level provider: one lease, several copies                        |

## Verification Checklist

### Configuration

- [ ] The duty class has `run()` and is in a `providers` array
- [ ] `scope` matches who shares the work: the whole machine, one project, or every machine on the server's Redis
- [ ] `@frontmcp/storage-sqlite` is installed, or the server has a top-level `redis` (required for `'cluster'`)
- [ ] The duty has `every` or `cron`, not both, and `timezone` only with `cron`
- [ ] A `name` is set when the build minifies class names
- [ ] The server's `info.name` is distinctive on the machine: another server with the same name shares its leases

### Runtime

- [ ] Started several times, the server logs `runs in this process` once
- [ ] `/readyz` shows `duty:<name>` as `healthy`, with `holdsLease: true` in the holder only (in production, only with
      `health.includeDetails: true`)
- [ ] Killing that process makes another log it within `leaseMs` plus a third of it
- [ ] Long runs return when `signal` is aborted

## Troubleshooting

| Problem                                       | Cause                                                                         | Solution                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The duty never runs                           | Not in `providers`; a `createContainer()` without `runBackground`; serverless | Register it; pass `runBackground: true`; run it in a long-lived process                       |
| A cron duty did not run at startup            | It waits for its next scheduled time                                          | Nothing to fix; trigger the work another way when it must also run at startup                 |
| `ClusterScopeNeedsRedisError` at startup      | A `'cluster'` duty and no top-level `redis` (or a Vercel KV one)              | Add `redis` to `@FrontMcp()` or `createContainer()`, or use `scope: 'machine'`                |
| `InvalidDutyCronError` at startup             | The `cron` expression can't be read, has a year field, or never matches       | Fix the expression: 5 fields, or 6 with seconds first                                         |
| A cron duty runs an hour off                  | The expression is read in UTC                                                 | Set `timezone` to the IANA zone the schedule is meant in                                      |
| `already runs elsewhere` with one server      | Another server on the machine has the same `info.name` and duty name          | Give the server a distinctive `info.name`, or the duty its own `name`                         |
| `/readyz`: `the lease store cannot be opened` | The SQLite file or Redis can't be reached, or `UnsafeDutyStoreError`          | Install `@frontmcp/storage-sqlite`, or fix the store; the duty starts at the next lease check |
| `/readyz` shows no `duty:<name>` check        | `NODE_ENV` is `production`, where `/readyz` leaves its checks out by default  | Set `health: { includeDetails: true }` to see `holdsLease` and the store's error              |
| `DutyNameConflictError`                       | Two duty classes with the same `name` in one server                           | Give one of them its own `name`                                                               |
| `UnsafeDutyStoreError`                        | `FRONTMCP_HOME` (or a folder above it) is writable by others                  | Point `FRONTMCP_HOME` at a folder only you can write to, or `chmod 700` it                    |
| It runs in two processes at once              | Different `info.name` or duty `name`, or `'workspace'` in two projects        | Give them the same names; use `'machine'` to share across projects                            |
| A takeover is slow after a crash              | The lease must expire first                                                   | Lower `leaseMs` (at least 1000)                                                               |
| `lost its lease` while the holder is busy     | The event loop was blocked longer than the lease                              | Keep runs asynchronous, move CPU-heavy work off the main thread, raise `leaseMs`              |

## Reference

- [Providers](https://frontmcp.dev/reference/sdk/provider)
- Related skills: `create-worker` (long-running processes under the same lease), `create-provider` (lifecycle hooks,
  `createContainer()`), `create-job`, `decorators-guide`, `setup-sqlite`
