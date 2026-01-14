import { AdapterTemplate, AdapterName } from '../types.js';
import { nodeAdapter } from './node.js';
import { vercelAdapter } from './vercel.js';
import { lambdaAdapter } from './lambda.js';
import { cloudflareAdapter } from './cloudflare.js';

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
