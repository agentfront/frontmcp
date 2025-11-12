import { Type } from '../common';

export type Ctor<T> = new (...args: any[]) => T;
