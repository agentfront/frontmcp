import { AdapterTemplate } from '../types';

/**
 * Node.js adapter - default deployment target.
 * Compiles to CommonJS for direct Node.js execution.
 * No wrapper needed - the compiled main.js runs directly.
 */
export const nodeAdapter: AdapterTemplate = {
  moduleFormat: 'commonjs',
  getEntryTemplate: () => '', // No wrapper needed for node
};
