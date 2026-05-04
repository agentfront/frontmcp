import { type Token } from '@frontmcp/di';

import { type PluginMetadata } from '../metadata';
import { type PluginRecord } from '../records';
import { BaseEntry } from './base.entry';

export abstract class PluginEntry extends BaseEntry<PluginRecord, unknown, PluginMetadata> {
  abstract get<T>(token: Token<T>): T;
}
