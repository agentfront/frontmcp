import { buildTargetStatement } from '../../../config/deployment-env';
import { securityHeadersEnvSetupLines } from '../../../config/security-headers-env';
import type { AdapterBuildContext, AdapterTemplate, AdapterName } from '../types';
import { nodeAdapter } from './node';
import { vercelAdapter } from './vercel';
import { lambdaAdapter } from './lambda';
import { cloudflareAdapter } from './cloudflare';
import { distributedAdapter } from './distributed';

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
  distributed: distributedAdapter,
};

export { nodeAdapter, vercelAdapter, lambdaAdapter, cloudflareAdapter, distributedAdapter };

/**
 * The setup module an adapter build emits (`serverless-setup.js`), or `undefined`
 * for an adapter without one. The adapter's own template comes first; the
 * deployment's run-time defaults (`context.runtimeEnv`) and the build target are
 * appended — the setup module still finishes before the user's entry is evaluated (#680).
 */
export function composeAdapterSetup(adapter: AdapterName, context?: AdapterBuildContext): string | undefined {
  const template = ADAPTERS[adapter];
  if (!template.getSetupTemplate) return undefined;
  return (
    template.getSetupTemplate(context) +
    securityHeadersEnvSetupLines(context?.runtimeEnv ?? {}) +
    buildTargetStatement(adapter)
  );
}
