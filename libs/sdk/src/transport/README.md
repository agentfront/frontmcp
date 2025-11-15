# High-level architecture changes

1. ## Single MCP endpoint (per spec)

- Expose **one** HTTP path (e.g. `/mcp`) that handles **POST** and **GET** as required by Streamable HTTP. ([Model
  Context Protocol][1])
- Keep your **legacy SSE** endpoints alongside the new MCP endpoint for back-compat (old HTTP+SSE). ([Model Context
  Protocol][1])

2. ## Session & identity model

- **Authorization**: keep using `Authorization: Bearer <access-token>` on **every** HTTP request (even within a
  session). ([Model Context Protocol][2])
- **Session**: on `initialize`, issue **Mcp-Session-Id** (JWT is fine) in the **response header**; client **MUST** echo
  `Mcp-Session-Id` in all subsequent requests for that session. ([Model Context Protocol][1])
- Allow **multiple sessions per Authorization** token: the token authenticates the caller; each `initialize` yields a
  **distinct** `Mcp-Session-Id` bound to that auth context.
- If your server terminates a session, reply **404** to further requests with that `Mcp-Session-Id`; client must start a
  new `initialize`. ([Model Context Protocol][1])

3. ## Transport abstraction

- Introduce a **TransportRegistry** keyed by `Mcp-Session-Id` (and, for multi-stream cases, by **stream ID** as well).
- Three concrete transports:

  - **Legacy SSE transport** (old protocol)
  - **Streamable HTTP (short-lived POST producing SSE)**
  - **Streamable HTTP (pure JSON POST, no SSE)**

- Optional fourth mode: **Stateless standard HTTP** (no `initialize`, no `Mcp-Session-Id`), gated by config.

4. ## Cross-node delivery (pub/sub)

- Add a **pub/sub bus** keyed by `Mcp-Session-Id` to route server-originated messages/requests/results to the node that
  currently owns the active SSE stream (legacy or streamable).
- Include **origin metadata** in bus envelopes (node ID, shard) so a node that receives a non-local session message
  republishes/forwards correctly.

5. ## Event IDs & resumability (spec alignment)

- For any **SSE stream you control**, attach **`id`** on events and support **`Last-Event-ID`** on resume; IDs are
  **per-stream cursors** (not global). ([Model Context Protocol][1])
- For **Streamable HTTP** with server-initiated SSE (POST→SSE) or GET→SSE listener: support **replay after disconnect**
  when feasible; otherwise _clearly signal loss_. (Spec: server **MAY** make stream resumable; **SHOULD NOT** treat
  disconnect as cancel.) ([Model Context Protocol][1])

---

# Protocol-level request routing (what each method does)

## A) Legacy SSE (old HTTP+SSE transport)

- Keep your **legacy GET SSE** open and **pin the transport** until the connection closes.
- On **POSTs** that target legacy SSE:

  - If the request is not an `initialize` and there’s **no local SSE transport** for `sessionId`, **publish** the work
    item to pub/sub (with node origin headers) and **immediately end** the HTTP request. The actual response will arrive
    on the **already-open SSE** stream on whichever node owns it.
  - This matches your “fire-and-forward” model and keeps old clients happy (per spec “Backwards Compatibility”, continue
    hosting old endpoints). ([Model Context Protocol][1])

## B) Streamable HTTP – **SSE Listener** (server→client channel)

- Support **GET /mcp** with `Accept: text/event-stream` to open a **server-initiated SSE stream** with **no prior
  POST**. Server can send requests/notifications to the client on this stream; **no responses** may be sent here unless
  resuming an earlier POST stream. ([Model Context Protocol][1])
- Register **SSETransport** in `TransportRegistry` under the `Mcp-Session-Id`; on close, unregister.
- Use **pub/sub** to deliver server-originated messages or **tool-result pushbacks** to the node that owns the SSE
  listener for that session.

> How do client results get back? The client answers via **POST /mcp** (normal “Sending Messages to the Server”). If the
> POST contains only responses/notifications, server **202 Accepted** with empty body; otherwise respond per normal.
> ([Model Context Protocol][1])

## C) Streamable HTTP – **single POST, JSON response (no SSE)**

- For POSTs where `Accept` negotiates `application/json` (no `text/event-stream`), use the **JSON mode** the spec
  defines: you accept requests/batches and return **one JSON object** containing all responses (server MAY send 202 for
  notifications-only). This is already handled by the standard Streamable HTTP behavior you noted. ([Model Context
  Protocol][1])
- Treat this as **short-lived, stateless per request**; close immediately after responding. ([Model Context
  Protocol][1])

## D) Streamable HTTP – **single POST opening SSE (short-lived)**

- For POSTs where `Accept` includes `text/event-stream`, open a **short-lived SSE** tied to that POST. Stream responses
  (and any server requests/notifications related to that POST) and **close when all responses have been sent** (or
  session expires). ([Model Context Protocol][1])
- Assign **per-stream event IDs** and honor **`Last-Event-ID`** for replay on reconnect. ([Model Context Protocol][1])
- For **multi-node**, maintain an **event store** (see next section) so a fresh node handling a resumed POST can
  **replay** missed events before continuing (this aligns with spec’s resumability guidance). ([Model Context
  Protocol][1])

## (Optional) E) **Stateless standard HTTP** (no `initialize`, no `Mcp-Session-Id`)

- When enabled, if a request hits a **Streamable HTTP action without `Mcp-Session-Id`**, treat it as a **stateless**
  operation:

  - For `Accept: application/json` → return **JSON** batch response (no session, no event store). ([Model Context
    Protocol][1])
  - For `Accept: text/event-stream` → you **may** open a short-lived SSE for that single POST, but do **not** persist a
    session or event store (purely ephemeral).

- When **disabled**, any Streamable HTTP request (except `initialize`) **without** `Mcp-Session-Id` must get **400 Bad
  Request** (server requires session per spec). ([Model Context Protocol][1])

---

# Event & state strategy (surviving restarts / multi-node)

1. **Per-stream event IDs**

- Tag SSE events with `id`; accept `Last-Event-ID` on GET/POST-SSE resumes. IDs are **per stream** (do not replay
  between different streams). ([Model Context Protocol][1])

2. **Event store (configurable)**

- For **short-lived POST→SSE** mode and **SSE listener** mode, keep a **bounded event buffer per stream** (e.g., ring
  buffer) so you can replay on resume.
- Storage choices:

  - **Distributed KV** (recommended for cross-node + restart)
  - In-memory only (fast but no resilience on restart / node change)

- If replay window expired or missing, return a typed error and require re-init/retry (consistent with spec’s MAY for
  resumability).

3. **Session lifecycle vs transport lifetime**

- You **can** terminate an MCP session at will; after that respond **404** to any request with that `Mcp-Session-Id`.
  ([Model Context Protocol][1])
- Treat transports (SSE streams) as **ephemeral** attachments to a session; on close, either:

  - Keep session alive (client can open a new stream or POST again), or
  - End the session and enforce 404.

---

# Dispatcher & error semantics (spec-consistent)

- **Initialize required**: if server requires sessions and receives a non-`initialize` POST **without**
  `Mcp-Session-Id`, return **400 Bad Request**. ([Model Context Protocol][1])
- **Unknown/terminated session**: requests with `Mcp-Session-Id` that the server does not recognize → **404 Not Found**;
  client must `initialize` again. ([Model Context Protocol][1])
- **Notifications/responses-only POST**: accept → **202 Accepted**, empty body; else 4xx with optional JSON-RPC error
  (no `id`). ([Model Context Protocol][1])
- **GET /mcp** when you don’t offer the SSE listener → **405 Method Not Allowed**. ([Model Context Protocol][1])
- **Auth failures**: invalid/expired Authorization → **401** per Authorization spec. ([Model Context Protocol][2])

---

# Multi-session per Authorization: concrete rules

- Allow **N parallel sessions** per bearer token.
- Each `initialize`:

  - Validates Authorization (per OAuth2.1) and negotiates capabilities (per Lifecycle). ([Model Context Protocol][2])
  - Issues a unique **`Mcp-Session-Id`** (JWT fine; ASCII, secure randomness). ([Model Context Protocol][1])

- `TransportRegistry` may now hold **multiple entries** under the same `Authorization` principal, each keyed by its
  **session ID**.
- **Multiple connections**: clients may open multiple SSE streams concurrently; server MUST NOT duplicate messages
  across streams—each JSON-RPC message is sent on **one** stream only. ([Model Context Protocol][1])

---

# Config matrix & behavior (what devs can enable)

Create a server config block like:

- `enableLegacySSE` (default: off)
- `enableStreamableHTTP_JSON` (on)
- `enableStreamableHTTP_SSE` (on)
- `enableStreamableHTTP_GET_SSEListener` (optional; on for reverse-channel)
- `enableStatelessStandardHTTP` (off)
- `requireSessionForStreamableHTTP` (on)
- `eventStore.mode` = `distributed | memory | off`
- `eventStore.maxEventsPerStream` & `eventStore.ttlMs`
- `pubsub.enabled` (on for multi-node) & backend selection

**Routing rules based on config:**

- If `requireSessionForStreamableHTTP` and request lacks `Mcp-Session-Id` (and isn’t `initialize`) → **400**. ([Model
  Context Protocol][1])
- If `enableStatelessStandardHTTP` and _no_ `Mcp-Session-Id`:

  - Serve as **stateless** in the selected POST mode (JSON or POST-SSE based on `Accept`). **Do not** mint a session ID.
  - If a `Mcp-Session-Id` is present **and** you want to force stateless only → respond **404** “no active transport;
    initialize first” (makes it clear stateless requests must not carry a session header).

- If `enableLegacySSE`: keep legacy endpoints; on cross-node POSTs, forward via pub/sub and end the request; response
  goes over the open legacy SSE.
- If `enableStreamableHTTP_GET_SSEListener`: accept GET with `Accept: text/event-stream` and register the listener SSE;
  otherwise **405**. ([Model Context Protocol][1])

---

# Operational notes

- **Disconnections ≠ cancel**. The server should not assume a cancel on disconnect; support `CancelledNotification` for
  explicit cancels. ([Model Context Protocol][1])
- **Timeouts** & cancellations should follow Lifecycle guidance; allow per-request configurable timeouts and support
  cancellation notifications. ([Model Context Protocol][3])
- **Origin checks** and localhost binding for dev to avoid DNS-rebinding risks (security warning). ([Model Context
  Protocol][1])

---

## What this gives you

- Multiple concurrent **MCP sessions per Authorization** token (each with its own `Mcp-Session-Id`). ([Model Context
  Protocol][1])
- Three transport modes, plus an **optional stateless** mode, all **behind a single MCP endpoint** and **config-gated**.
- Cross-node delivery via **pub/sub** and **replay** via an **event store** when enabled, matching MCP’s
  **resumability** and **multiple connections** guidance. ([Model Context Protocol][1])
