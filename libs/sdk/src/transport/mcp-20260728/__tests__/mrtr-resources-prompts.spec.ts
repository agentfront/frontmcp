import 'reflect-metadata';

import type { InputRequests } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Prompt, PromptContext, ResourceContext, ResourceTemplate } from '../../../common';
import { InputRequiredSignal } from '../../../errors';

const INPUT_REQUESTS: InputRequests = {
  confirm: {
    method: 'elicitation/create',
    params: { message: 'Proceed?', requestedSchema: { type: 'object', properties: {} } },
  },
};
const REQUEST_STATE = 'opaque-request-state';

@ResourceTemplate({ name: 'report', uriTemplate: 'reports://{id}', mimeType: 'text/plain' })
class ReportResource extends ResourceContext<{ id: string }> {
  async execute(): Promise<never> {
    throw new InputRequiredSignal(INPUT_REQUESTS, REQUEST_STATE);
  }
}

@Prompt({ name: 'confirm_prompt', arguments: [] })
class ConfirmPrompt extends PromptContext {
  async execute(): Promise<never> {
    throw new InputRequiredSignal(INPUT_REQUESTS, REQUEST_STATE);
  }
}

@ResourceTemplate({ name: 'archive', uriTemplate: 'archive://{id}', mimeType: 'text/plain' })
class ArchiveResource extends ResourceContext<{ id: string }> {
  async execute(): Promise<never> {
    this.fail(new InputRequiredSignal(INPUT_REQUESTS, REQUEST_STATE));
  }
}

@Prompt({ name: 'confirm_through_fail', arguments: [] })
class ConfirmThroughFailPrompt extends PromptContext {
  async execute(): Promise<never> {
    this.fail(new InputRequiredSignal(INPUT_REQUESTS, REQUEST_STATE));
  }
}

@App({
  id: 'mrtr',
  name: 'mrtr',
  resources: [ReportResource, ArchiveResource],
  prompts: [ConfirmPrompt, ConfirmThroughFailPrompt],
})
class MrtrApp {}

describe('MRTR on resources/read and prompts/get (2026-07-28)', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'mrtr-entries', version: '1.0.0' }, apps: [MrtrApp] });
  });

  const expectedResult = { resultType: 'input_required', inputRequests: INPUT_REQUESTS, requestState: REQUEST_STATE };

  it('answers a resource that needs input with an input_required result', async () => {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'reports://1' });

    expect(message.error).toBeUndefined();
    expect(message.result).toMatchObject(expectedResult);
  });

  it('answers a resource that asks for input through this.fail() with an input_required result', async () => {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'archive://1' });

    expect(message.error).toBeUndefined();
    expect(message.result).toMatchObject(expectedResult);
  });

  it('answers a prompt that asks for input through this.fail() with an input_required result', async () => {
    const { message } = await rpc20260728(server.handler, 'prompts/get', {
      name: 'confirm_through_fail',
      arguments: {},
    });

    expect(message.error).toBeUndefined();
    expect(message.result).toMatchObject(expectedResult);
  });

  it('answers a prompt that needs input with an input_required result', async () => {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'confirm_prompt', arguments: {} });

    expect(message.error).toBeUndefined();
    expect(message.result).toMatchObject(expectedResult);
  });
});
