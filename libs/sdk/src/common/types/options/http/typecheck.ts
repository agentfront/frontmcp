// common/types/options/http/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from 'zod';
import type { httpOptionsSchema } from './schema';
import type { HttpOptionsInterface } from './interfaces';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

type _HttpSchemaInput = z.input<typeof httpOptionsSchema>;
type _HttpInterfaceCheck = AssertTrue<IsAssignable<HttpOptionsInterface, _HttpSchemaInput>>;

type _SchemaKeys = keyof _HttpSchemaInput;
type _InterfaceKeys = keyof HttpOptionsInterface;
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

export {};
