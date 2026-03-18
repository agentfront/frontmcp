// common/types/options/sqlite/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from 'zod';
import type { sqliteOptionsSchema } from './schema';
import type { SqliteOptionsInterface } from './interfaces';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

type _SqliteSchemaInput = z.input<typeof sqliteOptionsSchema>;
type _SqliteInterfaceCheck = AssertTrue<IsAssignable<SqliteOptionsInterface, _SqliteSchemaInput>>;

type _SchemaKeys = keyof _SqliteSchemaInput;
type _InterfaceKeys = keyof SqliteOptionsInterface;
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

export {};
