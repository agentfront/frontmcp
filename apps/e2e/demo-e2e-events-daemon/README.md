# Local daemon: a folder watcher and a schedule that publish events

A server that runs next to you, on your machine. A `@Worker` watches a folder with `watchFiles` and publishes
`file.dropped` for each file that appears or changes; a cron `@Duty` publishes `folder.summary` on a schedule. A local
MCP client reads both, by `events/poll` or `events/stream`.

| Piece               | File                                             |
| ------------------- | ------------------------------------------------ |
| Server              | `src/main.ts`                                    |
| `file.dropped`      | `src/apps/daemon/events/file-dropped.event.ts`   |
| `folder.summary`    | `src/apps/daemon/events/folder-summary.event.ts` |
| The watching worker | `src/apps/daemon/sources/drop-folder.worker.ts`  |
| The scheduled duty  | `src/apps/daemon/sources/folder-summary.duty.ts` |
| Smoke test          | `e2e/daemon.e2e.spec.ts`                         |

## What it shows

- **Publishing from background code.** The worker and the duty take the `EventPublisher` in their constructor. They
  are built by `AsyncProvider` factories that inject the `EVENT_PUBLISHER` token, because `tsx` emits no constructor
  types to inject by.
- **Watching files.** `watchFiles(folder, { events: ['add', 'change'], signal })` is an async iterator the worker loops
  over until the server stops it. Files already in the folder at startup are not reported.
- **A cron schedule.** The duty runs on `SUMMARY_CRON` (default `0 9 * * *`, every day at 09:00), in one process of
  the machine.
- **Filtering by arguments.** A subscription to `file.dropped` may pass `{ "extension": ".pdf" }`; the event's
  `match()` leaves the other files out.
- **Public auth for a local daemon.** The server runs in public auth mode, so any local client may poll or stream
  the events. Webhook delivery needs callers who sign in, so it is off: the events are offered by `poll` and `push`.

## ChatGPT and other remote clients

ChatGPT subscribes by webhook only, and calls the server over the internet. To use this daemon from ChatGPT, the
server needs:

- a public HTTPS address that reaches it. No tunnel is included in this example; you provide one.
- an auth mode that signs callers in (see the `frontmcp-authorities` skill), so that webhook subscriptions have an
  owner. In public auth mode the server logs that webhook delivery is off.

## Run it

```bash
DROP_FOLDER=~/Drop npx tsx apps/e2e/demo-e2e-events-daemon/src/main.ts
```

The server listens on `PORT` (3170). Drop a file in `~/Drop`, then poll:

```json
{ "method": "events/poll", "params": { "name": "file.dropped", "cursor": null } }
```

and poll again with the `cursor` of the answer.

## Test it

```bash
npx nx test demo-e2e-events-daemon
```

The test runs the duty every second (`SUMMARY_CRON='* * * * * *'`) and watches a temporary folder.
