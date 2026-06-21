# Rule: Everything runs through hookable flows — never bypass the pipeline

FrontMCP's defining architecture is the **flow pipeline**. Every request —
HTTP, MCP, auth, transport selection, audit, metrics — is handled by a **flow**
(`http:request` and its sub-flows: `session:verify`, `handle:streamable-http`,
`handle:legacy-sse`, `handle:stateless-http`, `well-known.oauth-protected-resource`,
…). A flow is an ordered set of `@Stage` steps declared in a `plan`, and **every
flow is hookable**: `FlowHooksOf(name)` exposes `Stage` / `Will` / `Did` /
`Around` so plugins and user code can intercept, wrap, replace, or observe any
stage.

**The hookability IS the product.** Because auth, rate-limiting, routing,
transports, audit, and metrics are all *flow stages*, every one of them is an
extension point. The moment you handle a request outside the flow pipeline, you
silently delete all of those extension points for that path.

## The rule (non-negotiable)

1. **Never bypass the flow pipeline to make something work.** If a request needs
   handling, add or extend a flow + its stages — do not hand-roll logic in a
   transport/adapter that skips the flow.

2. **Adapters only translate; flows decide.** A transport adapter (express,
   web-fetch/worker, stdio, in-memory) may ONLY convert its native request/
   response (`express req/res`, Web `Request`/`Response`, stdio frames) to/from
   the flow's normalized `ServerRequest` + `httpRespond` output. It MUST then run
   the same flows every other adapter runs. Two adapters must never diverge in
   *behavior* (e.g. express enforcing auth while the worker doesn't).

3. **Runtime gaps are fixed in the flow, not routed around.** If a flow stage
   can't run in a target runtime (e.g. `handle:streamable-http` needs a Node
   `ServerResponse` but a Worker only has Web `Request`/`Response`), the fix is to
   make the stage **runtime-agnostic** — emit a normalized `httpRespond` result
   that each adapter renders — NOT to write a runtime-specific shortcut that skips
   the flow. A shortcut is technical debt that strands every hook on that path.

4. **Cross-cutting concerns live in flow stages, never inlined.** Auth, quota,
   audit, metrics, notifications belong to stages (so they're hookable). Do not
   re-implement them inside an adapter or handler.

5. **Use the flow's types; never ad-hoc `as { … }`.** Flow inputs/outputs are
   typed via `FlowInputOf<Name>` / `FlowOutputOf<Name>`. Casting a flow result to
   an inline structural type (`as { status?: number; body?: unknown }`) is a code
   smell — it means you're working around the flow instead of with it.

## Anti-patterns (do NOT do these)

- ❌ Calling `scope.runFlow('session:verify', …)` by hand from a transport to
  "add auth", building 401/`WWW-Authenticate` responses inline, manually
  establishing context with `runFromHeaders`. Auth is a stage of `http:request`;
  run that flow.
- ❌ A transport handler that constructs the MCP server + calls it directly,
  skipping the `http:request` flow stages (auth, quota, audit, routing). The
  current web-fetch/worker handler does this — it is **known debt to be fixed**
  by making the flow runtime-agnostic, NOT a pattern to copy or extend.
- ❌ "It only works on the worker if I bypass X" → fix X to be runtime-agnostic.

## How to apply

- Adding request handling? Add/extend a **flow + stages** (hookable). Wire the
  adapter to translate req/res ↔ `ServerRequest`/`httpRespond` and `runFlow` it.
- Porting to a new runtime (edge/worker, Deno, Bun)? Make the existing flow
  stages produce normalized, transport-agnostic output; write a thin adapter that
  renders it. Do not fork the logic.
- Reviewing a change? If it handles a request without going through a flow, or
  inlines a cross-cutting concern, reject it.

## Why

Hookability is what makes FrontMCP extensible and uniform. Bypasses fragment the
architecture into divergent code paths, lose every plugin/hook on that path, and
produce subtle inconsistencies (the express server authenticates, the worker
doesn't). The user has surfaced this as a **non-negotiable** architectural
invariant: the way FrontMCP works is hookable flows — keep it strict.
