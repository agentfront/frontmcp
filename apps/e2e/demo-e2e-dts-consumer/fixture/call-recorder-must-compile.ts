import 'reflect-metadata';

import {
  App,
  CallRecorderPlugin,
  FrontMcp,
  type CallRecord,
  type CallRecorderPluginOptionsInput,
  type RecordedMethod,
} from '@frontmcp/sdk';

const methods: RecordedMethod[] = ['tools/call', 'prompts/get'];
const options: CallRecorderPluginOptionsInput = {
  path: '.frontmcp/calls.jsonl',
  methods,
  redactFields: ['ssn'],
  keepFields: ['key'],
  maxBytes: 1024 * 1024,
};

@App({ name: 'Shop', plugins: [CallRecorderPlugin.init(options)] })
export class ShopApp {}

@FrontMcp({ info: { name: 'shop', version: '1.0.0' }, apps: [ShopApp], plugins: [CallRecorderPlugin.init()] })
export class ShopServer {}

export function failedCalls(records: CallRecord[]): string[] {
  return records.flatMap((record) => (record.error ? [`${record.name}: ${record.error.code}`] : []));
}
