---
name: stall-detection
description: Find what blocks the event loop - a warning naming the calls in flight during each stall, a stall-seconds counter per entry, and GC pauses counted apart
---

# Stall detection

A tool that does synchronous work (a big `JSON.parse`, a regex on a large string, a sync crypto call, a busy loop) blocks
the event loop: every other call, health check and stream on the server waits. `observability.stalls` measures the loop
delay and, for each stall, names the calls that were running during it.

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
Event loop stalled for 250 ms with no call in flight
```

- Each call is its method (`tools/call`, `resources/read`, `prompts/get`), the entry's full name (its app's id first),
  how long it had been running when the stall ended, and the first 12 hex characters of the session's tracing hash. A
  call's input, its answer and the raw session id are never in the line.
- At most five calls are named; the rest are counted (`and 3 more`).
- A call is in flight from the start to the end of its `execute` stage, whether it returns, throws or is aborted. A
  call that timed out (`timeout.executeMs`) stays in flight until the execution it left behind settles.

## The metric

Each stall adds to `frontmcp_event_loop_stall_seconds_total`, labelled `cause` and `entry`:

```text
frontmcp_event_loop_stall_seconds_total{cause="tools/call",entry="reports:export"} 1.82
frontmcp_event_loop_stall_seconds_total{cause="gc",entry=""} 0.26
frontmcp_event_loop_stall_seconds_total{cause="unknown",entry=""} 0.25
```

- `cause` is the method of a call in flight, `gc` for garbage-collection time, or `unknown` when no call was in flight.
- A stall counts once for each entry in flight during it, so the sum across entries can exceed the time stalled.
- `entry` is always a registered entry's name, so the label values are bounded by your server.
- Served on `/metrics` under the `process` category (see `metrics-endpoint`).

## GC pauses

Garbage-collection pauses (`PerformanceObserver` on `gc` entries) are measured apart. When the stall less its GC time is
under the threshold, the stall is GC's: the warning says so, and only the GC time is counted, under `cause="gc"`. The
calls in flight are not blamed.

## Under `frontmcp dev`

`frontmcp dev` writes each stall to its events file (`.frontmcp/dev-events.jsonl`) next to the timing and failure of
each call, with the same fields as the report (`type: "stall"`, `stallMs`, `gcMs`, `cause`, `calls`). See the
`frontmcp dev` section of `frontmcp-setup`'s `setup-project` reference.

## How it works

- A sampler reads `perf_hooks.monitorEventLoopDelay()` every `min(thresholdMs, 100)` ms on an unref'd timer, from the
  moment the server serves until shutdown.
- The calls in flight are kept by `Around` hooks on the `execute` stage of `tools:call-tool`,
  `resources:read-resource` and `prompts:get-prompt`, and each call is reported by `Finally` hooks on `finalize`. The
  hooks exist only when `stalls` or dev events are on.
- A stall is reported on the sample after the one that measured it, so the GC pauses of the stall have been delivered.
- Node.js only: where `perf_hooks` is missing (edge runtimes) the detector does nothing.

The detector names the calls in flight; it does not profile them. When several calls run during a stall, all are named.

## Verification checklist

- [ ] `observability.stalls` is set, with `thresholdMs` above your normal loop delay
- [ ] A tool that blocks the loop for longer than the threshold is named in a `Event loop stalled for` warning
- [ ] `/metrics` lists `frontmcp_event_loop_stall_seconds_total` with the tool's full name as `entry`
- [ ] No warning names a call that already failed (a failed call leaves the calls in flight)

## Troubleshooting

| Problem                                      | Cause                                                             | Solution                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Warnings with `no call in flight`            | The loop was blocked by code outside a call: a timer, a job, boot | Profile with `node --cpu-prof`; module loading on first use is a common cause                   |
| Stalls blamed on `gc`                        | Large heaps or bursts of allocation                               | Check `frontmcp_process_heap_used_bytes`; stream big answers instead of building them in memory |
| The stall counter is missing from `/metrics` | `metrics.include` leaves out `process`                            | Add `process` to `include`, or leave `include` unset                                            |
| Every call of a slow but async tool is named | It was in flight while another call blocked the loop              | Look for the call named in every stall; an async call is named only when it overlaps one        |

## Examples

| Example                                                                       | Level | Description                                                                         |
| ----------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| [`find-a-blocking-tool`](../examples/stall-detection/find-a-blocking-tool.md) | Basic | Turn on stall detection and see the warning name a tool that blocks the event loop. |

## Reference

- [Observability Guide](https://frontmcp.dev/reference/server/observability)
- Related: `metrics-endpoint`, `structured-logging`, `frontmcp-setup` (`frontmcp dev`)
