import { AdapterTemplate, AdapterName } from '../types';
import { nodeAdapter } from './node';
import { vercelAdapter } from './vercel';
import { lambdaAdapter } from './lambda';
import { cloudflareAdapter } from './cloudflare';

/**
 * Registry of all available deployment adapters.
 * Each adapter configures how the FrontMCP server is compiled and packaged
 * for a specific deployment target.
 */
export const ADAPTERS: Record<AdapterName, AdapterTemplate> = {
  node: nodeAdapter,
  vercel: vercelAdapter,
  lambda: lambdaAdapter,
  cloudflare: cloudflareAdapter,
};

export { nodeAdapter, vercelAdapter, lambdaAdapter, cloudflareAdapter };
