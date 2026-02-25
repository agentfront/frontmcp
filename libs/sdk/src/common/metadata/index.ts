// Re-export DI metadata types for backwards compatibility
// ProviderScope is an enum (has runtime value), ProviderMetadata is type-only
export { ProviderScope } from '@frontmcp/di';
export type { ProviderMetadata } from '@frontmcp/di';

export * from './front-mcp.metadata';
export * from './flow.metadata';
export * from './hook.metadata';
export * from './app.metadata';
export * from './provider.metadata';
export * from './auth-provider.metadata';
export * from './adapter.metadata';
export * from './plugin.metadata';
export * from './tool.metadata';
export * from './tool-ui.metadata';
export * from './resource.metadata';
export * from './prompt.metadata';
export * from './logger.metadata';
export * from './agent.metadata';
export * from './skill.metadata';
export * from './job.metadata';
export * from './workflow.metadata';
