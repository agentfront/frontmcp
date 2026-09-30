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
- **`fileURLToPath(new URL('./x', import.meta.url))` is independent of cwd.** It anchors to the file that contains the URL literal — the source file under `frontmcp dev`, the **compiled** file once the tool is built. That's why the widget must ship with the build (below).

## CommonJS projects (`__dirname`)

`import.meta.url` is **ESM-only**. In a CommonJS project (`package.json` `"type": "commonjs"`, or `tsconfig` `"module": "commonjs"`) `import.meta` is unavailable and the build fails. Anchor with `__dirname` instead — the CJS equivalent, equally independent of `process.cwd()`:

```typescript
import { join } from 'node:path';

const widgetPath = join(__dirname, 'sales-chart.widget.tsx');

@Tool({
  name: 'sales_chart',
  ui: { template: { file: widgetPath } },
})
```

Pick the anchor that matches your module system — both resolve to the directory of the file that is running, regardless of cwd. The rule is only that the path must **never** be a bare relative string.

## Ship the widget with the build (#649)

The widget is read when the tool is called, from the path the **compiled** tool computes, so after a build it has to exist in the output — tsc never emits `*.widget.tsx`:

- `frontmcp build` copies every `*.widget.tsx` / `*.widget.jsx` under the entry's directory. tsc-output targets get them next to each compiled tool (same relative path). Bundled targets (`node`, `cli`, `lambda`, `vercel`) get them directly next to the bundle, because every bundled module's `__dirname` is the bundle's directory — so keep each widget beside the tool that uses it and give it a unique file name.
- A plain `tsc` build copies nothing — add a copy step, or the call fails with an `ENOENT` error that names the path it looked for.

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
