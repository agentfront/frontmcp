import { type Type } from '@frontmcp/di';
import { z } from '@frontmcp/lazy-zod';

import { isPackageSpecifier } from '../../esm-loader/package-specifier';
import type { AgentType } from '../interfaces';
import {
  frontMcpAdapterMetadataSchema,
  frontMcpAuthProviderMetadataSchema,
  frontMcpPluginMetadataSchema,
  frontMcpProviderMetadataSchema,
  frontMcpRemoteAppMetadataSchema,
} from '../metadata';
import type {
  JobEsmTargetRecord,
  JobRemoteRecord,
  PromptEsmTargetRecord,
  PromptRemoteRecord,
  ResourceEsmTargetRecord,
  ResourceRemoteRecord,
  SkillEsmTargetRecord,
  SkillRemoteRecord,
  ToolEsmTargetRecord,
  ToolRemoteRecord,
} from '../records';
import {
  FrontMcpAdapterTokens,
  FrontMcpAgentTokens,
  FrontMcpAuthProviderTokens,
  FrontMcpChannelTokens,
  FrontMcpJobTokens,
  FrontMcpLocalAppTokens,
  FrontMcpLogTransportTokens,
  FrontMcpPluginTokens,
  FrontMcpPromptTokens,
  FrontMcpProviderTokens,
  FrontMcpResourceTemplateTokens,
  FrontMcpResourceTokens,
  FrontMcpSkillTokens,
  FrontMcpToolTokens,
  FrontMcpWorkflowTokens,
} from '../tokens';
import { isExternalEntryRecord } from '../utils/external-entry.utils';

/**
 * Check if an object has metadata for a given token, handling both Symbol() and Symbol.for()
 * tokens. This is needed because plugins built with older versions of @frontmcp/di used
 * Symbol() (non-shared) tokens, while newer versions use Symbol.for() (shared) tokens.
 */
function hasMetadataCompat(token: symbol, target: object): boolean {
  // Fast path: direct match (same Symbol instance)
  if (Reflect.hasMetadata(token, target)) return true;
  // Slow path: match by description (handles Symbol() vs Symbol.for() mismatch)
  const desc = token.description;
  if (!desc) return false;
  return Reflect.getMetadataKeys(target).some((k) => typeof k === 'symbol' && k.description === desc);
}

/** A class reference; declared in this package so published declarations name it from here, not from a monorepo path. */
export interface AnnotatedClass extends Type {}

export const annotatedFrontMcpAppSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    // Check for class-based @App() decorator
    if (typeof v === 'function' && hasMetadataCompat(FrontMcpLocalAppTokens.type, v)) {
      return true;
    }
    // Check for remote app configuration object
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      // Remote app configs have urlType and url properties
      if (typeof obj['urlType'] === 'string' && typeof obj['url'] === 'string' && typeof obj['name'] === 'string') {
        // Validate against remote app schema
        return frontMcpRemoteAppMetadataSchema.passthrough().safeParse(v).success;
      }
    }
    return false;
  },
  { message: 'apps items must be annotated with @App() | @FrontMcpApp() or be a valid remote app configuration.' },
);

export const annotatedFrontMcpProvidersSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function' && hasMetadataCompat(FrontMcpProviderTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && hasMetadataCompat(FrontMcpProviderTokens.type, ctor as object)) {
          return true;
        }
      }
      const definesProvider =
        'useValue' in obj || typeof obj['useClass'] === 'function' || typeof obj['useFactory'] === 'function';
      if (definesProvider && frontMcpProviderMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
    }
    return false;
  },
  {
    message:
      'providers items must be classes annotated with @Provider() | @FrontMcpProvider(), ' +
      'or { provide, name, useValue | useClass | useFactory } objects.',
  },
);

export const annotatedFrontMcpAuthProvidersSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function' && hasMetadataCompat(FrontMcpAuthProviderTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && hasMetadataCompat(FrontMcpAuthProviderTokens.type, ctor as object)) {
          return true;
        }
      }
      if (obj['useFactory'] && frontMcpAuthProviderMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
    }
    return false;
  },
  { message: 'auth providers items must be annotated with @AuthProvider() | @FrontMcpAuthProvider().' },
);

export const annotatedFrontMcpPluginsSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function' && hasMetadataCompat(FrontMcpPluginTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && hasMetadataCompat(FrontMcpPluginTokens.type, ctor as object)) {
          return true;
        }
      }
      if (obj['useFactory'] && frontMcpPluginMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
      const provide = obj['provide'];
      if (obj['useFactory'] && typeof provide === 'function' && hasMetadataCompat(FrontMcpPluginTokens.type, provide)) {
        return true;
      }
    }
    return false;
  },
  { message: 'plugins items must be annotated with @Plugin() | @FrontMcpPlugin().' },
);

export const annotatedFrontMcpAdaptersSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function' && hasMetadataCompat(FrontMcpAdapterTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && hasMetadataCompat(FrontMcpAdapterTokens.type, ctor as object)) {
          return true;
        }
      }
      if (obj['useFactory'] && frontMcpAdapterMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
    }
    return false;
  },
  { message: 'adapters items must be annotated with @Adapter() | @FrontMcpAdapter().' },
);

export const annotatedFrontMcpToolsSchema = z.custom<AnnotatedClass | string | ToolEsmTargetRecord | ToolRemoteRecord>(
  (v): v is AnnotatedClass | string | ToolEsmTargetRecord | ToolRemoteRecord => {
    // ESM package specifier string (e.g., '@acme/tools@^1.0.0')
    if (typeof v === 'string') {
      return isPackageSpecifier(v);
    }
    if (isExternalEntryRecord(v)) {
      return true;
    }
    return (
      typeof v === 'function' &&
      (hasMetadataCompat(FrontMcpToolTokens.type, v) || v[FrontMcpToolTokens.type] !== undefined)
    );
  },
  {
    message:
      'tools items must be annotated with @Tool() | @FrontMcpTool(), be a package specifier string, or come from Tool.esm() | Tool.remote().',
  },
);

export const annotatedFrontMcpResourcesSchema = z.custom<
  AnnotatedClass | ResourceEsmTargetRecord | ResourceRemoteRecord
>(
  (v): v is AnnotatedClass | ResourceEsmTargetRecord | ResourceRemoteRecord => {
    if (isExternalEntryRecord(v)) {
      return true;
    }
    return (
      typeof v === 'function' &&
      // Class-based @Resource decorator
      (hasMetadataCompat(FrontMcpResourceTokens.type, v) ||
        // Class-based @ResourceTemplate decorator
        hasMetadataCompat(FrontMcpResourceTemplateTokens.type, v) ||
        // Function-style resource() builder
        v[FrontMcpResourceTokens.type] !== undefined ||
        // Function-style resourceTemplate() builder
        v[FrontMcpResourceTemplateTokens.type] !== undefined)
    );
  },
  {
    message:
      'resources items must be annotated with @Resource() | @ResourceTemplate(), use resource() | resourceTemplate() builders, or come from Resource.esm() | Resource.remote().',
  },
);

export const annotatedFrontMcpPromptsSchema = z.custom<AnnotatedClass | PromptEsmTargetRecord | PromptRemoteRecord>(
  (v): v is AnnotatedClass | PromptEsmTargetRecord | PromptRemoteRecord => {
    if (isExternalEntryRecord(v)) {
      return true;
    }
    return (
      typeof v === 'function' &&
      // Class-based @Prompt decorator
      (hasMetadataCompat(FrontMcpPromptTokens.type, v) ||
        // Function-style prompt() builder
        v[FrontMcpPromptTokens.type] !== undefined)
    );
  },
  {
    message:
      'prompts items must be annotated with @Prompt() | @FrontMcpPrompt(), use prompt() builder, or come from Prompt.esm() | Prompt.remote().',
  },
);

export const annotatedFrontMcpLoggerSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => typeof v === 'function' && hasMetadataCompat(FrontMcpLogTransportTokens.type, v),
  { message: 'logger items must be annotated with @Logger() | @FrontMcpLogger().' },
);

export const annotatedFrontMcpAgentsSchema = z.custom<AgentType>(
  (v): v is AgentType => {
    // ESM package specifier string (e.g., '@acme/agents@^1.0.0')
    if (typeof v === 'string') {
      return isPackageSpecifier(v);
    }
    // Check for class-based @Agent decorator
    if (typeof v === 'function') {
      if (hasMetadataCompat(FrontMcpAgentTokens.type, v)) {
        return true;
      }
      // Check for function-style agent() builder
      if (v[FrontMcpAgentTokens.type] !== undefined) {
        return true;
      }
      // For backwards compatibility, allow any function for now
      return true;
    }
    if (isExternalEntryRecord(v)) {
      return true;
    }
    // Check for object-based configuration
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      // Check for useValue pattern
      if (obj['useValue'] && typeof obj['useValue'] === 'object') {
        return true;
      }
      // Check for useFactory pattern
      if (obj['useFactory'] && typeof obj['useFactory'] === 'function') {
        return true;
      }
    }
    return false;
  },
  {
    message:
      'agents items must be annotated with @Agent() | @FrontMcpAgent(), use agent() builder, be a package specifier string, or come from Agent.esm() | Agent.remote().',
  },
);

export const annotatedFrontMcpJobsSchema = z.custom<AnnotatedClass | JobEsmTargetRecord | JobRemoteRecord>(
  (v): v is AnnotatedClass | JobEsmTargetRecord | JobRemoteRecord => {
    if (isExternalEntryRecord(v)) {
      return true;
    }
    if (typeof v === 'function') {
      if (hasMetadataCompat(FrontMcpJobTokens.type, v)) {
        return true;
      }
      // Function-style job() builder
      if (v[FrontMcpJobTokens.type] !== undefined) {
        return true;
      }
    }
    return false;
  },
  {
    message:
      'jobs items must be annotated with @Job() | @FrontMcpJob(), use job() builder, or come from Job.esm() | Job.remote().',
  },
);

export const annotatedFrontMcpWorkflowsSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function') {
      if (hasMetadataCompat(FrontMcpWorkflowTokens.type, v)) {
        return true;
      }
      // Function-style workflow() builder
      if (v[FrontMcpWorkflowTokens.type] !== undefined) {
        return true;
      }
    }
    return false;
  },
  { message: 'workflows items must be annotated with @Workflow() | @FrontMcpWorkflow() or use workflow() builder.' },
);

export const annotatedFrontMcpSkillsSchema = z.custom<AnnotatedClass | SkillEsmTargetRecord | SkillRemoteRecord>(
  (v): v is AnnotatedClass | SkillEsmTargetRecord | SkillRemoteRecord => {
    if (isExternalEntryRecord(v)) {
      return true;
    }
    // Check for class-based @Skill decorator
    if (typeof v === 'function') {
      if (hasMetadataCompat(FrontMcpSkillTokens.type, v)) {
        return true;
      }
      // Check for function-style skill() builder
      if (v[FrontMcpSkillTokens.type] !== undefined) {
        return true;
      }
    }
    // Check for object-based skill configuration (SkillValueRecord or SkillFileRecord)
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const kind = obj['kind'];
      // SkillValueRecord has kind: 'VALUE', SkillFileRecord has kind: 'FILE'
      // Both have metadata with name
      if (
        (kind === 'VALUE' || kind === 'FILE') &&
        obj['metadata'] &&
        typeof (obj['metadata'] as Record<string, unknown>)['name'] === 'string'
      ) {
        return true;
      }
    }
    return false;
  },
  {
    message:
      'skills items must be annotated with @Skill() | @FrontMcpSkill(), use skill() builder, or come from Skill.esm() | Skill.remote().',
  },
);

export const annotatedFrontMcpChannelsSchema = z.custom<AnnotatedClass>(
  (v): v is AnnotatedClass => {
    if (typeof v === 'function') {
      if (hasMetadataCompat(FrontMcpChannelTokens.type, v)) {
        return true;
      }
      // Function-style channel() builder
      if ((v as unknown as Record<symbol, unknown>)[FrontMcpChannelTokens.type] !== undefined) {
        return true;
      }
    }
    return false;
  },
  { message: 'channels items must be annotated with @Channel() or use channel() builder.' },
);
