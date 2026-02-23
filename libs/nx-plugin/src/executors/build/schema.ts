export interface BuildExecutorSchema {
  entry?: string;
  outputPath?: string;
  adapter?: 'node' | 'vercel' | 'lambda' | 'cloudflare';
}
