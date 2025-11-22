# Contributing to FrontMCP

Thanks for helping improve FrontMCP! This repo hosts the core SDK, CLI, adapters, plugins, docs, and the demo app. The
project follows the [Code of Conduct](./CODE_OF_CONDUCT.md); by participating you agree to uphold it.

## Ways to Contribute

- Report reproducible bugs, missing docs, or regression risks via GitHub issues.
- Improve docs (`/docs`), snippets, or the demo app in `apps/demo`.
- Fix bugs or add features inside the packages under `libs/*`.
- Build adapters/plugins/examples that showcase how the SDK should be used.

If you are unsure whether a change fits, open an issue first so we can discuss the scope.

## Prerequisites and Tooling

- Node.js **>= 22** and npm **>= 10** (see README installation section).
- Yarn (this workspace enables Corepack and sets `"packageManager": "yarn"` in `nx.json`). Run `corepack enable` once if
  needed.
- Nx CLI (`yarn nx --help`) powers builds, lint, tests, and type-checking.
- Git and a GitHub account for forks/PRs.

First-time setup:

```bash
git clone https://github.com/agentfront/frontmcp.git
cd frontmcp
corepack enable
yarn install
```

## Workspace Layout

This is an Nx monorepo. Each folder under `libs/*` is an independently built package (for example `libs/sdk`,
`libs/cli`, `libs/plugins`, `libs/adapters`). The demo and any showcase apps live under `apps/*`. Project-specific tasks
are declared in each `project.json`.

Helpful references:

- `README.md` for a high-level overview and quickstart.
- `CHANGELOG.md` for release notes—update it when user-facing behavior changes.
- `docs/` for the Mintlify-based documentation site (`yarn docs:local` runs a local preview).

## Day-to-Day Commands

```bash
yarn dev                       # nx serve demo (demo server hot reload)
yarn nx test sdk               # run Jest tests for libs/sdk
yarn nx lint plugins           # lint a specific project
yarn nx run-many -t lint,test  # run lint+test for everything
yarn nx run-many -t build      # build all publishable packages
yarn docs:local                # preview the docs site locally
yarn nx affected --target test --base main  # limit CI work to changed projects
```

Before opening a PR, run at least `yarn nx run-many -t lint,test` and `yarn nx run-many -t build`. If you changed
transport/session/auth flows, also try the Inspector (`npx frontmcp inspector`) to verify end-to-end behavior.

## Coding Standards

- Use TypeScript, modern ESM syntax, and decorators that align with the SDK’s existing patterns.
- Keep `@frontmcp/*` versions aligned inside examples (see README “Version Alignment”).
- Prefer strongly typed Zod schemas (pass fields directly, matching current code style).
- Keep changes focused; split unrelated work across multiple PRs.
- Formatting is enforced by Prettier and lint rules (run `yarn nx lint <project>` locally). Husky + lint-staged will
  format staged files on commit.
- Add concise comments only when necessary to explain non-obvious intent.

## Testing Expectations

- Every bug fix or feature should include/adjust Jest specs alongside the code (`*.spec.ts`).
- Use Nx test targets close to the code (`yarn nx test sdk`, `yarn nx test cli`, etc.).
- Integration behavior that spans packages should be validated in the demo app (spin up `yarn dev`) and, when possible,
  through Inspector flows.
- If you touch build tooling, ensure `yarn nx run-many -t build` succeeds and that emitted artifacts under `dist/` look
  reasonable.

## Documentation and Samples

- Docs live in `docs/` (Mintlify). After editing, run `yarn docs:local` to confirm the nav/build passes.
- Keep `README.md` in sync with notable DX changes (new scripts, requirements, etc.).
- Update code snippets under `docs/snippets` if your change alters their behavior.
- Demo updates should remain scoped and easy to understand; prefer creating a new sample app/tool over overloading
  existing ones.

## Pull Request Checklist

1. Open/mention an issue for significant changes.
2. Rebase on the latest `main`; keep history clean (squash in your fork if needed).
3. Add or update unit tests plus docs/snippets.
4. Run:
   - `yarn nx run-many -t lint,test`
   - `yarn nx run-many -t build`
   - `yarn docs:local` (if docs changed)
   - `npx frontmcp doctor` and try Inspector if your change affects runtime behavior.
5. Update `CHANGELOG.md` when the change is user-facing.
6. Include screenshots or logs when the change affects dev tooling or Inspector UX.

Maintainers handle publishing; do not run manual `npm publish` steps.

## Communication

- For security issues, email `david@frontegg.com` instead of opening a public issue.
- For general help, use GitHub Discussions/Issues or reach out during office hours if announced.

We appreciate every contribution—thank you for making FrontMCP better!
