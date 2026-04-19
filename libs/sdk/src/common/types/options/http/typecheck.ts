// common/types/options/http/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from '@frontmcp/lazy-zod';

import type { HttpOptionsInterface } from './interfaces';
import type { httpOptionsSchema } from './schema';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

type _HttpSchemaInput = z.input<typeof httpOptionsSchema>;
type _HttpInterfaceCheck = AssertTrue<IsAssignable<HttpOptionsInterface, _HttpSchemaInput>>;

type _SchemaKeys = keyof _HttpSchemaInput;
type _InterfaceKeys = keyof HttpOptionsInterface;
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

export {};
