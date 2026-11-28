---
name: stall-detection
description: Find what blocks the event loop - a warning naming the calls and work in flight during each stall (HTTP routes, duties, workers, trackWork()), a stall-seconds counter per entry, and GC pauses counted apart
---

# Stall detection

A tool that does synchronous work (a big `JSON.parse`, a regex on a large string, a sync crypto call, a busy loop) blocks
the event loop: every other call, health check and stream on the server waits. `observability.stalls` measures the loop
delay and, for each stall, names the calls and the other work that were running during it: the server's `@HttpRoute`
requests, `@Duty` runs and `@Worker` runs, and any work you mark with `trackWork()`.

## When to use

- Calls to unrelated tools get slow at random, or `/healthz` times out under load.
- `frontmcp_nodejs_eventloop_lag_seconds` is high on `/metrics` and you need to know which tool causes it.
- You want each stall in your logs, and stall seconds per tool in Prometheus.

## Enable

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: {
    tracing: true,
    stalls: { thresholdMs: 200 }, // or `stalls: true` for 200 ms
  },
})
class Server {}
```

With the plugin directly: `ObservabilityPlugin.init({ stalls: { thresholdMs: 200 } })`.

| Option        | Default | Meaning                                                                      |
| ------------- | ------- | ---------------------------------------------------------------------------- |
| `thresholdMs` | `200`   | The shortest loop delay reported as a stall, a whole number from 20 to 60000 |

Stall detection is off by default. An invalid option fails at boot with `ObservabilityConfigurationError`
(`OBSERVABILITY_CONFIGURATION`), naming the option: `Invalid ObservabilityPlugin options: stalls.thresholdMs: must be a
whole number of milliseconds from 20 to 60000`.

## What a stall report says

One warning per stall, from the `CallMonitor` logger:

```text
Event loop stalled for 612 ms while running tools/call reports:export (610 ms, session 3fa9c2d41b07)
Event loop stalled for 640 ms (40 ms in garbage collection) while running tools/call reports:export (598 ms)
Event loop stalled for 300 ms, 260 ms of it in garbage collection
Event loop stalled for 450 ms while running duty nightly-ingest (448 ms)
Event loop stalled for 250 ms with no call in flight
```

- Each call is its method (`tools/call`, `resources/read`, `prompts/get`), the entry's full name (its app's id first),
  how long it had been running when the stall ended, and the first 12 hex characters of the session's tracing hash. A
  call's input, its answer and the raw session id are never in the line.
- At most five calls are named; the rest are counted (`and 3 more`).
- A call is in flight from the start to the end of its `execute` stage, whether it returns, throws or is aborted. A
  call that timed out (`timeout.executeMs`) stays in flight until the execution it left behind settles.
- `with no call in flight` means no call and no work span was in flight.

## Work outside MCP calls

Work the server runs outside an MCP call is named by its work span: its kind, then its name, without a session.

| Kind     | Opened for                                                                          | Name                                                                             |
| -------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `http`   | Each request an `@HttpRoute` handles (`handle()`), and each view an SSE route sends | The route's method and declared path, `GET /board/:id`, never the path asked for |
| `duty`   | Each run of a `@Duty`                                                               | The duty's name                                                                  |
| `worker` | Each run of a `@Worker`, from `run()` until it returns or throws                    | The worker's name                                                                |
| `work`   | `trackWork(label)`, until you end it                                                | The label                                                                        |

```text
Event loop stalled for 610 ms while running http GET /reports/:id (604 ms)
Event loop stalled for 380 ms while running work ingest:batch (377 ms)
```

Mark other work, such as a timer's callback, a queue consumer or a batch of background ingest, with `trackWork()` from
`@frontmcp/sdk`. It returns the function that ends the span; call it in a `finally`. Ending a span twice does nothing.

```typescript
import { trackWork } from '@frontmcp/sdk';

setInterval(async () => {
  const end = trackWork('ingest:batch');
  try {
    await ingestNextBatch();
  } finally {
    end();
  }
}, 60_000);
```

- Keep labels to a fixed set (`ingest:batch`, not `ingest:batch:${id}`): each one is an `entry` label value of the stall
  counter.
- A worker's span lasts its whole `run()`, so a worker that loops forever is named in every stall while it runs, with its
  running time. Open a `trackWork()` span around each unit of work inside it to see which unit was running.
- With stall detection off, `trackWork()` and the spans the server opens cost a check and nothing more.
- `registerWorkTracker({ begin(span) { ...; return end; } })` from `@frontmcp/sdk` follows every work span of the
  process, for a tool of your own; it returns the function that stops following them. The stall detector uses it.

## The metric

Each stall adds to `frontmcp_event_loop_stall_seconds_total`, labelled `cause` and `entry`:

```text
frontmcp_event_loop_stall_seconds_total{cause="tools/call",entry="reports:export"} 1.82
frontmcp_event_loop_stall_seconds_total{cause="gc",entry=""} 0.26
frontmcp_event_loop_stall_seconds_total{cause="unknown",entry=""} 0.25
```

- `cause` is the method of a call in flight, the kind of a work span (`http`, `duty`, `worker`, `work`), `gc` for
  garbage-collection time, or `unknown` when nothing was in flight.
- A stall counts once for each entry in flight during it, so the sum across entries can exceed the time stalled.
- `entry` is a registered entry's name, a route's declared path, a duty's or worker's name, or a `trackWork()` label,
  so the label values are bounded by your server as long as your labels are.
- Served on `/metrics` under the `process` category (see `metrics-endpoint`).

## GC pauses

Garbage-collection pauses (`PerformanceObserver` on `gc` entries) are measured apart. When the stall less its GC time is
under the threshold, the stall is GC's: the warning says so, and only the GC time is counted, under `cause="gc"`. The
calls in flight are not blamed.

## Under `frontmcp dev`

`frontmcp dev` writes each stall to its events file (`.frontmcp/dev-events.jsonl`) next to the timing and failure of
each call, with the same fields as the report (`type: "stall"`, `stallMs`, `gcMs`, `cause`, `calls`); a work span is in
`calls` with its kind as `method` and its name as `entry`. See the
`frontmcp dev` section of `frontmcp-setup`'s `setup-project` reference.

## How it works

- A sampler checks the event loop every 10 ms on an unref'd timer, from the moment the server serves until shutdown. A
  gap of `thresholdMs` or more between two checks is a stall, measured to within 10 ms.
- The process has one detector for each `thresholdMs`: the servers of a `splitByApp` server, or of standalone apps,
  share it when they use the same threshold, so each stall is one warning naming the calls of every server. Servers
  with different thresholds each report the stall.
- The calls in flight are kept by `Around` hooks on the `execute` stage of `tools:call-tool`,
  `resources:read-resource` and `prompts:get-prompt`, and each call is reported by `Finally` hooks on `finalize`. The
  hooks exist only when `stalls` or dev events are on.
- The work spans are kept by a tracker the detector registers with `registerWorkTracker()` once it samples, one per
  detector however many servers share it, and removes when the last of them shuts down.
- A stall is reported on the sample after the one that measured it, so the GC pauses of the stall have been delivered.
- Node.js only: where `perf_hooks` is missing (edge runtimes) the detector does nothing, and keeps no calls in flight.

The detector names the calls and work in flight; it does not profile them. When several run during a stall, all are
named.

## New in 1.14

- A stall names the `@HttpRoute` requests, `@Duty` runs and `@Worker` runs in flight, and the work you mark with
  `trackWork()`. Up to 1.13 these stalls read `with no call in flight` and counted under `cause="unknown"`; now they
  read `while running duty nightly-ingest (448 ms)` and count under `cause="duty"`, `"http"`, `"worker"` or `"work"`.
- `trackWork(label)` and `registerWorkTracker(tracker)` are exported from `@frontmcp/sdk`.

## Verification checklist

- [ ] `observability.stalls` is set, with `thresholdMs` above your normal loop delay
- [ ] A tool that blocks the loop for longer than the threshold is named in a `Event loop stalled for` warning
- [ ] `/metrics` lists `frontmcp_event_loop_stall_seconds_total` with the tool's full name as `entry`
- [ ] No warning names a call that already failed (a failed call leaves the calls in flight)

## Troubleshooting

| Problem                                      | Cause                                                                                       | Solution                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Warnings with `no call in flight`            | The loop was blocked by code outside a call and outside any work span: a timer, a job, boot | Wrap the work in `trackWork()`, or profile with `node --cpu-prof`; module loading on first use is a common cause |
| Stalls blamed on `gc`                        | Large heaps or bursts of allocation                                                         | Check `frontmcp_process_heap_used_bytes`; stream big answers instead of building them in memory                  |
| The stall counter is missing from `/metrics` | `metrics.include` leaves out `process`                                                      | Add `process` to `include`, or leave `include` unset                                                             |
| Every call of a slow but async tool is named | It was in flight while another call blocked the loop                                        | Look for the call named in every stall; an async call is named only when it overlaps one                         |

## Examples

| Example                                                                       | Level | Description                                                                         |
| ----------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| [`find-a-blocking-tool`](../examples/stall-detection/find-a-blocking-tool.md) | Basic | Turn on stall detection and see the warning name a tool that blocks the event loop. |

## Reference

- [Observability Guide](https://frontmcp.dev/reference/server/observability)
- Related: `metrics-endpoint`, `structured-logging`, `frontmcp-setup` (`frontmcp dev`)
