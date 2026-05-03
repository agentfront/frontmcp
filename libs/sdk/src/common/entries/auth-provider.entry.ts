import { type AuthProviderInterface } from '../interfaces';
import { type AuthProviderMetadata } from '../metadata';
import type { AuthProviderRecord } from '../records';
import { BaseEntry } from './base.entry';

export abstract class AuthProviderEntry extends BaseEntry<
  AuthProviderRecord,
  AuthProviderInterface,
  AuthProviderMetadata
> {}
