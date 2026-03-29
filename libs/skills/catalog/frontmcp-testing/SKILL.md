---
name: frontmcp-testing
description: 'Use when you want to write tests, run tests, add e2e tests, improve test coverage, test a tool, test a resource, or learn how to test any FrontMCP component. The skill for ALL testing needs.'
tags: [router, testing, jest, e2e, coverage, quality, guide]
category: testing
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/testing/overview
---

# FrontMCP Testing Router

Entry point for testing FrontMCP applications. This skill helps you navigate testing strategies across component types and find the right patterns for unit, integration, and E2E tests.

## When to Use This Skill

### Must Use

- Setting up testing infrastructure for a new FrontMCP project
- Deciding how to test a specific component type (tool, resource, prompt, agent)
- Planning a testing strategy that covers unit, E2E, and coverage requirements

### Recommended

- Looking up testing patterns for a component type you haven't tested before
- Understanding the relationship between unit tests, E2E tests, and coverage thresholds
- Troubleshooting test failures or coverage gaps

### Skip When

- You need detailed Jest configuration and test harness setup (go directly to `setup-testing`)
- You need to build components, not test them (see `frontmcp-development`)
- You need to deploy, not test (see `frontmcp-deployment`)

> **Decision:** Use this skill for testing strategy and routing. Use `setup-testing` for hands-on Jest configuration and test writing.

## Scenario Routing Table

| Scenario                                | Skill / Section                    | Description                                               |
| --------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Set up Jest, coverage, and test harness | `setup-testing`                    | Full Jest config, test utilities, and coverage thresholds |
| Write unit tests for a tool             | `setup-testing` (Unit Testing)     | Mock DI, validate input/output, test error paths          |
| Write unit tests for a resource         | `setup-testing` (Unit Testing)     | Test URI resolution, template params, read results        |
| Write unit tests for a prompt           | `setup-testing` (Unit Testing)     | Test argument handling, message generation                |
| Write E2E protocol-level tests          | `setup-testing` (E2E Testing)      | Real MCP client/server, full protocol flow                |
| Test authenticated endpoints            | `setup-testing` + `configure-auth` | E2E with OAuth tokens, session validation                 |
| Test deployment builds                  | `setup-testing` + `deploy-to-*`    | Smoke tests against built output                          |
| Test authenticated endpoints            | `test-auth`                        | Testing authenticated endpoints                           |
| Test browser builds                     | `test-browser-build`               | Testing browser builds                                    |
| Test CLI binary builds                  | `test-cli-binary`                  | Testing CLI binary builds                                 |
| Test with the direct API client         | `test-direct-client`               | Testing with the direct API client                        |
| Write E2E test handler patterns         | `test-e2e-handler`                 | E2E test handler patterns                                 |
| Unit test individual tools              | `test-tool-unit`                   | Unit testing individual tools                             |

## Testing Strategy by Component Type

| Component | Unit Test Focus                                          | E2E Test Focus                     | Key Assertions                                                          |
| --------- | -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Tool      | Input validation, execute logic, error paths, DI mocking | `tools/call` via MCP client        | Output matches schema, errors return MCP codes                          |
| Resource  | URI resolution, read content, template param handling    | `resources/read` via MCP client    | Content type correct, URI patterns resolve                              |
| Prompt    | Argument validation, message generation, multi-turn      | `prompts/get` via MCP client       | Messages match expected structure                                       |
| Agent     | LLM config, tool selection, handoff logic                | Agent loop via MCP client          | Tools called in order, result synthesized                               |
| Provider  | Lifecycle hooks, factory output, singleton behavior      | Indirectly via tool/resource tests | Instance reuse, cleanup on scope disposal                               |
| Job       | Progress tracking, retry logic, attempt counting         | Job execution via test harness     | Progress events emitted, retries respected                              |
| Workflow  | Step dependencies, conditions, input mapping functions   | Workflow run via test harness      | Steps execute in order, conditions evaluated, continueOnError respected |
| Skill     | Instruction loading (inline/file/url), tool validation   | Skill discovery via MCP/HTTP       | Instructions resolve, tool refs validated per `toolValidation` mode     |
| Plugin    | Context extensions, provider registration, hook firing   | Indirectly via tool tests          | Extensions available on `this`, hooks fire at correct stages            |

## Cross-Cutting Testing Patterns

| Pattern            | Rule                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File naming        | Always `.spec.ts` (not `.test.ts`); E2E uses `.e2e.spec.ts`                                                                                                                                                                                                                                          |
| File organization  | Split E2E tests by app/feature: `e2e/calc.e2e.spec.ts`, `e2e/ecommerce.e2e.spec.ts`. Never put all tests in a single `server.e2e.spec.ts`                                                                                                                                                            |
| Test runner        | Use `frontmcp test` (not `jest --config ...`). It auto-generates the correct Jest/SWC config                                                                                                                                                                                                         |
| Coverage threshold | 95%+ across statements, branches, functions, lines                                                                                                                                                                                                                                                   |
| Test descriptions  | Plain English, no prefixes like "PT-001"; describe behavior not implementation                                                                                                                                                                                                                       |
| Mocking            | Mock providers via DI token replacement, never mock the framework                                                                                                                                                                                                                                    |
| httpMock scope     | `httpMock` intercepts HTTP in the **test process** only, NOT in the MCP server subprocess. Do not use httpMock to intercept server-to-API calls — those happen in the child process. Use httpMock for verifying client-to-server request shapes or mocking external APIs called from the test itself |
| Error testing      | Assert `instanceof` specific error class AND MCP error code                                                                                                                                                                                                                                          |
| Async              | Always `await` async operations; use `expect(...).rejects.toThrow()` for async errors                                                                                                                                                                                                                |

## Common Patterns

| Pattern            | Correct                                                       | Incorrect                                    | Why                                                                   |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Test file location | `fetch-weather.tool.spec.ts` next to source                   | `__tests__/fetch-weather.test.ts`            | Co-location with `.spec.ts` extension matches FrontMCP conventions    |
| DI mocking         | Replace token with mock via `scope.register(TOKEN, mockImpl)` | `jest.mock('../provider')` module mock       | DI mocking is cleaner, type-safe, and tests the real integration path |
| Error assertions   | `expect(err).toBeInstanceOf(ResourceNotFoundError)`           | `expect(err.message).toContain('not found')` | Class checks are stable; message strings are fragile                  |
| E2E transport      | Use `@frontmcp/testing` MCP client with real server           | HTTP requests with `fetch`                   | The test client handles protocol details (session, framing)           |
| Coverage gaps      | Investigate uncovered branches, add targeted tests            | Add `istanbul ignore` comments               | Coverage gaps often hide real bugs; ignoring them defeats the purpose |

## Verification Checklist

### Infrastructure

- [ ] Jest configured with `@frontmcp/testing` preset
- [ ] Coverage thresholds set to 95% in jest.config
- [ ] Test files use `.spec.ts` extension throughout

### Unit Tests

- [ ] Each tool has unit tests covering happy path, validation errors, and DI failures
- [ ] Each resource has unit tests covering URI resolution and read content
- [ ] Provider lifecycle (init, dispose) tested where applicable

### E2E Tests

- [ ] At least one E2E test exercises full MCP protocol flow (connect, list, call, disconnect)
- [ ] Authenticated E2E tests use proper test tokens (not mocked auth)
- [ ] E2E tests clean up state after execution

### CI Integration

- [ ] Tests run in CI pipeline on every PR
- [ ] Coverage report published and enforced
- [ ] Failing tests block merge

## Troubleshooting

| Problem                            | Cause                                                   | Solution                                                                               |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Jest not finding test files        | Wrong file extension (`.test.ts` instead of `.spec.ts`) | Rename to `.spec.ts`; check `testMatch` in jest.config                                 |
| Coverage below 95%                 | Untested error paths or conditional branches            | Run `frontmcp test --coverage` and inspect uncovered lines in the report               |
| E2E test timeout                   | Server startup too slow or port conflict                | Increase Jest timeout; use random port allocation                                      |
| DI resolution fails in tests       | Provider not registered in test scope                   | Register mock providers before creating the test context                               |
| Istanbul shows 0% on async methods | TypeScript source-map mismatch with Istanbul            | Known issue with some TS compilation settings; verify coverage with actual test output |

## Reference

- [Testing Documentation](https://docs.agentfront.dev/frontmcp/testing/overview)
- Related skills: `setup-testing`, `create-tool`, `create-resource`, `create-prompt`, `configure-auth`
