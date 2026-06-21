// Empty-module stub for Node-only optional deps (e.g. @anthropic-ai/sdk) that
// the managed edge graph references behind lazy `import()` but NEVER executes on
// a Worker. Aliasing them here keeps their Node-only module-eval (`require('fs')`
// / child_process) out of the bundle while staying resolvable by miniflare —
// unlike `external`, which leaves an unresolvable runtime specifier.
export default {};
