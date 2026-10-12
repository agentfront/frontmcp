// common/types/options/registry/typecheck.ts

import type { z } from '@frontmcp/lazy-zod';

import type { McpRegistryOptionsInterface, McpRegistryRepositoryInterface } from './interfaces';
import type { mcpRegistryOptionsSchema, mcpRegistryRepositorySchema } from './schema';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;
type HasSameKeys<T, U> = [Exclude<keyof T, keyof U>, Exclude<keyof U, keyof T>] extends [never, never] ? true : false;

type _RepositorySchemaInput = z.input<typeof mcpRegistryRepositorySchema>;
type _RepositoryCheck = AssertTrue<IsAssignable<McpRegistryRepositoryInterface, _RepositorySchemaInput>>;
type _RepositoryReverseCheck = AssertTrue<IsAssignable<_RepositorySchemaInput, McpRegistryRepositoryInterface>>;
type _RepositoryKeysCheck = AssertTrue<HasSameKeys<McpRegistryRepositoryInterface, _RepositorySchemaInput>>;

type _RegistrySchemaInput = z.input<typeof mcpRegistryOptionsSchema>;
type _RegistryCheck = AssertTrue<IsAssignable<McpRegistryOptionsInterface, _RegistrySchemaInput>>;
type _RegistryReverseCheck = AssertTrue<IsAssignable<_RegistrySchemaInput, McpRegistryOptionsInterface>>;
type _RegistryKeysCheck = AssertTrue<HasSameKeys<McpRegistryOptionsInterface, _RegistrySchemaInput>>;

export {};
