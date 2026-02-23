// Generators
export { workspaceGenerator } from './generators/workspace/workspace.js';
export { appGenerator } from './generators/app/app.js';
export { libGenerator } from './generators/lib/lib.js';
export { serverGenerator } from './generators/server/server.js';
export { toolGenerator } from './generators/tool/tool.js';
export { resourceGenerator } from './generators/resource/resource.js';
export { promptGenerator } from './generators/prompt/prompt.js';
export { skillGenerator } from './generators/skill/skill.js';
export { agentGenerator } from './generators/agent/agent.js';
export { providerGenerator } from './generators/provider/provider.js';
export { pluginGenerator } from './generators/plugin/plugin.js';
export { adapterGenerator } from './generators/adapter/adapter.js';
export { authProviderGenerator } from './generators/auth-provider/auth-provider.js';
export { flowGenerator } from './generators/flow/flow.js';

// Utilities
export {
  getFrontmcpVersion,
  getFrontmcpDependencies,
  getFrontmcpDevDependencies,
  getNxDependencies,
} from './utils/versions.js';
export { toClassName, toPropertyName, toFileName, toConstantName } from './utils/names.js';
