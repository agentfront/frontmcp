// common/types/options/skills-http/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from '@frontmcp/lazy-zod';

import type { SkillsConfigOptions as SkillsConfigOptionsInterface } from './interfaces';
import type { skillsConfigOptionsSchema } from './schema';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

type _SkillsSchemaInput = z.input<typeof skillsConfigOptionsSchema>;
type _SkillsInterfaceCheck = AssertTrue<IsAssignable<SkillsConfigOptionsInterface, _SkillsSchemaInput>>;

type _SchemaKeys = keyof _SkillsSchemaInput;
type _InterfaceKeys = keyof SkillsConfigOptionsInterface;
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

export {};
