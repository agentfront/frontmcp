# Rule: Skills catalog stays in sync with docs

When a fix or change touches **`docs/frontmcp/**`**, the corresponding entries
under **`libs/skills/catalog/**`** MUST be updated in the same change.

The catalog is the installable form of the docs — divergence means that users
who run `frontmcp skills install <name>` ship code based on stale guidance
while the Mintlify site (https://docs.agentfront.dev/frontmcp) shows the new
behaviour. Keeping both surfaces aligned in one PR is a non-negotiable part
of the change.

## How to apply

1. For every edit to a page under `docs/frontmcp/**`, search the catalog for
   matching topics:

   ```bash
   grep -rln "<keyword from the doc change>" libs/skills/catalog
   ```

2. Update the matching `SKILL.md` files, any `references/*.md`, and any
   `examples/*.md` so they describe the new behaviour, option, contract,
   error shape, or migration note that the docs now describe.

3. Catalog directory ↔ doc-theme mapping (rough guide; verify by reading
   `libs/skills/catalog/skills-manifest.json`):

   | Catalog dir                     | Typical docs themes                             |
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
non-negotiable expectation — losing sync between docs and the catalog
breaks user trust and ships agents with outdated playbooks.
