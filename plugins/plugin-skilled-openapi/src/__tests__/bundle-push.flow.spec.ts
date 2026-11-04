import 'reflect-metadata';

import { FlowControl, httpInputSchema, HttpJsonSchema, type FlowMetadata, type ScopeEntry } from '@frontmcp/sdk';

import BundlePushFlow, { BUNDLE_PUSH_PATH } from '../push/bundle-push.flow';
import { BundleSyncService } from '../sync/bundle-sync.service';

const metadata = {
  name: 'skilled-openapi:bundle-push',
  plan: { pre: ['verifyPushToken'], execute: [] },
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'POST', path: BUNDLE_PUSH_PATH },
} as unknown as FlowMetadata<'skilled-openapi:bundle-push'>;

const scope = {
  logger: { child: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }) },
} as unknown as ScopeEntry;

describe('BundlePushFlow', () => {
  it('passes the request on when the bundle source takes no pushes', async () => {
    const request = { method: 'POST', path: BUNDLE_PUSH_PATH, headers: { authorization: 'Bearer token' }, body: {} };
    const deps = new Map<unknown, unknown>([[BundleSyncService, { pushReceiver: undefined }]]);
    const flow = new BundlePushFlow(metadata, { request, response: {} }, scope, jest.fn(), deps as never);

    const outcome = await flow.verifyPushToken().catch((thrown: unknown) => thrown);

    expect(outcome).toBeInstanceOf(FlowControl);
    expect((outcome as FlowControl).type).toBe('next');
  });
});
