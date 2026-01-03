import { Token } from '@frontmcp/di';
import { BaseEntry } from './base.entry';
import { PluginRecord } from '../records';
import { PluginInterface } from '../interfaces';
import { PluginMetadata } from '../metadata';

export abstract class PluginEntry extends BaseEntry<PluginRecord, PluginInterface, PluginMetadata> {
  abstract get<T>(token: Token<T>): T;
}
