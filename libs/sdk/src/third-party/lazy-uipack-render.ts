// The `require` variant of `#uipack-render`: @frontmcp/uipack loads the first time an auth-UI page is built.
Object.defineProperties(exports, {
  createResolverWithOverrides: { enumerable: true, get: () => require('@frontmcp/uipack').createResolverWithOverrides },
  renderComponent: { enumerable: true, get: () => require('@frontmcp/uipack').renderComponent },
});
