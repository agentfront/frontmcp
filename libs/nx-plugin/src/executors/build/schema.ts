export interface BuildExecutorSchema {
  entry?: string;
  outputPath?: string;
  target?: 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'distributed' | 'cli' | 'sdk' | 'browser' | 'mcpb';
  /** @deprecated Use `target`. */
  adapter?: 'node' | 'vercel' | 'lambda' | 'cloudflare';
}
