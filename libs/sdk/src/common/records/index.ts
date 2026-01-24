// Re-export DI provider record types for backwards compatibility
// ProviderKind is an enum (has runtime value), types are type-only
export { ProviderKind } from '@frontmcp/di';
export type {
  ProviderRecord,
  ProviderClassTokenRecord,
  ProviderClassRecord,
  ProviderValueRecord,
  ProviderFactoryRecord,
  ProviderInjectedRecord,
} from '@frontmcp/di';

export * from './scope.record';
export * from './flow.record';
export * from './hook.record';
export * from './app.record';
export * from './provider.record';
export * from './auth-provider.record';
export * from './plugin.record';
export * from './adapter.record';

export * from './tool.record';
export * from './resource.record';
export * from './prompt.record';
export * from './logger.record';
export * from './agent.record';
export * from './skill.record';
