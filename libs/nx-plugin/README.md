# @frontmcp/nx

The Nx plugin for FrontMCP. It adds generators that write FrontMCP apps, libraries, deployment shells and component classes, and executors that run the [`frontmcp`](https://www.npmjs.com/package/frontmcp) CLI as Nx targets. Use it when several servers share code and you want Nx's project graph, caching and `affected` commands; for a single server, `frontmcp create` without `--nx` is simpler.

[![npm](https://img.shields.io/npm/v/@frontmcp/nx.svg)](https://www.npmjs.com/package/@frontmcp/nx) [![License](https://img.shields.io/npm/l/@frontmcp/nx.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

Start a new workspace with the plugin:

```bash
npx frontmcp create help-desk-platform --nx
```

Or add it to a workspace you have:

```bash
npx nx add @frontmcp/nx
```

`nx` 22 or later is a peer dependency. `nx add` runs the plugin's `init` generator, which adds `@frontmcp/sdk`, `frontmcp`, `reflect-metadata`, `zod` and `tslib` to `dependencies` and `@frontmcp/testing`, Jest and SWC (the compiler `frontmcp test` uses) to `devDependencies`, and makes the `build`, `build-exec` and `test` executors cacheable in `nx.json`. If you installed the package with `npm install -D @frontmcp/nx` instead, run `npx nx g @frontmcp/nx:init`. Every executor runs the `frontmcp` CLI in the workspace's `node_modules`, never `npx`, so the workspace needs the `frontmcp` package. Node.js 24 or later.

## Usage

```bash
npx nx g @frontmcp/nx:app tickets
npx nx g @frontmcp/nx:tool search --project=tickets
npx nx g @frontmcp/nx:resource config --project=tickets
npx nx dev tickets
npx nx build tickets
npx nx serve tickets
```

The `app` generator writes a project with `build`, `dev`, `serve`, `test`, `typecheck` and `inspector` targets. No generator adds a class to its app: after `nx g @frontmcp/nx:tool`, list the tool in the app's `@App({ tools })` yourself.

## Generators

| Generator       | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `init`          | Prepare an existing Nx workspace for FrontMCP (dependencies and cacheable executors) |
| `workspace`     | Scaffold a FrontMCP Nx monorepo with `apps/`, `libs/` and `servers/` directories     |
| `app`           | Generate a FrontMCP application in `apps/`                                           |
| `lib`           | Generate a shared library in `libs/`                                                 |
| `server`        | Generate a deployment shell in `servers/`                                            |
| `tool`          | Generate a `@Tool` class                                                             |
| `resource`      | Generate a `@Resource` or `@ResourceTemplate` class                                  |
| `prompt`        | Generate a `@Prompt` class                                                           |
| `skill`         | Generate a `@Skill` class                                                            |
| `skill-dir`     | Generate a skill directory based on a `SKILL.md` file                                |
| `agent`         | Generate an `@Agent` class                                                           |
| `provider`      | Generate a `@Provider` class for dependency injection                                |
| `plugin`        | Generate a `@Plugin` class extending `DynamicPlugin`                                 |
| `adapter`       | Generate an `@Adapter` class extending `DynamicAdapter`                              |
| `auth-provider` | Generate an `@AuthProvider` class                                                    |
| `flow`          | Generate a `@Flow` class extending `FlowBase`                                        |
| `job`           | Generate a `@Job` class                                                              |
| `workflow`      | Generate a `@Workflow` class                                                         |
| `ui-component`  | Add a component to the UI package in `ui/components`                                 |
| `ui-page`       | Add a page to the UI package in `ui/pages`                                           |
| `ui-shell`      | Add a shell template to the UI package in `ui/shells`                                |

Run one with `npx nx g @frontmcp/nx:<generator>`.

## Executors

| Executor     | Runs                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `build`      | `frontmcp build`, for the `target` you set (`node` by default)            |
| `build-exec` | `frontmcp build --target node`                                            |
| `dev`        | `frontmcp dev`, a development server                                      |
| `serve`      | `frontmcp start`, a supervised production server                          |
| `test`       | `frontmcp test`, the end-to-end tests                                     |
| `inspector`  | `frontmcp inspector`, the MCP Inspector                                   |
| `deploy`     | The target platform's CLI, for `node`, `vercel`, `lambda` or `cloudflare` |

Use one in `project.json` as `"executor": "@frontmcp/nx:<executor>"`.

## Docs

- [Nx plugin](https://frontmcp.dev/reference/nx): what it adds, installing it, and the workspace layout
- [Nx generators](https://frontmcp.dev/reference/nx/generators): every generator and its options
- [Nx executors](https://frontmcp.dev/reference/nx/executors): every executor, its options and caching
- [Monorepo patterns](https://frontmcp.dev/reference/nx/monorepo): composing apps into servers and sharing code in libraries

## Related packages

- [`frontmcp`](https://www.npmjs.com/package/frontmcp): the CLI the executors run
- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework the generated code uses
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): the end-to-end tests the `test` executor runs

## Contributing

Source: [`libs/nx-plugin`](https://github.com/agentfront/frontmcp/tree/main/libs/nx-plugin). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
