---
name: widget-paths-anchor-with-import-meta-url
constraint: '`.tsx` widget paths in `ui.template: { file }` are anchored via `fileURLToPath(new URL(...))`, never bare relative.'
severity: required
---

# Rule: anchor widget paths with `import.meta.url`

## The rule

Relative `FileSource` paths in `ui.template: { file }` resolve against `process.cwd()` — **not** the tool source's directory (issue #444). A bare relative path silently breaks the moment the server is launched from a different working directory. Always anchor the path to the tool source.

## Good

```typescript
import { fileURLToPath } from 'node:url';

const widgetPath = fileURLToPath(new URL('./sales-chart.widget.tsx', import.meta.url));

@Tool({
  name: 'sales_chart',
  // …
  ui: { template: { file: widgetPath } },
})
```

## Bad

```typescript
// ❌ bare relative path — resolves against process.cwd()
@Tool({
  name: 'sales_chart',
  ui: { template: { file: './sales-chart.widget.tsx' } },
})
// → works locally when running from src/apps/main/tools/
// → fails with ENOENT when running from the repo root, from dist/, etc.
```

## Why

- **`process.cwd()` is whoever launched the process.** `yarn dev` from the repo root, `node dist/main.js` from `/opt/app`, a containerized run from `/`, a serverless cold start from `/var/task`, an Nx executor from `apps/<thing>/` — all different cwds.
- **Tool sources move around at build time.** ESM build output is often in `dist/`; `.tool.ts` becomes `.tool.js`. The relative reference's resolution chain is fragile to that.
- **`fileURLToPath(new URL('./x', import.meta.url))` is invariant.** It anchors to the **source file** that contains the URL literal — same answer at dev, build, and runtime.

## Also: name the widget `*.widget.tsx`

The scaffolded `tsconfig.json` excludes `**/*.widget.tsx` from the server typecheck (issue #445). Naming widgets `sales-chart.widget.tsx` keeps server `tsc --noEmit` happy without dragging React types into the server config.

## Verification

```bash
# Find any bare-relative `file:` literals in ui templates — should return 0 hits
grep -rE "file:\s*'\.\.?/[^']*\.tsx'" src/**/*.tool.ts
```

## See also

- [`references/ui-widgets.md`](../references/ui-widgets.md)
- [`examples/23-tool-with-ui-filesource-tsx`](../examples/23-tool-with-ui-filesource-tsx.md)
