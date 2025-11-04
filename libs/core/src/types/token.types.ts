import { Type } from '@frontmcp/sdk';

export type Ctor<T> = new (...args: any[]) => T;
