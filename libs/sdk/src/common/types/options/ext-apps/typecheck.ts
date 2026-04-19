// common/types/options/ext-apps/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from '@frontmcp/lazy-zod';

import type { ExtAppsHostCapabilitiesInterface, ExtAppsOptionsInterface } from './interfaces';
import type { extAppsHostCapabilitiesSchema, extAppsOptionsSchema } from './schema';

type IsAssignable<T, U> = T extends U ? true : false;
type AssertTrue<T extends true> = T;

// Host capabilities checks
type _HostCapsSchemaInput = z.input<typeof extAppsHostCapabilitiesSchema>;
type _HostCapsCheck = AssertTrue<IsAssignable<ExtAppsHostCapabilitiesInterface, _HostCapsSchemaInput>>;

type _HostCapsSchemaKeys = keyof _HostCapsSchemaInput;
type _HostCapsInterfaceKeys = keyof ExtAppsHostCapabilitiesInterface;
type _HostCapsKeysMatch1 = AssertTrue<IsAssignable<_HostCapsSchemaKeys, _HostCapsInterfaceKeys>>;
type _HostCapsKeysMatch2 = AssertTrue<IsAssignable<_HostCapsInterfaceKeys, _HostCapsSchemaKeys>>;

// Ext-apps options checks
type _ExtAppsSchemaInput = z.input<typeof extAppsOptionsSchema>;
type _ExtAppsCheck = AssertTrue<IsAssignable<ExtAppsOptionsInterface, _ExtAppsSchemaInput>>;

type _ExtAppsSchemaKeys = keyof _ExtAppsSchemaInput;
type _ExtAppsInterfaceKeys = keyof ExtAppsOptionsInterface;
type _ExtAppsKeysMatch1 = AssertTrue<IsAssignable<_ExtAppsSchemaKeys, _ExtAppsInterfaceKeys>>;
type _ExtAppsKeysMatch2 = AssertTrue<IsAssignable<_ExtAppsInterfaceKeys, _ExtAppsSchemaKeys>>;

export {};
