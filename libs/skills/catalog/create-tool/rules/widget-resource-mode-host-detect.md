---
name: widget-resource-mode-host-detect
constraint: 'Leave `ui.resourceMode` unset — the framework host-detects (`inline` for Claude, `cdn` for others).'
severity: recommended
---

# Rule: leave `ui.resourceMode` unset by default

## The rule

`ui.resourceMode` defaults to a host-detected value (issue #456): `'inline'` for Claude (React bundled into the widget so it renders under Claude's sandbox CSP), `'cdn'` for OpenAI / ChatGPT / Cursor / MCP Inspector (smaller payload from esm.sh). Leave the field unset unless you have a specific reason to override.

## Good

```typescript
@Tool({
  // …
  ui: {
    template: { file: widgetPath },
    // resourceMode intentionally UNSET — framework picks per host
  },
})
```

## Bad (without justification)

```typescript
// ❌ pinning to 'cdn' — breaks Claude (widget hangs on "Loading widget…")
ui: { template: { file: widgetPath }, resourceMode: 'cdn' }

// ❌ pinning to 'inline' — fine for Claude, but always-larger payload for OpenAI / ChatGPT
ui: { template: { file: widgetPath }, resourceMode: 'inline' }
```

## When to override (with justification)

- **Force `'inline'`** when the widget must work in a network-blocked environment beyond Claude (some kiosks, air-gapped demos, etc.). Pay the larger payload cost intentionally.
- **Force `'cdn'`** when you specifically know the widget will only be served to CDN-permissive clients AND you want minimum payload. Rare — usually the framework's choice is correct.
- **Set per call** at the tool layer is the wrong place — `resourceMode` is part of static widget compilation. Per-call decisions belong in `servingMode` instead.

## Why

- **Claude's iframe blocks external scripts.** Default `'cdn'` emits an esm.sh import map for React; Claude's CSP blocks it; the widget hangs forever on the FrontMCP "Loading widget…" placeholder. `'inline'` bundles React into the widget's `<script type="module">`.
- **OpenAI / ChatGPT / Cursor are CDN-permissive.** `'cdn'` is smaller (no inlined React) — better cold-render performance.
- **The host can be detected at per-call render time.** `renderToolTemplate` reads `platformType` from the request and picks the right mode automatically. Per-tool overrides defeat the detection.

## Static-mode caveat

For `servingMode: 'static'` tools (pre-compiled at server startup, before any client connects), there's no platformType to detect against. Static widgets default to `'cdn'` regardless. If a static-mode tool needs to render in Claude, set `resourceMode: 'inline'` explicitly.

## Verification

```bash
# Find ui blocks with explicit resourceMode — review each for justification
grep -rE "resourceMode:\s*'(cdn|inline)'" src/**/*.tool.ts
```

## See also

- [`references/ui-widgets.md`](../references/ui-widgets.md)
- [`examples/23-tool-with-ui-filesource-tsx`](../examples/23-tool-with-ui-filesource-tsx.md)
