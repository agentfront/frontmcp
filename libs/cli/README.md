# @frontmcp/cli

The FrontMCP command-line interface for scaffolding and managing MCP server projects.

## Installation

```bash
npm install -g frontmcp
```

Or use directly with npx:

```bash
npx frontmcp create my-app
```

## Commands

### `frontmcp create [project-name]`

Scaffolds a new FrontMCP project with interactive prompts or default options.

**Interactive Mode:**

```bash
npx frontmcp create my-app
# Prompts for: deployment target, Redis setup, GitHub Actions
```

**Non-Interactive Mode:**

```bash
npx frontmcp create my-app --yes
# Uses defaults: node target, docker Redis, GitHub Actions enabled
```

**CLI Flags:**
| Flag | Description | Default |
|------|-------------|---------|
| `--yes`, `-y` | Skip prompts, use defaults | `false` |
| `--target <type>` | Deployment target: `node`, `vercel`, `lambda`, `cloudflare` | `node` |
| `--redis <type>` | Redis setup: `docker`, `upstash`, `none` | `docker` |
| `--cicd` / `--no-cicd` | Enable/disable GitHub Actions | `true` |

### Other Commands

- `frontmcp init` - Initialize FrontMCP in an existing project
- `frontmcp dev` - Start development server with hot reload
- `frontmcp build` - Build for production
- `frontmcp inspector` - Launch MCP Inspector UI
- `frontmcp doctor` - Check environment and configuration

---

## Development

### Running Unit Tests

The CLI package uses Jest for unit testing:

```bash
# Run all CLI tests
npx nx test cli

# Run with coverage
npx nx test cli --coverage

# Run in watch mode
npx nx test cli --watch
```

**Test files location:**

- `libs/cli/src/__tests__/` - General CLI tests (argument parsing)
- `libs/cli/src/commands/__tests__/` - Command-specific tests

### Running E2E Tests with Verdaccio

The CLI includes end-to-end tests that use [Verdaccio](https://verdaccio.org/) as a local npm registry. This allows testing the full `npx frontmcp create` flow as users would experience it.

#### How It Works

1. **Starts a local Verdaccio registry** on port 4873
2. **Builds all @frontmcp packages** (sdk, adapters, plugins, testing, cli)
3. **Publishes packages to the local registry** (not to npm)
4. **Runs E2E test scenarios** using `npx --registry` pointed at Verdaccio
5. **Cleans up** the registry and temp directories

#### Running E2E Tests

```bash
# Run E2E tests (requires Verdaccio installed globally or will install it)
npx nx test:e2e cli
```

#### What Gets Tested

The E2E script (`libs/cli/e2e/run-e2e.sh`) runs through these scenarios:

| Test              | Command                                              | Verifies                                         |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Docker target     | `frontmcp create test-app --yes`                     | `ci/Dockerfile`, `ci/docker-compose.yml` created |
| Vercel target     | `frontmcp create test-app --yes --target vercel`     | `vercel.json` created                            |
| Lambda target     | `frontmcp create test-app --yes --target lambda`     | `ci/template.yaml` created                       |
| Cloudflare target | `frontmcp create test-app --yes --target cloudflare` | `wrangler.toml` created                          |
| No CI/CD          | `frontmcp create test-app --yes --no-cicd`           | `.github/` directory NOT created                 |
| No Redis          | `frontmcp create test-app --yes --redis none`        | `docker-compose.yml` has no Redis service        |
| Dependencies      | `npm install` in created project                     | All dependencies install successfully            |

#### Verdaccio Configuration

The Verdaccio config (`libs/cli/e2e/verdaccio.config.yaml`) is set up to:

- **Proxy to npm** for all packages except `@frontmcp/*` and `frontmcp`
- **Allow local publishing** without authentication for testing
- **Use ephemeral storage** (cleaned up after tests)

```yaml
packages:
  '@frontmcp/*':
    access: $all
    publish: $all
  'frontmcp':
    access: $all
    publish: $all
  '**':
    access: $all
    proxy: npmjs # Falls back to real npm registry
```

#### Debugging E2E Tests

If E2E tests fail, you can run Verdaccio manually to inspect:

```bash
# Start Verdaccio with the test config
cd libs/cli/e2e
verdaccio --config verdaccio.config.yaml --listen 4873

# In another terminal, publish packages manually
cd libs/cli/dist
npm publish --registry http://localhost:4873

# Test the create command
npx --registry http://localhost:4873 frontmcp create test-app --yes
```

#### Prerequisites

- **Node.js 22+**
- **Verdaccio** (installed automatically if not present)
- All packages must build successfully before E2E tests run

---

## Project Structure

```
libs/cli/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── args.ts             # Argument parsing
│   ├── commands/
│   │   ├── create.ts       # Create command implementation
│   │   ├── init.ts         # Init command
│   │   ├── dev.ts          # Dev server command
│   │   ├── build/          # Build command
│   │   └── __tests__/      # Command tests
│   ├── templates/          # Project templates
│   └── __tests__/          # General tests
├── e2e/
│   ├── run-e2e.sh          # E2E test script
│   └── verdaccio.config.yaml
├── jest.config.ts          # Jest configuration
└── project.json            # Nx project configuration
```

## License

See [LICENSE](../../LICENSE).
