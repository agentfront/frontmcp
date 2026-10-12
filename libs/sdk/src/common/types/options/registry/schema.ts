// common/types/options/registry/schema.ts

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type { McpRegistryOptionsInterface, McpRegistryRepositoryInterface } from './interfaces';
import { REGISTRY_SERVER_NAME_PATTERN, toRegistryAuthRecord } from './utils';

export type { McpRegistryOptionsInterface, McpRegistryRepositoryInterface };

export const mcpRegistryRepositorySchema = z.object({
  url: z.url(),
  source: z.enum(['github', 'gitlab']),
  subfolder: z.string().min(1).optional(),
} satisfies RawZodShape<McpRegistryRepositoryInterface>);

export const mcpRegistryOptionsSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(200)
      .regex(REGISTRY_SERVER_NAME_PATTERN, {
        message: 'registry.name must be "<namespace>/<name>" in reverse-DNS form, e.g. "com.acme/weather"',
      })
      .optional(),
    description: z.string().min(1).max(100).optional(),
    repository: mcpRegistryRepositorySchema.optional(),
    publicKey: z
      .string()
      .refine((value) => toRegistryAuthRecord(value) !== undefined, {
        message: 'registry.publicKey must be a base64 Ed25519 public key or a "v=MCPv1; k=...; p=..." record',
      })
      .optional(),
    publicKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: 'registry.publicKeyEnv must be an environment variable name' })
      .optional(),
    serverCard: z.boolean().optional(),
    aiCatalog: z.boolean().optional(),
  } satisfies RawZodShape<McpRegistryOptionsInterface>)
  .refine((options) => options.name === undefined || options.description !== undefined, {
    message: 'registry.description is required when registry.name is set',
    path: ['description'],
  });

export type McpRegistryOptions = z.infer<typeof mcpRegistryOptionsSchema>;

export type McpRegistryOptionsInput = McpRegistryOptionsInterface;
