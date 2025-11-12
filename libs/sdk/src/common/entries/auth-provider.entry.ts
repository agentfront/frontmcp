import { BaseEntry } from './base.entry';
import { AuthProviderRecord } from '../records';
import { AuthProviderInterface } from '../interfaces';
import { AuthProviderMetadata } from '../metadata';


export abstract class AuthProviderEntry extends BaseEntry<AuthProviderRecord, AuthProviderInterface, AuthProviderMetadata> {


}