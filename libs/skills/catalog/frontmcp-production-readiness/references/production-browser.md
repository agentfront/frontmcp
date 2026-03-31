---
name: production-browser
description: Checklist for publishing FrontMCP as a browser-compatible SDK bundle
---

# Production Readiness: Browser SDK

Target-specific checklist for publishing FrontMCP as a browser-compatible SDK.

> Run the `common-checklist` first, then use this checklist for browser-specific items.

## Build

- [ ] `frontmcp build --target browser` produces a correct ESM/UMD bundle
- [ ] Bundle size is acceptable (check with `npx bundlesize` or similar)
- [ ] Tree-shaking works (no unnecessary code in final bundle)
- [ ] Source maps are generated for debugging (but not shipped to production CDN)

## Browser Compatibility

- [ ] No Node.js-only APIs (`fs`, `path`, `child_process`, `net`, `crypto`)
- [ ] All crypto uses `@frontmcp/utils` (wraps Web Crypto API)
- [ ] All file operations removed or polyfilled
- [ ] Fetch API used instead of Node http/https modules
- [ ] Works in major browsers (Chrome, Firefox, Safari, Edge)

## Security

- [ ] No secrets bundled in the client-side code
- [ ] API keys are NOT in the browser bundle (use server-side proxy)
- [ ] CORS is configured on the server to accept browser origins
- [ ] Content Security Policy (CSP) headers are compatible

## Distribution

- [ ] Package exports both ESM and CJS: `"module"` and `"main"` in package.json
- [ ] `"browser"` field in package.json points to the browser build
- [ ] TypeScript declarations (`.d.ts`) are included
- [ ] CDN-friendly: works via `<script>` tag or `import` from CDN

## Performance

- [ ] Bundle is minified for production
- [ ] Code splitting is used for large optional features
- [ ] No synchronous operations that block the main thread
- [ ] WebSocket/SSE connections handle reconnection gracefully

## Examples

| Example                                                                                  | Level        | Description                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`browser-bundle-config`](../examples/production-browser/browser-bundle-config.md)       | Basic        | Shows how to configure package.json for browser-compatible SDK distribution with ESM/CJS/UMD entry points, TypeScript declarations, and CDN support.       |
| [`cross-platform-crypto`](../examples/production-browser/cross-platform-crypto.md)       | Intermediate | Shows how to use `@frontmcp/utils` for cross-platform crypto operations that work in both browser and Node.js, and how to avoid Node.js-only APIs.         |
| [`security-and-performance`](../examples/production-browser/security-and-performance.md) | Advanced     | Shows how to ensure no secrets are bundled in browser code, configure CSP headers on the server, optimize bundle size, and avoid blocking the main thread. |

> See all examples in [`examples/production-browser/`](../examples/production-browser/)
