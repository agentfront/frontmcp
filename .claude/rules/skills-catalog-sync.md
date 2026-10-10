# Rule: Skills catalog stays in sync with behavior

When a fix or change alters what users rely on (a public API, option, default,
error code or message, CLI flag or output), the corresponding entries under
`libs/skills/catalog/**` MUST be updated in the same change.

The catalog is the documentation that ships with FrontMCP — divergence means
that users who run `frontmcp skills install <name>` ship code based on stale
guidance. FrontMCP's docs site, https://frontmcp.dev, lives in a separate
repository and is updated for each release from the PRs' "User-facing change"
sections, so fill that section in too.

## How to apply

1. For every behavior change, search the catalog for matching topics:

   ```bash
   grep -rln "<keyword from the change>" libs/skills/catalog
   ```

2. Update the matching `SKILL.md` files, any `references/*.md`, and any
   `examples/*.md` so they describe the new behaviour, option, contract,
   error shape, or migration note.

3. Catalog directory ↔ theme mapping (rough guide; verify by reading
   `libs/skills/catalog/skills-manifest.json`):

   | Catalog dir                     | Typical themes                                  |
   | ------------------------------- | ----------------------------------------------- |
   | `frontmcp-setup`                | install / project bootstrap                     |
   | `frontmcp-deployment`           | transport security, body limits, hosts, ports   |
   | `frontmcp-development`          | decorators, contexts, tools, prompts, resources |
   | `frontmcp-config`               | `frontmcp.config.*`, schemas                    |
   | `frontmcp-observability`        | logging, metrics, health, telemetry             |
   | `frontmcp-testing`              | `frontmcp test`, jest config, fixtures          |
   | `frontmcp-channels`             | streaming, SSE, transports                      |
   | `frontmcp-authorities`          | auth, vault, CIMD, sessions                     |
   | `frontmcp-extensibility`        | plugin authoring, providers, hooks              |
   | `frontmcp-production-readiness` | release / production hardening checklists       |
   | `frontmcp-guides`               | high-level walkthroughs                         |

4. Treat catalog edits as in-scope for the same PR — do NOT defer to a
   follow-up.

5. After editing, where applicable run `nx test skills` (or otherwise
   confirm `skills-manifest.json` is still consistent with the catalog
   tree).

## Why

The skill catalog is shipped through `@frontmcp/skills` and consumed by
agents via `frontmcp skills install`. The user has surfaced this as a
non-negotiable expectation — losing sync between behavior and the catalog
breaks user trust and ships agents with outdated playbooks.
