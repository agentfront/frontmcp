import { Type } from '@frontmcp/di';
import { AgentType } from '../interfaces';
import { z } from 'zod';
import {
  FrontMcpAdapterTokens,
  FrontMcpAgentTokens,
  FrontMcpAuthProviderTokens,
  FrontMcpLocalAppTokens,
  FrontMcpLogTransportTokens,
  FrontMcpPluginTokens,
  FrontMcpPromptTokens,
  FrontMcpProviderTokens,
  FrontMcpResourceTokens,
  FrontMcpResourceTemplateTokens,
  FrontMcpSkillTokens,
  FrontMcpToolTokens,
} from '../tokens';
import {
  frontMcpAdapterMetadataSchema,
  frontMcpAuthProviderMetadataSchema,
  frontMcpPluginMetadataSchema,
  frontMcpProviderMetadataSchema,
  frontMcpRemoteAppMetadataSchema,
} from '../metadata';

export const annotatedFrontMcpAppSchema = z.custom<Type>(
  (v): v is Type => {
    // Check for class-based @App() decorator
    if (typeof v === 'function' && Reflect.hasMetadata(FrontMcpLocalAppTokens.type, v)) {
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

export const annotatedFrontMcpProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    if (typeof v === 'function' && Reflect.hasMetadata(FrontMcpProviderTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && Reflect.hasMetadata(FrontMcpProviderTokens.type, ctor as object)) {
          return true;
        }
      }
      if (obj['useFactory'] && frontMcpProviderMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
    }
    return false;
  },
  { message: 'providers items must be annotated with @Provider() | @FrontMcpProvider().' },
);

export const annotatedFrontMcpAuthProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    if (typeof v === 'function' && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, ctor as object)) {
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

export const annotatedFrontMcpPluginsSchema = z.custom<Type>(
  (v): v is Type => {
    if (typeof v === 'function' && Reflect.hasMetadata(FrontMcpPluginTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && Reflect.hasMetadata(FrontMcpPluginTokens.type, ctor as object)) {
          return true;
        }
      }
      if (obj['useFactory'] && frontMcpPluginMetadataSchema.passthrough().safeParse(v).success) {
        return true;
      }
    }
    return false;
  },
  { message: 'plugins items must be annotated with @Plugin() | @FrontMcpPlugin().' },
);

export const annotatedFrontMcpAdaptersSchema = z.custom<Type>(
  (v): v is Type => {
    if (typeof v === 'function' && Reflect.hasMetadata(FrontMcpAdapterTokens.type, v)) {
      return true;
    }
    if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      const useValue = obj['useValue'];
      if (useValue && typeof useValue === 'object' && useValue !== null) {
        const ctor = (useValue as Record<string, unknown>)['constructor'];
        if (ctor && Reflect.hasMetadata(FrontMcpAdapterTokens.type, ctor as object)) {
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

export const annotatedFrontMcpToolsSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      typeof v === 'function' &&
      (Reflect.hasMetadata(FrontMcpToolTokens.type, v) || v[FrontMcpToolTokens.type] !== undefined)
    );
  },
  { message: 'tools items must be annotated with @Tool() | @FrontMcpTool().' },
);

export const annotatedFrontMcpResourcesSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      typeof v === 'function' &&
      // Class-based @Resource decorator
      (Reflect.hasMetadata(FrontMcpResourceTokens.type, v) ||
        // Class-based @ResourceTemplate decorator
        Reflect.hasMetadata(FrontMcpResourceTemplateTokens.type, v) ||
        // Function-style resource() builder
        v[FrontMcpResourceTokens.type] !== undefined ||
        // Function-style resourceTemplate() builder
        v[FrontMcpResourceTemplateTokens.type] !== undefined)
    );
  },
  {
    message:
      'resources items must be annotated with @Resource() | @ResourceTemplate() or use resource() | resourceTemplate() builders.',
  },
);

export const annotatedFrontMcpPromptsSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      typeof v === 'function' &&
      // Class-based @Prompt decorator
      (Reflect.hasMetadata(FrontMcpPromptTokens.type, v) ||
        // Function-style prompt() builder
        v[FrontMcpPromptTokens.type] !== undefined)
    );
  },
  { message: 'prompts items must be annotated with @Prompt() | @FrontMcpPrompt() or use prompt() builder.' },
);

export const annotatedFrontMcpLoggerSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpLogTransportTokens.type, v),
  { message: 'logger items must be annotated with @Logger() | @FrontMcpLogger().' },
);

export const annotatedFrontMcpAgentsSchema = z.custom<AgentType>(
  (v): v is AgentType => {
    // Check for class-based @Agent decorator
    if (typeof v === 'function') {
      if (Reflect.hasMetadata(FrontMcpAgentTokens.type, v)) {
        return true;
      }
      // Check for function-style agent() builder
      if (v[FrontMcpAgentTokens.type] !== undefined) {
        return true;
      }
      // For backwards compatibility, allow any function for now
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
  { message: 'agents items must be annotated with @Agent() | @FrontMcpAgent() or use agent() builder.' },
);

export const annotatedFrontMcpSkillsSchema = z.custom<Type>(
  (v): v is Type => {
    // Check for class-based @Skill decorator
    if (typeof v === 'function') {
      if (Reflect.hasMetadata(FrontMcpSkillTokens.type, v)) {
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
  { message: 'skills items must be annotated with @Skill() | @FrontMcpSkill() or use skill() builder.' },
);
