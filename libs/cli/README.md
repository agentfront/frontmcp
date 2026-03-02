# frontmcp

Command-line interface for scaffolding, building, and managing FrontMCP server projects.

[![NPM](https://img.shields.io/npm/v/frontmcp.svg)](https://www.npmjs.com/package/frontmcp)

## Install

```bash
npm install -g frontmcp
# or use directly
npx frontmcp create my-app
```

> Requires Node.js >= 22

## Commands

### Development

| Command                       | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `frontmcp dev`                | Start in development mode (tsx --watch + async type-check) |
| `frontmcp build`              | Compile entry with TypeScript (tsc)                        |
| `frontmcp build --exec`       | Build distributable executable bundle (esbuild)            |
| `frontmcp build --exec --cli` | Generate CLI with subcommands per tool                     |
| `frontmcp test [patterns...]` | Run E2E tests with auto-injected Jest configuration        |
| `frontmcp init`               | Create or fix a tsconfig.json suitable for FrontMCP        |
| `frontmcp doctor`             | Check Node/npm versions and tsconfig requirements          |
| `frontmcp inspector`          | Launch MCP Inspector UI                                    |
| `frontmcp create [name]`      | Scaffold a new FrontMCP project                            |
| `frontmcp socket <entry>`     | Start Unix socket daemon for local MCP server              |

### Process Manager

| Command                            | Description                                                  |
| ---------------------------------- | ------------------------------------------------------------ |
| `frontmcp start <name>`            | Start a named MCP server with supervisor                     |
| `frontmcp stop <name>`             | Stop a managed server (graceful by default)                  |
| `frontmcp restart <name>`          | Restart a managed server                                     |
| `frontmcp status [name]`           | Show process status (detail if name given, table if omitted) |
| `frontmcp list`                    | List all managed processes                                   |
| `frontmcp logs <name>`             | Tail log output for a managed server                         |
| `frontmcp service <action> [name]` | Install/uninstall systemd/launchd service                    |

### Package Manager

| Command                     | Description                                     |
| --------------------------- | ----------------------------------------------- |
| `frontmcp install <source>` | Install an MCP app from npm, local path, or git |
| `frontmcp uninstall <name>` | Remove an installed MCP app                     |
| `frontmcp configure <name>` | Re-run setup questionnaire for an installed app |

## Options Reference

### General

| Flag            | Description   |
| --------------- | ------------- |
| `-V, --version` | Print version |
| `-h, --help`    | Print help    |

### Build

| Flag                   | Description                                                  | Default       |
| ---------------------- | ------------------------------------------------------------ | ------------- |
| `-o, --out-dir <dir>`  | Output directory                                             | `dist`        |
| `-e, --entry <path>`   | Entry file path                                              | auto-detected |
| `-a, --adapter <name>` | Deployment adapter: `node`, `vercel`, `lambda`, `cloudflare` | —             |
| `--exec`               | Build distributable executable bundle (esbuild)              | `false`       |
| `--cli`                | Generate CLI with subcommands per tool (use with `--exec`)   | `false`       |

### Start

| Flag                  | Description                   | Default |
| --------------------- | ----------------------------- | ------- |
| `-e, --entry <path>`  | Entry file for the server     | —       |
| `-p, --port <N>`      | Port number                   | —       |
| `-s, --socket <path>` | Unix socket path              | —       |
| `--db <path>`         | SQLite database path          | —       |
| `--max-restarts <N>`  | Maximum auto-restart attempts | `5`     |

### Stop

| Flag          | Description                             |
| ------------- | --------------------------------------- |
| `-f, --force` | Force kill (SIGKILL instead of SIGTERM) |

### Logs

| Flag              | Description                        | Default |
| ----------------- | ---------------------------------- | ------- |
| `-F, --follow`    | Follow log output (like `tail -f`) | `false` |
| `-n, --lines <N>` | Number of lines to show            | `50`    |

### Socket

| Flag                  | Description                                 | Default                          |
| --------------------- | ------------------------------------------- | -------------------------------- |
| `-s, --socket <path>` | Unix socket path                            | `~/.frontmcp/sockets/{app}.sock` |
| `--db <path>`         | SQLite database path for persistence        | —                                |
| `-b, --background`    | Run as background daemon (detached process) | `false`                          |

### Install

| Flag               | Description                                    |
| ------------------ | ---------------------------------------------- |
| `--registry <url>` | npm registry URL for private packages          |
| `-y, --yes`        | Silent mode (use defaults, skip questionnaire) |
| `-p, --port <N>`   | Override default port                          |

### Create

| Flag                 | Description                                                  | Default  |
| -------------------- | ------------------------------------------------------------ | -------- |
| `-y, --yes`          | Use defaults (non-interactive mode)                          | `false`  |
| `--target <target>`  | Deployment target: `node`, `vercel`, `lambda`, `cloudflare`  | `node`   |
| `--redis <setup>`    | Redis setup: `docker`, `existing`, `none` (node target only) | `docker` |
| `--pm <pm>`          | Package manager: `npm`, `yarn`, `pnpm`                       | detected |
| `--cicd / --no-cicd` | Enable/disable GitHub Actions CI/CD                          | `true`   |
| `--nx`               | Scaffold an Nx monorepo instead of standalone project        | `false`  |

### Test

| Flag                 | Description                                  | Default |
| -------------------- | -------------------------------------------- | ------- |
| `-i, --runInBand`    | Run tests sequentially (recommended for E2E) | `false` |
| `-w, --watch`        | Run tests in watch mode                      | `false` |
| `-v, --verbose`      | Show verbose test output                     | `false` |
| `-t, --timeout <ms>` | Set test timeout                             | `60000` |
| `-c, --coverage`     | Collect test coverage                        | `false` |

## Examples

### Project Scaffolding

```bash
npx frontmcp create                           # Interactive mode
npx frontmcp create my-mcp --yes              # Use defaults
npx frontmcp create my-mcp --target vercel    # Vercel deployment
npx frontmcp create my-mcp --nx --pm yarn     # Nx monorepo with yarn
```

### Development Workflow

```bash
frontmcp dev                        # Start dev server with hot reload
frontmcp build --out-dir build      # Production build
frontmcp test --runInBand           # Run E2E tests sequentially
frontmcp doctor                     # Verify environment setup
frontmcp inspector                  # Launch MCP Inspector UI
```

### Executable Builds

```bash
frontmcp build --exec               # Single-file executable bundle
frontmcp build --exec --cli         # CLI with subcommands per tool
```

### Process Management

```bash
frontmcp start my-app --entry ./src/main.ts --port 3005
frontmcp status                     # Table of all processes
frontmcp status my-app              # Detail for one process
frontmcp logs my-app --follow       # Tail logs
frontmcp restart my-app
frontmcp stop my-app
frontmcp stop my-app --force        # SIGKILL
frontmcp service install my-app     # Install systemd/launchd service
frontmcp service uninstall my-app
```

### Package Management

```bash
frontmcp install @company/my-mcp --registry https://npm.company.com
frontmcp install ./my-local-app     # Install from local path
frontmcp install github:user/repo   # Install from git
frontmcp configure my-app           # Re-run setup questionnaire
frontmcp uninstall my-app
```

### Unix Socket

```bash
frontmcp socket ./src/main.ts --socket /tmp/my-app.sock
frontmcp socket ./src/main.ts --background --db ./data.db
```

## Docs

| Topic                | Link                                |
| -------------------- | ----------------------------------- |
| Installation & setup | [Installation][docs-install]        |
| CLI reference        | [CLI Reference][docs-cli-ref]       |
| Local development    | [Local Dev Server][docs-dev]        |
| Production builds    | [Production Build][docs-production] |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/testing`](../testing) — E2E testing (used by `frontmcp test`)
- [`@frontmcp/uipack`](../uipack) — UI template rendering
- [`@frontmcp/adapters`](../adapters) — framework adapters (Express, Fastify, etc.)

---

## Contributing

### Architecture

```text
libs/cli/src/
├── core/               # CLI entry, program factory, args, help, bridge
│   ├── cli.ts          # Entry point (bin)
│   ├── program.ts      # Commander program factory
│   ├── bridge.ts       # Commander options → ParsedArgs adapter
│   ├── args.ts         # ParsedArgs type definitions
│   └── help.ts         # Custom grouped help formatter
├── commands/
│   ├── build/          # build, build --exec, build --exec --cli
│   ├── dev/            # dev, test, init, doctor, inspector
│   ├── pm/             # start, stop, restart, status, list, logs, service, socket
│   ├── package/        # install, uninstall, configure
│   └── scaffold/       # create
├── shared/             # env loading, fs utils, prompts
└── index.ts            # Public API exports
```

Each command group has a `register.ts` that defines commands, flags, and descriptions using the Commander API. The `bridge.ts` module converts Commander's parsed options into the `ParsedArgs` shape used by handlers.

### Adding a New Command

1. Create the handler in the appropriate `commands/<group>/` directory
2. Add registration in `commands/<group>/register.ts`:
   ```typescript
   program
     .command('my-command')
     .description('What it does')
     .option('-f, --flag <value>', 'Description')
     .action(async (options) => {
       const { runMyCommand } = await import('./my-command.js');
       await runMyCommand(toParsedArgs('my-command', [], options));
     });
   ```
3. The bridge in `core/bridge.ts` maps Commander options to `ParsedArgs` — add any new flags there
4. Add the command name to the appropriate group in `core/help.ts`

### Testing

```bash
nx test cli              # Unit tests
nx run cli:test:e2e      # E2E tests
```

### Build

```bash
nx build cli
```

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-install]: https://docs.agentfront.dev/frontmcp/getting-started/installation
[docs-cli-ref]: https://docs.agentfront.dev/frontmcp/getting-started/cli-reference
[docs-dev]: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server
[docs-production]: https://docs.agentfront.dev/frontmcp/deployment/production-build
