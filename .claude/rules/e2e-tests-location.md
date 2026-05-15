# Rule: E2E tests belong in `apps/e2e/`, NOT inside `libs/`

When adding end-to-end tests, **always** put them under
`apps/e2e/demo-e2e-<feature>/e2e/<name>.e2e.spec.ts` — not inside the
library's own `__tests__/` directory.

`libs/<package>/src/**/__tests__/*.spec.ts` is reserved for **unit tests**
that exercise pure functions, mock-driven contracts, and module-level
behavior. E2E specs that spawn subprocesses, hit real ports, or drive the
compiled CLI bin live in their own monorepo apps under `apps/e2e/`.

## Why

The Nx pipeline treats them differently:

- `apps/e2e/demo-e2e-*` projects declare `dependsOn: cli:build` (or other
  build deps) on their `build`/`test` targets, so the compiled artefacts the
  E2E needs are guaranteed to exist before the test runs.
- `apps/e2e/*/jest.e2e.config.ts` uses a separate `testMatch`
  (`**/e2e/**/*.e2e.spec.ts`), longer `testTimeout` (typically 120 s), and
  `maxWorkers: 1` — none of which apply to the per-library unit-test jest
  configs.
- Helpers like `runFrontmcpCli`, `runCli`, and `ensureBuild` already exist
  under `apps/e2e/demo-e2e-cli-exec/e2e/helpers/exec-cli.ts` and similar
  per-feature locations.

Mixing E2Es into `libs/<pkg>/src/**/__tests__/` breaks all three: per-lib
jest configs don't depend on build targets, don't get the longer timeout,
run in parallel, and have no access to the e2e helpers.

## How to apply

1. **Pick an existing E2E app** when the feature already has one. Use the
   table below as a starting point; verify via `ls apps/e2e/`.

   | Area touched                         | Target app                                 |
   | ------------------------------------ | ------------------------------------------ |
   | `frontmcp` CLI dev-tool surface      | `apps/e2e/demo-e2e-cli-exec`               |
   | Compiled `<bin>` (built-CLI) surface | `apps/e2e/demo-e2e-cli-exec`               |
   | Stdio transport                      | `apps/e2e/demo-e2e-stdio-transport`        |
   | HTTP/streamable transport            | `apps/e2e/demo-e2e-standalone`             |
   | Direct mode                          | `apps/e2e/demo-e2e-direct`                 |
   | Skills HTTP discovery                | `apps/e2e/demo-e2e-skills`                 |
   | Multi-app composition                | `apps/e2e/demo-e2e-multiapp`               |
   | Auth (CIMD / public / remote)        | `apps/e2e/demo-e2e-cimd` / `-authorities`  |
   | Channels                             | `apps/e2e/demo-e2e-channels`               |
   | Jobs / workflows                     | `apps/e2e/demo-e2e-jobs`                   |
   | Plugin: cache / remember / codecall  | `apps/e2e/demo-e2e-cache` / etc.           |
   | Renderer / UI / uipack               | `apps/e2e/demo-e2e-renderer-showcase` etc. |
   | Build pipelines (mcpb / serverless)  | `apps/e2e/demo-e2e-mcpb` / `-serverless`   |

2. **Create a new app** when no existing one fits the feature surface.
   Mirror the structure of `demo-e2e-cli-exec`:
   - `project.json` with `dependsOn: [{ projects: ['<dep>'], target: 'build' }]` on `build` and `test`
   - `jest.e2e.config.ts` with `testMatch: ['<rootDir>/e2e/**/*.e2e.spec.ts']`, `testTimeout: 120000`, `maxWorkers: 1`
   - `e2e/` directory for the specs
   - `fixture/` directory for any sample FrontMCP project the tests drive
   - `tsconfig.{app,e2e,base}.json`
   - Optionally a `webpack.config.js` if the fixture builds via webpack

3. **Reuse helpers**. Don't reinvent `runCli`, `spawnCli`, `holdPort`, etc.
   Import from the target app's `e2e/helpers/` directory. If the helper you
   need doesn't exist yet, add it there — not duplicated into a unit-test
   suite.

4. **File naming**. The convention is `<feature>.e2e.spec.ts`. Multi-word
   features use kebab-case (`cli-dev-port-conflict.e2e.spec.ts`).

5. **Don't bypass the build dependency**. If your E2E spawns the compiled
   CLI, the host project's `project.json` MUST declare the build dep so
   `nx test demo-e2e-<feature>` rebuilds the CLI when source changes.

## Anti-patterns

- ❌ `libs/cli/src/commands/dev/__tests__/foo.e2e.spec.ts` — wrong dir; won't
  pick up build deps; per-lib jest config strips `.e2e.spec.ts` by default
  even when it matches.
- ❌ Adding a "skip if dist is stale" guard to a unit-test spec to handle
  what should be a real E2E. If it needs the compiled bin, it's an E2E.
- ❌ Duplicating `runCli`/`spawnCli`/`holdPort` helpers across spec files
  instead of importing from `apps/e2e/**/helpers/`.

## Why this matters

The user has surfaced this as a non-negotiable convention. E2E specs in the
wrong location either silently don't run, run without their build deps, or
break CI when other contributors run `nx test <lib>` and hit a stale dist.
