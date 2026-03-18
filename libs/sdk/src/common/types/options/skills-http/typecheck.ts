// common/types/options/skills-http/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from 'zod';
import type { skillsConfigOptionsSchema } from './schema';
import type { SkillsConfigOptions as SkillsConfigOptionsInterface } from './interfaces';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

type _SkillsSchemaInput = z.input<typeof skillsConfigOptionsSchema>;
type _SkillsInterfaceCheck = AssertTrue<IsAssignable<SkillsConfigOptionsInterface, _SkillsSchemaInput>>;

type _SchemaKeys = keyof _SkillsSchemaInput;
type _InterfaceKeys = keyof SkillsConfigOptionsInterface;
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

export {};
