import { Type } from '../interfaces';
import { z } from 'zod';
import {
  FrontMcpAdapterTokens,
  FrontMcpAuthProviderTokens,
  FrontMcpLocalAppTokens,
  FrontMcpLogTransportTokens,
  FrontMcpPluginTokens,
  FrontMcpPromptTokens,
  FrontMcpProviderTokens,
  FrontMcpResourceTokens,
  FrontMcpResourceTemplateTokens,
  FrontMcpToolTokens,
} from '../tokens';
import {
  frontMcpAdapterMetadataSchema,
  frontMcpAuthProviderMetadataSchema,
  frontMcpPluginMetadataSchema,
  frontMcpProviderMetadataSchema,
} from '../metadata';

export const annotatedFrontMcpAppSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpLocalAppTokens.type, v),
  { message: 'apps items must be annotated with @App() | @FrontMcpApp().' },
);

export const annotatedFrontMcpProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      (typeof v === 'function' && Reflect.hasMetadata(FrontMcpProviderTokens.type, v)) ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpProviderTokens.type, v.useValue.constructor)) ||
      (v['useFactory'] && frontMcpProviderMetadataSchema.passthrough().safeParse(v).success)
    );
  },
  { message: 'plugins items must be annotated with @Provider() | @FrontMcpProvider().' },
);

export const annotatedFrontMcpAuthProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      (typeof v === 'function' && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, v)) ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, v.useValue.constructor)) ||
      (v['useFactory'] && frontMcpAuthProviderMetadataSchema.passthrough().safeParse(v).success)
    );
  },
  { message: 'plugins items must be annotated with @AuthProvider() | @FrontMcpAuthProvider().' },
);

export const annotatedFrontMcpPluginsSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      (typeof v === 'function' && Reflect.hasMetadata(FrontMcpPluginTokens.type, v)) ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpPluginTokens.type, v.useValue.constructor)) ||
      (v['useFactory'] && frontMcpPluginMetadataSchema.passthrough().safeParse(v).success)
    );
  },
  { message: 'plugins items must be annotated with @Plugin() | @FrontMcpPlugin().' },
);

export const annotatedFrontMcpAdaptersSchema = z.custom<Type>(
  (v): v is Type => {
    return (
      (typeof v === 'function' && Reflect.hasMetadata(FrontMcpAdapterTokens.type, v)) ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpAdapterTokens.type, v.useValue.constructor)) ||
      (v['useFactory'] && frontMcpAdapterMetadataSchema.passthrough().safeParse(v).success)
    );
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
