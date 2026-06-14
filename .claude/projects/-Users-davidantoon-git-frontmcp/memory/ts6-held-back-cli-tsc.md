---
name: ts6-held-back-cli-tsc
description: Why TypeScript 6.0 was held back during the June 2026 dep upgrade — it breaks the shipped frontmcp build CLI
metadata:
  type: project
---

TypeScript 6.0 **builds every library cleanly** in this repo once zod is deduped
(see [[dep-bump-duplication-gotcha]]) and `tsconfig.base.json` adds
`"ignoreDeprecations": "6.0"` for its `baseUrl`. It was still **held back** (kept
at ~5.9.x) because TS 6.0 breaks the shipped `frontmcp build` CLI: the bundler
invokes `npx -y tsc <files>` in several places (`libs/cli/src/commands/build/{exec,mcpb,sdk}/index.ts`,
`dev/dev.ts`), and TS 6.0's new `TS5112` rejects passing explicit files while a
`tsconfig.json` is present ("use --ignoreConfig"). `--ignoreConfig` only exists
in TS ≥6, so the fix needs tsc-version detection in product code for users still
on TS 5.x — a dedicated, backward-compat-sensitive migration, not a drive-by bump.

Still held back, each for a specific reason:
- **webpack-cli** (kept ^5): v7 removed `--node-env` (used in `apps/demo/project.json`).
- **@rspack/core** (kept ^1): `libs/cli` pins 1.x; rspack 2 in the bundler is untested.
- **@types/node** (kept ^24): match the `node>=24` engine, not node 25 types.

Subsequently **landed** (were held back at first, then migrated):
- **@mui/material 7 → 9**: moved Typography system props (`fontWeight`/`paragraph`/
  `textAlign`) into `sx` in `libs/ui/src/renderer/{charts,flow,maps,mdx}`; `body1`
  already maps to `<p>` so no `component` needed; widened `libs/ui` peer to
  `^7.0.0 || ^8.0.0 || ^9.0.0`.
- **OpenTelemetry SDK 1.x → 2.x** (`sdk-trace-base`/`resources`/`core` 2.8.0,
  `sdk-node`/`exporter-trace-otlp-http` 0.219): `new Resource()` →
  `resourceFromAttributes()`; `BasicTracerProvider` `addSpanProcessor()` →
  constructor `{ spanProcessors: [...] }`; `provider.register()` →
  `trace.setGlobalTracerProvider()`; `ReadableSpan.parentSpanId` →
  `parentSpanContext?.spanId` (all in `libs/observability`).
