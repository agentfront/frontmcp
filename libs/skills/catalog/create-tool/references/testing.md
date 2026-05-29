---
name: testing
description: Per-tool unit tests — pointer to the dedicated `testing` skill for the canonical patterns.
---

# Per-tool unit testing

Every tool ships with `<name>.tool.spec.ts`. The canonical test surface lives in the dedicated **`testing` skill** — this reference is a short pointer plus the per-tool checklist.

## What `@frontmcp/testing` actually exposes

| Surface                                                      | Purpose                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `TestServer` (+ `TestServerOptions`)                         | Boot a real `@FrontMcp({...})` server in-process for tests |
| `McpTestClient` (+ `McpTestClientBuilder`)                   | Client to talk to the test server                          |
| `test` (Playwright-style fixture) + `expect` + `mcpMatchers` | Test runner and matchers                                   |
| `mockResponse`, `httpMock`, `httpResponse`, `interceptors`   | HTTP / outbound mocking                                    |
| `TestUsers`, `TestTokenFactory`, `AuthHeaders`               | Auth fixtures for authenticated tools                      |
| `MockOAuthServer`, `MockCimdServer`, `MockAPIServer`         | Mocks for end-to-end auth flows                            |

The `testing` skill is where you'll find:

- The canonical `test({ mcp }) => …` fixture pattern.
- How to register a single tool / app for a focused test scope.
- How to assert MCP responses via `mcpMatchers` (`toHaveRenderedHtml`, `toBeXssSafe`, `toContainBoundValue`, etc.).
- How to mock outbound HTTP with `httpMock` (so `this.fetch` returns deterministic responses).
- How to inject mock providers for DI tokens.
- How to drive interactive `this.elicit` flows from a test.
- How to assert `this.progress` / `this.notify` event streams.
- E2E patterns (subprocess CLI exec, real-port transports — those live in `apps/e2e/demo-e2e-*/`, not in per-library specs).

## Per-tool unit test — what to cover

For every tool, the spec covers (at minimum):

- [ ] **Happy path** — typical valid input → expected output, with `mcpMatchers` asserting the shape of the response.
- [ ] **Input-validation rejection** — Zod constraints fire (`min`, `max`, `regex`, `enum`).
- [ ] **At least one business-logic failure path** — `this.fail(new SomeMcpError(...))` triggers, the client sees the right MCP error code.
- [ ] **Mocked DI** — providers swapped via the testing harness; verify the tool calls the right service methods.
- [ ] **(If `this.fetch`)** — outbound HTTP mocked via `httpMock`, asserting URL / headers / body.
- [ ] **(If `this.elicit`)** — pre-arrange the elicitation response in the test harness and assert the `accept` / `decline` / `cancel` branches.
- [ ] **(If `this.progress`)** — assert the progress events fire with the expected `current` / `total` values.

## File naming

- `<name>.tool.spec.ts` — never `.test.ts` (the repo enforces `.spec.ts`).
- Co-located with the tool source — `src/apps/<app>/tools/<name>/<name>.tool.spec.ts` (folder-per-tool layout) OR `src/apps/<app>/tools/<name>.tool.spec.ts` (flat sibling).

## Don't

- Don't boot the full real server (production transport, real auth, real DBs) for a per-tool unit test. Use the testing skill's focused fixtures.
- Don't assert the precise text of `PublicMcpError` messages. Assert the error class / `errorCode` (e.g. `'RATE_LIMIT_EXCEEDED'`, `'RESOURCE_NOT_FOUND'`) so the test isn't brittle to wording.
- Don't put end-to-end tests in per-library `__tests__/`. They belong in `apps/e2e/demo-e2e-*/` per the e2e-tests-location rule.

## See also

- `testing` skill — the canonical fixtures, mock patterns, and matchers
- [`error-handling.md`](./error-handling.md) — error codes to assert against
- [`execution-context.md`](./execution-context.md) — what `this.*` does, so you know what to mock
