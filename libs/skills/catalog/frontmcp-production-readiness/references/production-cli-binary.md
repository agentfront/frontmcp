---
name: production-cli-binary
description: Checklist for publishing FrontMCP as a one-shot CLI binary with stdin/stdout transport
---

# Production Readiness: CLI Binary (One-Shot Execution)

Checklist for publishing FrontMCP as a one-shot CLI binary — runs a command, processes input, exits. Not a long-running server.

> Run the `common-checklist` first, then use this checklist for binary-specific items.

## Build

- [ ] `frontmcp build --target cli` produces a working binary
- [ ] Binary starts and responds to `--help` within 500ms
- [ ] `package.json` has correct `bin` field pointing to the built output
- [ ] Shebang line is correct: `#!/usr/bin/env node`
- [ ] Binary file has execute permissions (`chmod +x`)

## Startup Performance

- [ ] Cold start time is under 1 second
- [ ] No heavy initialization at module scope (lazy-load dependencies)
- [ ] No network calls during startup (model downloads, API fetches)
- [ ] No async initialization that blocks first output

## stdin/stdout Transport

- [ ] MCP stdio transport works: reads JSON-RPC from stdin, writes to stdout
- [ ] stderr is used for logging (not stdout — that's the MCP channel)
- [ ] Handles EOF on stdin gracefully (clean exit)
- [ ] Handles broken pipe on stdout gracefully (no crash)

## Exit Behavior

- [ ] Exit code 0 on success
- [ ] Exit code 1 on user error (bad input, missing args)
- [ ] Exit code 2 on internal error
- [ ] No hanging — process exits promptly after work is done
- [ ] All async operations complete before exit (no dangling promises)

## npm Distribution

- [ ] Package name is available on npm
- [ ] `package.json` has `name`, `version`, `description`, `keywords`, `license`
- [ ] `files` field includes only: `dist/`, `README.md`, `LICENSE`
- [ ] `.npmignore` or `files` excludes: `src/`, `e2e/`, `.env`, `coverage/`
- [ ] `README.md` has: `npm install -g <name>` and usage examples

## Error Messages

- [ ] User errors show helpful messages (not stack traces)
- [ ] `--version` flag works correctly
- [ ] Unknown flags produce a helpful error
- [ ] Missing required arguments show usage hint

## Security

- [ ] No secrets bundled in the binary
- [ ] No secrets logged to stderr
- [ ] No hardcoded paths (use `os.homedir()`, `os.tmpdir()`)
- [ ] No writes to unexpected locations
