---
name: create-worker
description: Keep a long-running background process alive with @Worker, a supervised run() that stays connected or keeps watching, restarts with backoff, and runs in every process or in exactly one under a lease
---

# Workers: Long-Running Background Processes

A worker is a provider class with a `run()` method that stays connected or keeps watching until the server shuts down:
a mail connection, a file watcher, an upstream socket, a queue consumer. The server starts `run()` once it serves,
runs it again after a wait when it returns or throws, and aborts its `signal` at shutdown. With a `scope` other than
`'process'`, exactly one process holds the worker's lease and runs it; another takes it over when the holder dies.

## When to Use This Skill

### Must Use

- Something must stay connected or keep watching for as long as the server runs: an IMAP IDLE connection, a WebSocket
  to an upstream, a queue consumer, a file watcher
- That connection must exist once among several copies of the server (`scope: 'machine'`, `'workspace'` or
  `'cluster'`), and another copy must take it over when the holder dies
- It must come back by itself after an error, with a growing wait between attempts

### Recommended

- Replacing a loop started in a provider's `onReady()` that nothing restarts when it throws and nothing stops at
  shutdown

### Skip When

- The work runs at intervals or on a calendar schedule and then ends (see `create-duty`)
- A client triggers the work and needs retries or progress (see `create-job`)
- The work is CPU-heavy and should leave the event loop free: a worker runs on the server's event loop, not in a
  worker thread (see `offload-cpu-work`)
- The server runs serverless or on the edge: a worker needs a long-lived process, and is not started there

> **Decision:** Use `@Worker` for a process that never ends by itself; use `@Duty` for work that runs, ends, and runs
> again on a schedule.

## Prerequisites

- For `scope: 'machine'` and `'workspace'`: `@frontmcp/storage-sqlite` installed, where the leases live by default. A
  server with a top-level `redis` keeps them in Redis instead.
- For `scope: 'cluster'`: a top-level `redis` (a Redis provider, not Vercel KV). Without it the server refuses to start.
- `scope: 'process'` needs neither.
- A run mode that keeps the process alive (see Keeping a Worker Alive).

## Steps

### Step 1: Write the worker

```typescript
import { Worker, type WorkerInterface, type WorkerRunContext } from '@frontmcp/sdk';

import { Mailbox } from './mailbox';

@Worker({ name: 'inbox-watcher', scope: 'cluster' })
export class InboxWatcher implements WorkerInterface {
  constructor(private readonly mailbox: Mailbox) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    const connection = await this.mailbox.connect({ signal });
    try {
      for await (const message of connection.messages({ signal })) {
        await this.mailbox.store(message);
      }
    } finally {
      await connection.close();
    }
  }
}
```

`run()` ends when `signal` is aborted: pass the signal to what it awaits, or listen to its `abort` event. A worker is a
GLOBAL provider: its constructor gets its dependencies injected, and it can implement `onBootstrap()`, `onReady()` and
`onShutdown()` like any provider.

### Step 2: Register it in `providers`

```typescript
@App({ name: 'mail', providers: [Mailbox, InboxWatcher] })
class MailApp {}
```

`@FrontMcp({ providers })` and a plugin's `providers` work too. The worker starts once the server serves (the
`onReady()` phase) and stops at shutdown, before the providers it depends on.

### Step 3 (optional): Run workers from a script

`createContainer()` builds a worker without starting it. To run workers and duties without serving MCP, ask for it:

```typescript
const container = await createContainer({
  apps: [MailApp],
  runBackground: true, // starts the @Worker and @Duty providers
  info: { name: 'mail-server' }, // required with runBackground: the server's info.name, so they share its leases
  redis: { url: process.env.REDIS_URL }, // the server's redis, when it has one: needed for scope: 'cluster'
});
// ...
await container.dispose(); // aborts the workers, waits for them, and releases their leases
```

`runDuties: true` is the older name of the same switch and still works: it starts the workers as well.

## `@Worker` Options

| Field     | Type                                                   | Default                                              | Notes                                                                                                   |
| --------- | ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`    | `string`                                               | The class name                                       | The worker's name in logs, in `/readyz` and in its lease. Set it when the build renames classes         |
| `scope`   | `'process'`, `'machine'`, `'workspace'` or `'cluster'` | Required                                             | See Scopes                                                                                              |
| `restart` | `false` or `{ minDelayMs?, maxDelayMs?, factor? }`     | `{ minDelayMs: 1000, maxDelayMs: 60000, factor: 2 }` | `false` runs `run()` once                                                                               |
| `leaseMs` | `number`                                               | `15000`                                              | At least 1000. How soon another process takes over from a holder that died. Not with `scope: 'process'` |

### Scopes

| Scope         | Runs in                                                                                                  | Lease                              |
| ------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `'process'`   | Every server process, each its own instance                                                              | None                               |
| `'machine'`   | One process of the machine                                                                               | SQLite file, or Redis per hostname |
| `'workspace'` | One process per project root: the nearest folder at or above the working directory with a `package.json` | SQLite file, or Redis per hostname |
| `'cluster'`   | One process among the machines that share the server's Redis                                             | Redis, which it requires           |

An invalid option throws `InvalidDecoratorMetadataError` (`INVALID_DECORATOR_METADATA`) when the class is decorated:

| Mistake                                                            | Message                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| An unknown or missing `scope`                                      | `@Worker invalid metadata for "scope": scope must be 'process', 'machine', 'workspace' or 'cluster'`                |
| `restart: true`, or another value that is not `false` or an object | `@Worker invalid metadata for "restart": restart must be false or { minDelayMs, maxDelayMs, factor }`               |
| A wait below 1 ms                                                  | `@Worker invalid metadata for "restart.minDelayMs": restart.minDelayMs must be at least 1`                          |
| `minDelayMs` above `maxDelayMs`                                    | `@Worker invalid metadata for "restart.minDelayMs": restart.minDelayMs must not be greater than restart.maxDelayMs` |
| A `factor` below 1                                                 | `@Worker invalid metadata for "restart.factor": restart.factor must be at least 1`                                  |
| `leaseMs` below 1000                                               | `@Worker invalid metadata for "leaseMs": leaseMs must be at least 1000 (stores keep a TTL in whole seconds)`        |
| `leaseMs` with `scope: 'process'`                                  | `@Worker invalid metadata for "leaseMs": leaseMs applies to a leased scope; a 'process' worker has no lease`        |

A class without `run()` fails to compile, and throws `@Worker invalid metadata for "run": <Class> has no run() method`.

Found when the server starts:

| Error                         | Code                        | When                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClusterScopeNeedsRedisError` | `CLUSTER_SCOPE_NEEDS_REDIS` | A `'cluster'` worker and no top-level `redis`: `Worker "<name>" has scope 'cluster', which keeps one lease for every machine in Redis, and none is configured: set a top-level redis (@FrontMcp({ redis }) or createContainer({ redis })), or use scope 'machine'`. The server (or a container that runs workers) fails with `ProviderBootstrapError`, whose `originalError` it is |
| `WorkerNameConflictError`     | `WORKER_NAME_CONFLICT`      | Two classes share a leased worker's name in one process: `Worker "<name>" of server "<server>" is declared by two classes in this process (A and B): give one of them its own name with @Worker({ name })`. Logged as `Provider "<Class>" failed in onReady()`; the second one does not run                                                                                        |

## Supervision

- **Start.** `run()` starts once the server serves. A leased worker starts when this process gets the lease.
- **Restart.** When `run()` returns or throws while `signal` is not aborted, the server runs it again after a wait:
  `minDelayMs` the first time, then `factor` times longer each time, up to `maxDelayMs`. A run that lasted longer than
  `maxDelayMs` starts the waits over at `minDelayMs`. With the defaults: 1 s, 2 s, 4 s, ... 60 s.
- **`restart: false`.** `run()` runs once. When it ends, the worker stays stopped, and a leased one keeps its lease so
  no other process runs it either. A process that loses that lease and gets it back does not run it again; a process
  that took the lease over meanwhile runs it once.
- **Errors.** What `run()` throws is logged with the worker's name and never reaches the server: a failing worker does
  not crash it, and does not stop other workers.
- **Abort.** `signal` is aborted at shutdown, and when this process loses the worker's lease. An error thrown after
  that is not logged as a failure. A process that cannot renew the lease aborts `signal` a third of `leaseMs` before
  the store can give the lease to another process: `run()` must return promptly once `signal` aborts, or it may still
  run when the next holder starts.
- **Shutdown.** The server aborts `signal` and waits for `run()` to end, up to `lifecycle.shutdownHookTimeoutMs`
  (3000 ms by default), then moves on. A leased worker keeps renewing its lease while `run()` ends, then releases it,
  so another process takes over at its next check. The worker's own `onShutdown()` runs once `run()` has ended,
  within that same timeout: a `run()` that uses up the timeout leaves `onShutdown()` to run after the server moved on,
  or not at all if the process exits first.
- **One at a time.** A process that gets the lease back while its last run is still ending waits for it before it
  starts the next.
- **ESM package versions.** When auto-update replaces a version of an `App.esm()` package, the old version's workers
  stop before the new version's start (`signal` aborted, `run()` awaited, the lease released), so a `'process'` worker
  never runs twice and the new class takes the name without a `WorkerNameConflictError`. The replace waits for each
  `run()` up to `lifecycle.shutdownHookTimeoutMs` (3000 ms by default). Unlike a shutdown, it does not move on after
  that: a `run()` that has not ended by then fails the replace, logged as
  `Provider "<Class>" did not stop its background work within <ms> ms`. The new version is discarded, the old one
  keeps serving, and that worker starts again once its `run()` has ended, so two runs of it never overlap. The next
  version check tries the replace again. Their own `onShutdown()` still runs once, when the server shuts down. When
  the new version fails to start (a provider's `onReady()` throws, or a worker or duty of it cannot start, as when two
  of its classes share a name), it is discarded and the old version's workers start again (see
  `multi-app-composition`). A lease store that cannot be opened does not fail the start: each lease check tries it
  again and `/readyz` shows the worker `unhealthy` meanwhile (see Health), so the new version is swapped in and its
  leased workers run once the store opens.

## Health

Each worker adds a check named `worker:<name>` to `/readyz` (see `health-readiness-endpoints`):

| State        | Meaning                                                         | Status                                               |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| `running`    | `run()` is running                                              | `healthy`                                            |
| `standby`    | Another process holds the lease, or this one has not got it yet | `healthy`                                            |
| `restarting` | `run()` ended and the server waits to run it again              | `degraded`                                           |
| `stopped`    | `run()` ended and `restart: false` keeps it so                  | `unhealthy` after an error, `healthy` after a return |

The check's `details` hold `state`, `restarts` (how many times `run()` was started again) and `lastError` (the message
of the last error it threw, until a run returns); `error` repeats `lastError` when the status is not `healthy`. A
process that lost the lease of a stopped `restart: false` worker shows `standby`. While a leased worker's lease store
cannot be opened, the check is `unhealthy` with `error: 'the lease store cannot be opened: <cause>'`; each lease check
tries to open it again, and the worker runs once it opens and this process gets the lease. Only `unhealthy` makes
`/readyz` answer `not_ready`. A container has no `/readyz`, so its workers add no check.

`/readyz` lists its checks when `health.includeDetails` is on, which is the default unless `NODE_ENV` is `production`.
A production server therefore answers `ready` or `not_ready` without them: set
`@FrontMcp({ health: { includeDetails: true } })` to see each worker's `state` and `error` there.

## Publishing Events

A worker that watches something tells the clients subscribed to an event about it (see `create-event`). It takes the
server's publisher in its constructor, by the `EventPublisher` class, and publishes from `run()`:

```typescript
import { EventPublisher, Worker, type WorkerInterface, type WorkerRunContext } from '@frontmcp/sdk';

import { MailReceived } from './mail-received.event';
import { Mailbox } from './mailbox';

@Worker({ name: 'inbox-watcher', scope: 'cluster' })
export class InboxWatcher implements WorkerInterface {
  constructor(
    private readonly mailbox: Mailbox,
    private readonly events: EventPublisher,
  ) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    for await (const message of this.mailbox.messages({ signal })) {
      await this.events.publish(MailReceived, { messageId: message.id, from: message.from });
    }
  }
}
```

- Import `EventPublisher` as a value, not with `import type`. A type-only import fails startup with
  `Provider InboxWatcher depends on Object, which is not registered (local or parent).`
- Where the build emits no constructor types (`tsx`, esbuild), build the worker with a factory provider that injects
  the `EVENT_PUBLISHER` token. A worker built by a factory is supervised like one registered by its class:

```typescript
import { App, AsyncProvider, EVENT_PUBLISHER } from '@frontmcp/sdk';

export const inboxWatcher = AsyncProvider({
  provide: InboxWatcher,
  name: 'inbox-watcher',
  inject: () => [Mailbox, EVENT_PUBLISHER] as const,
  useFactory: (mailbox, events) => new InboxWatcher(mailbox, events),
});

@App({ name: 'mail', events: [MailReceived], providers: [Mailbox, inboxWatcher] })
class MailApp {}
```

- Register the factory in `providers` in place of the class.

- The event must be in the `events` of an app. On a server without events, `publish()` is refused with
  `EventsNotEnabledError`; the worker's run then fails and is run again after its wait, like any error.
- `createContainer()` has no server, so no publisher: a worker that takes one cannot be built there.
- With a leased `scope`, one process publishes. With `scope: 'process'`, every copy of the server publishes its own
  occurrence of the same thing.

## Watching Files

`watchFiles()` from `@frontmcp/utils` yields what happens to the files of a folder, as an async iterator a worker
loops over until its `signal` aborts:

```typescript
import { EventPublisher, Worker, type WorkerInterface, type WorkerRunContext } from '@frontmcp/sdk';
import { watchFiles } from '@frontmcp/utils';

@Worker({ name: 'drop-folder', scope: 'machine' })
export class DropFolderWatcher implements WorkerInterface {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    for await (const { type, path } of watchFiles('./drop', { events: ['add', 'change'], signal })) {
      await this.events.publish('file.dropped', { path, type });
    }
  }
}
```

`watchFiles(paths, options?)` takes one path or several, files or directories, relative to the working directory or
absolute:

| Option        | Type                                | Default   | Notes                                                                        |
| ------------- | ----------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `events?`     | `('add' \| 'change' \| 'unlink')[]` | All three | The kinds of event to yield                                                  |
| `debounceMs?` | `number`                            | `100`     | How long the directory of a path must stay quiet before changes are yielded  |
| `signal?`     | `AbortSignal`                       | None      | Ends the iteration and closes the watchers when it aborts: pass the worker's |

- Each event is `{ type, path }`, with `path` absolute. `add`: a file appeared. `change`: its size, its modification
  time or the file itself was replaced. `unlink`: it is gone.
- A directory is watched for its direct files. Its subdirectories, and what they hold, are left out.
- A file is watched through its parent directory, so it stays watched when an editor replaces it.
- A path that does not exist yet is watched from the moment it appears, as a file or as a directory. While its
  parent directory is missing too, it is looked for every 500 ms.
- The files that are there when the watch starts are not yielded: a worker that must handle those lists the folder
  first.
- Changes are yielded once the watched directory saw no change for `debounceMs`. Several writes to one file in that
  time are one `change`, and a file created and removed in that time yields nothing. A directory that never goes
  quiet yields nothing until it does.
- The iteration ends when `signal` aborts or the loop is left with `break` or `return`. Both close the watchers.
- Node.js only. On another runtime the first iteration rejects with
  `watchFiles is not supported in the browser. Requires Node.js.`

## Where Leases Live

A leased worker uses the store and the mechanism of duties (see `create-duty`, How the Lease Works): acquire, renew
every third of `leaseMs`, expire by the store's clock, give up two thirds of `leaseMs` after the last renewal, a third
of `leaseMs` before the store could end the lease.

| Server config                        | Scope                      | Store                                                                    | Key                                                    |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| No top-level `redis` (the default)   | `'machine'`, `'workspace'` | SQLite file `~/.frontmcp/duties.sqlite` (`$FRONTMCP_HOME/duties.sqlite`) | `frontmcp:worker:<info.name>:<worker name>`            |
| A top-level `redis` (Redis provider) | `'machine'`, `'workspace'` | That Redis                                                               | `frontmcp:worker:<hostname>:<info.name>:<worker name>` |
| A top-level `redis` (Redis provider) | `'cluster'`                | That Redis                                                               | `frontmcp:cluster:worker:<info.name>:<worker name>`    |

A `'workspace'` worker's key ends with the SHA-256 of the project root. A worker and a duty with the same name have
leases of their own. The SQLite file and its folder are created owner-only, and a folder others can write to is refused
with `UnsafeDutyStoreError`, as for duties.

A lease gives one holder at a time, not an exactly-once guarantee for what `run()` does: a holder paused longer than
its lease (SIGSTOP, a blocked event loop) wakes up, finds the lease gone and aborts `signal`, while the process that
took over already runs. Make what the worker does safe to resume from another process.

## Keeping a Worker Alive

A worker runs for as long as its server process does. Which run modes keep that process alive:

| Run mode                                                        | Stays up without requests                                                | Restarted when it exits                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node dist/main.js`, a container image, `frontmcp start <name>` | Yes                                                                      | `frontmcp start` restarts a crashed server with a growing wait, up to `--max-restarts` (5 by default); a container orchestrator or systemd by its own policy |
| `frontmcp service install <name>`                               | Yes                                                                      | The systemd user unit (Linux) has `Restart=on-failure`; the launchd agent (macOS) starts it at login and does not restart it                                 |
| `<bin> serve` (a CLI built with `frontmcp build --target cli`)  | Yes, in the foreground                                                   | No                                                                                                                                                           |
| `<bin> daemon start`                                            | Takes `--idle-timeout <ms>` (300000 by default; `0` disables it)         | No                                                                                                                                                           |
| The shared local server (`FrontMcpInstance.runShared()`)        | While a session is attached, and `idleTimeoutMs` (600000) after the last | A session's next request starts a new one                                                                                                                    |
| A stdio server an MCP client starts                             | Only while its client is connected                                       | By the client                                                                                                                                                |
| Serverless, edge, browser                                       | Not started                                                              | -                                                                                                                                                            |

To run a worker that is always on:

- Run the server as a long-lived process under something that restarts it: a container with a restart policy, a
  systemd unit, or `frontmcp start <name>` (installed with `frontmcp service install <name>` to start at login).
- With a built CLI's daemon, start it with `<bin> daemon start --idle-timeout 0`.
- With the shared local server, pass `idleTimeoutMs: false` to `runShared()`. Idle there means no request and no
  attached session: a running worker does not count as activity, so the default stops the server, and its worker,
  10 minutes after the last session left.
- Do not rely on a stdio server that a client starts: the worker stops when the client disconnects.
- For one worker among several machines, use `scope: 'cluster'` and run at least two copies: when the holder's
  process ends, another takes the worker over within `leaseMs` plus a third of it.

## Log Lines

| Level | Message                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| info  | `Worker "<name>" runs in this process` (it started here; for a leased worker, this process got the lease)                                   |
| info  | `Worker "<name>" already runs elsewhere (lease "<key>"); this one takes it over if that one stops`                                          |
| error | `Worker "<name>" failed: <cause>; it runs again in <ms> ms`                                                                                 |
| warn  | `Worker "<name>" returned before its signal was aborted; it runs again in <ms> ms`                                                          |
| error | `Worker "<name>" failed: <cause>; it does not run again (restart: false)`                                                                   |
| warn  | `Worker "<name>" returned before its signal was aborted; it does not run again (restart: false)`                                            |
| warn  | `Worker "<name>" lost its lease; another process runs it now`                                                                               |
| warn  | `Worker "<name>" could not renew its lease within <ms> ms; it stops here until it gets the lease again` (`<ms>` is two thirds of `leaseMs`) |
| warn  | `Worker "<name>": the lease store failed: <cause>` (that check is skipped and retried)                                                      |
| warn  | `Worker "<name>" does not run in a serverless or edge deployment: it needs a long-lived process`                                            |

## Common Patterns

| Pattern                       | Correct                                                            | Incorrect                                                 | Why                                                                                      |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ending the run                | Pass `signal` to what `run()` awaits, and return when it aborts    | Ignore `signal`                                           | Shutdown waits for the run up to its timeout, and a lost lease keeps two holders running |
| Reconnecting                  | Let `run()` throw or return; the server runs it again with backoff | A `while (true)` retry loop inside `run()` without a wait | The supervisor already waits, grows the wait and reports the state to `/readyz`          |
| One connection for all copies | `scope: 'machine'`, `'workspace'` or `'cluster'`                   | `scope: 'process'` for a shared upstream                  | Every copy of the server would open its own connection                                   |
| Per-process work              | `scope: 'process'`                                                 | A leased scope for an in-memory cache refresher           | Only the holder's process would have the work done                                       |
| Stable names                  | `@Worker({ name: 'inbox-watcher', ... })` in a minified build      | Rely on the class name after minification                 | The lease key and the health check come from the name                                    |
| Scheduled work                | `@Duty({ every })` or `@Duty({ cron })`                            | A worker that sleeps between runs                         | A duty records its last run and catches up after a takeover                              |
| `splitByApp` servers          | The worker in one `@App`'s `providers`                             | The worker in the top-level `providers`                   | Every app's scope builds a top-level provider: one lease, several copies                 |

## Verification Checklist

### Configuration

- [ ] The worker class has `run()` and is in a `providers` array
- [ ] `scope` matches who shares the work: each process, the machine, one project, or every machine on the server's
      Redis
- [ ] `@frontmcp/storage-sqlite` is installed or the server has a top-level `redis` (required for `'cluster'`), unless
      the scope is `'process'`
- [ ] `run()` ends when `signal` is aborted
- [ ] The server runs in a mode that stays up without requests

### Runtime

- [ ] The server logs `Worker "<name>" runs in this process` once among its copies (once per copy for `'process'`)
- [ ] `/readyz` shows `worker:<name>` with `state: 'running'` in the holder, and `'standby'` in the others
- [ ] Killing the holder makes another copy log it within `leaseMs` plus a third of it
- [ ] An error in `run()` is logged with the wait before the next run, and `/readyz` shows `restarts` growing

## Troubleshooting

| Problem                                       | Cause                                                                         | Solution                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The worker never starts                       | Not in `providers`; a `createContainer()` without `runBackground`; serverless | Register it; pass `runBackground: true`; run it in a long-lived process                             |
| It stops after a few minutes without requests | The shared local server (with no session attached) or a daemon exited idle    | `idleTimeoutMs: false` for `runShared()`, `--idle-timeout 0` for the daemon, or a long-lived server |
| `already runs elsewhere` with one server      | Another server on the machine has the same `info.name` and worker name        | Give the server a distinctive `info.name`, or the worker its own `name`                             |
| `ClusterScopeNeedsRedisError` at startup      | A `'cluster'` worker and no top-level `redis` (or a Vercel KV one)            | Add `redis` to `@FrontMcp()` or `createContainer()`, or use `scope: 'machine'`                      |
| It restarts in a loop                         | `run()` returns right away, or throws on every start                          | Keep `run()` pending until `signal` aborts; read the logged cause; raise `restart.minDelayMs`       |
| Shutdown takes `shutdownHookTimeoutMs`        | `run()` does not end when `signal` aborts                                     | Pass `signal` on, or return on its `abort` event                                                    |
| `/readyz` is `not_ready` because of a worker  | A `restart: false` worker ended on an error                                   | Fix the cause and restart the server, or let it restart (remove `restart: false`)                   |
| `/readyz`: `the lease store cannot be opened` | The SQLite file or Redis can't be reached, or `UnsafeDutyStoreError`          | Fix the store; the worker starts at the next lease check, without a restart                         |
| Two processes run it for a moment             | The old holder was paused past its lease, or ignores `signal`                 | Return on `signal`; keep the event loop free; raise `leaseMs`                                       |

## Reference

- [Providers](https://frontmcp.dev/reference/sdk/provider)
- Related skills: `create-event` (what clients subscribe to, publishing), `create-duty` (scheduled work, how the lease
  works), `create-provider` (lifecycle hooks,
  `createContainer()`), `health-readiness-endpoints`, `shared-local-server`, `build-for-cli`, `setup-sqlite`
