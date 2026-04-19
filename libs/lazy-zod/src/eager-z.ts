/**
 * Escape hatch — straight pass-through to real zod. Zero proxy overhead,
 * eager construction. Use when you need a schema fully built at module
 * load (e.g. a library will immediately introspect it) or for hot paths
 * that don't care about cold-start.
 */
export { z as eagerZ } from 'zod';
