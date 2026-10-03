// Nothing FrontMCP-specific: no aliases, no Node polyfills, no `define` for `process` (#681).
// published-packages.pw.spec.ts copies this app into a project whose node_modules link each
// @frontmcp package to its built `dist`, the layout `npm install` produces.
export default {
  logLevel: 'error',
  build: { target: 'es2022', emptyOutDir: true },
};
