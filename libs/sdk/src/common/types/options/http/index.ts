// common/types/options/http/index.ts
// Barrel export for HTTP options

export type { HttpOptionsInterface } from './interfaces';
export { httpOptionsSchema } from './schema';
export type { HttpOptions, HttpOptionsInput } from './schema';

// Re-export with backwards-compatible alias
export type { HttpOptions as HttpConfig } from './schema';
