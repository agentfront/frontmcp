import { Token } from '@frontmcp/di';
import { BaseEntry } from './base.entry';
import { PluginRecord } from '../records';
import { PluginMetadata } from '../metadata';

export abstract class PluginEntry extends BaseEntry<PluginRecord, unknown, PluginMetadata> {
  abstract get<T>(token: Token<T>): T;
}
