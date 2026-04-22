// common/types/options/cloud/index.ts
// Barrel export for cloud (Frontegg) integration options

export type { CloudOptions, CloudApprovalsOptions } from './interfaces';
export { cloudOptionsSchema, cloudApprovalsOptionsSchema } from './schema';
export type { CloudOptionsInput } from './schema';

export type {
  CloudProvider,
  CloudContributions,
  CloudOptionOverride,
  CloudBootstrapContext,
  CloudRuntimeContext,
  FieldMergeStrategy,
} from './provider';

export { mergeCloudContributions } from './merge';

export { CloudRuntimeContextToken, InMemoryCloudRuntimeContext } from './runtime-context';
