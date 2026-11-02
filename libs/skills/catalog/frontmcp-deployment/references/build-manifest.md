---
name: build-manifest
description: The frontmcp.manifest.json that frontmcp build writes for every target, its lint, and the instructionsBudget size limits
---

# The Build Manifest and Its Lint

Every `frontmcp build` target writes **`frontmcp.manifest.json`** into its output directory (`dist/<target>/` by
default): the server's tools, resources, resource templates, prompts and skills, with their schemas and the app that
owns each one. The same build lints it: entries without a description, and initialize instructions or tool descriptions
over the server's `instructionsBudget`.

## When to Use This Skill

### Must Use

- Reading or consuming `frontmcp.manifest.json` (docs generation, a registry, a check in CI)
- A build prints `manifest lint (...)` lines, or `--strict-lint` fails it
- A server logs `over the instructionsBudget` at startup

### Recommended

- Keeping instructions and tool descriptions short for clients that copy the instructions into every tool's
  description
- Gating a release on described entries with `frontmcp build --strict-lint`

### Skip When

- Exporting a server's skills to agent folders: see `frontmcp skills export --from-entry` in `frontmcp-setup`
  (`frontmcp-skills-usage`)

> **Decision:** The manifest is written by default. Use `--strict-lint` in CI, `--no-manifest` to skip it.

## What the Build Does

After a target's own build, `frontmcp build` bundles the entry, boots the server in process only to read it, and
writes the manifest. One build of several targets boots it once and writes the same manifest into each output
directory; the `mcpb` target also ships it inside the archive, as `server/frontmcp.manifest.json` next to the server
it describes.

The boot reads the server; it does not run it:

- Nothing serves: no port, no transport, no file log. `FrontMcpInstance.bootstrap()`, `runStdio()` and
  `runUnixSocket()` called while the entry module loads return without serving.
- None of the config's stores is opened: `redis`, `pubsub`, `sqlite` and `jobs.store` are left out, so the build
  connects to no Redis, writes no SQLite file, and a CI machine without them builds the same manifest.
- Providers are built and their `onBootstrap()` runs; `onReady()` never does, so nothing that starts once the server
  serves starts. `onShutdown()` runs when the manifest has been read.
- Your own code still runs: module-level code, provider factories, plugins and adapters that connect while starting
  (an OpenAPI spec fetched from a URL, a remote app's server). A boot that has not finished after 60 s stops the wait:
  `The server did not finish booting within 60 s: ...`.

```bash
frontmcp build --target node              # dist/node/frontmcp.manifest.json, lint printed as warnings
frontmcp build --target node --strict-lint # exit code 1 on any lint finding, or when no manifest can be built
frontmcp build --target node --no-manifest # no manifest, no lint
```

When the manifest cannot be built (the entry fails to boot in Node, an older `@frontmcp/sdk`), the build prints
`frontmcp.manifest.json not written: <reason>` and goes on; with `--strict-lint` that fails the build too.

## What the Manifest Holds

`manifestVersion` is `1`. Every list is sorted (tools and prompts by name, resources by URI, templates by URI template,
skills by path, apps by id), the file has no timestamps, and a skill's `hash` reads its instructions with LF line
endings, so the same source always writes the same file, on any machine, and a diff shows a real change.

| Field               | Content                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`            | `name`, `version`, `title`, and `instructions`: the `initialize` instructions a client with no credentials gets (server instructions, channel hints, the skills line or catalog)                                          |
| `budget`            | The resolved `instructionsBudget` (`{ instructions, toolDescription }`); absent when the budget is off                                                                                                                    |
| `apps`              | `id`, `name`, `description`, `remote: true` for a remote app, `standalone`, the app's `output` policy                                                                                                                     |
| `tools`             | `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `icons`, `_meta`, `tags`, `aliases`, `visibility`, `execution`, `output`, `examples`, `ui: true` for a tool with a widget                   |
| `resources`         | `uri`, `name`, `title`, `description`, `mimeType`, `icons`, `annotations`, `_meta`                                                                                                                                        |
| `resourceTemplates` | `uriTemplate` and the same fields as a resource                                                                                                                                                                           |
| `prompts`           | `name`, `title`, `description`, `arguments`, `icons`                                                                                                                                                                      |
| `skills`            | `name`, `path` (its `skill://` path), `description`, `tags`, `visibility`, `hidden: true`, `tools` (`name`, `purpose`, `required`), `license`, `hash` (`computeSkillHash` of the loaded skill; absent when it can't load) |

Each entry also carries:

- `app`: the id of the app that owns it; absent for the server's own entries and the framework's (the job tools, the
  SEP-2640 `skill://` resources).
- `owner`: the owner path, such as `app:billing` or `app:billing/plugin:cache`, or `scope:root` for the framework's.
- `enabled`: `false` when the entry is off, `'source'` when an `EnabledSource` such as `fileSignal()` decides at run
  time; absent when it is on.
- `availableWhen`: the entry's environment constraint. Entries are listed whatever the build machine is, so a
  `production`-only tool is in a manifest built in development.
- `authorities: true` when the entry declares `authorities` (the policy itself is not copied).

The manifest holds what clients see in `initialize` and the lists, plus app ownership and static switches. It holds no
config values, credentials, or environment variables, and no skill instructions (only their hash). A widget tool's
`_meta.ui` keys are added per client at list time, so the manifest only flags it with `ui: true`.

## The Lint

| Rule                       | Finding                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `missing-description`      | A listed tool, a resource, a resource template, a prompt or a visible skill with no `description` |
| `instructions-over-budget` | `server.instructions` longer than `instructionsBudget.instructions`                               |
| `description-over-budget`  | A listed tool's `description` longer than `instructionsBudget.toolDescription`                    |

Hidden and internal tools are not linted: clients never see them. Each finding prints as
`[build] manifest lint (<rule>): <message>`.

## `instructionsBudget`

Some clients copy a server's `initialize` instructions into the description of every tool, so a long catalog of
skills or instructions multiplies quickly. `instructionsBudget` sets the limits, in characters:

```typescript
@FrontMcp({
  info: { name: 'Billing', version: '1.0.0' },
  apps: [BillingApp],
  instructions: 'Use the billing tools for invoices and refunds.',
  instructionsBudget: { instructions: 600, toolDescription: 800 }, // default: 1024 each
})
export default class Server {}
```

- Over a limit, the server logs a warning at startup (the same message the lint prints), and `frontmcp build` reports
  it.
- `instructionsBudget: false` turns off both; the `missing-description` rule still runs.
- An invalid value (a negative or fractional limit, an unknown key) stops `@FrontMcp` with
  `InvalidDecoratorMetadataError` for `instructionsBudget`.

## Using It from Code

```typescript
import { buildManifest, lintServerManifest, serverManifestSchema } from '@frontmcp/sdk';

import Server from './main';

it('ships described entries within budget', async () => {
  expect(lintServerManifest(await buildManifest(Server))).toEqual([]);
});

// Validate a manifest file read elsewhere
const manifest = serverManifestSchema.parse(JSON.parse(text));
```

`buildManifest(config)` reuses a server `connect()` already serves in the process.

## Common Patterns

| Pattern                    | Correct                                                    | Incorrect                   | Why                                                               |
| -------------------------- | ---------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| Gating descriptions in CI  | `frontmcp build --target node --strict-lint`               | Reading build logs by eye   | `--strict-lint` exits 1 on any finding                            |
| Keeping instructions short | `skillsConfig.injectInstructions: 'compact'` (the default) | `'append'` with many skills | The full catalog counts against `instructionsBudget.instructions` |
| Comparing builds           | Diff `frontmcp.manifest.json` between commits              | Diff the bundles            | The manifest is sorted and has no timestamps                      |
| Reading entries in a tool  | `serverManifestSchema.parse(json)`                         | Casting the JSON            | The schema is versioned with `manifestVersion`                    |

## Verification Checklist

- [ ] `dist/<target>/frontmcp.manifest.json` exists after `frontmcp build`
- [ ] Every tool you expect is listed with its `app`
- [ ] `frontmcp build --strict-lint` exits 0
- [ ] The server logs no `instructionsBudget` warning at startup

## Troubleshooting

| Problem                                   | Cause                                                              | Solution                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `frontmcp.manifest.json not written: ...` | The entry fails to boot in Node at build time, or the SDK is older | Fix the boot error the reason names, upgrade `@frontmcp/sdk`, or build with `--no-manifest` |
| A skill has no `hash`                     | Its instructions could not be loaded at build time                 | Check the `instructions` source (a missing file, an unreachable URL)                        |
| `over the instructionsBudget` at startup  | Instructions or a tool description longer than the limit           | Shorten them, keep `injectInstructions: 'compact'`, or raise `instructionsBudget`           |
| A tool missing from the manifest          | It belongs to a remote app, whose tools are discovered at run time | Expected: remote apps are listed in `apps` with `remote: true`                              |
| `did not finish booting within 60 s`      | A provider, plugin, adapter or remote app waits for a service      | Make it fail fast when the service is unreachable, or build with `--no-manifest`            |

## Reference

- [`build-for-cli`](./build-for-cli.md), [`deploy-to-node`](./deploy-to-node.md): the targets the manifest sits next to
- Related: `frontmcp-setup` → `frontmcp-skills-usage` (`skills export --from-entry`), `frontmcp-config` →
  `configure-skills-http` (`injectInstructions`)
