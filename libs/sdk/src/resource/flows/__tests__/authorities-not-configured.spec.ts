/**
 * A resource or resource template that declares `authorities` is never served while no authorities
 * engine is configured to check them: reading or subscribing is refused, saying what to configure,
 * and the lists leave it out.
 */
import 'reflect-metadata';

import { AuthorityDeniedError } from '@frontmcp/auth';

import { createMockScopeEntry } from '../../../__test-utils__';
import ReadResourceFlow from '../read-resource.flow';
import ResourceTemplatesListFlow from '../resource-templates-list.flow';
import ResourcesListFlow from '../resources-list.flow';
import SubscribeResourceFlow from '../subscribe-resource.flow';

const passThrough = { parse: (value: unknown) => value } as never;

/** A flow of `FlowClass` on a scope with no authorities engine, with `state` set. */
function makeFlow<FlowClass extends new (...args: never[]) => { state: { set(key: string, value: unknown): void } }>(
  FlowClass: FlowClass,
  flowName: string,
  state: Record<string, unknown>,
): InstanceType<FlowClass> {
  const metadata = { name: flowName, plan: { pre: [], execute: [], finalize: [] }, inputSchema: passThrough, outputSchema: passThrough, access: 'authorized' };
  const rawInput = { request: { method: 'resources/read', params: {} }, ctx: {} };
  const Constructor = FlowClass as unknown as new (...args: unknown[]) => InstanceType<FlowClass>;
  const flow = new Constructor(metadata, rawInput, createMockScopeEntry(), jest.fn(), new Map());
  for (const [key, value] of Object.entries(state)) flow.state.set(key, value);
  return flow;
}

const ADMIN_ONLY = { roles: { any: ['admin'] } };
const ledger = { name: 'ledger', fullName: 'books:ledger', metadata: { name: 'ledger', authorities: ADMIN_ONLY } };
const readme = { name: 'readme', fullName: 'books:readme', metadata: { name: 'readme' } };
const NOT_CONFIGURED = `Access denied to Resource "books:ledger": no authorities engine is configured (add 'authorities' to @FrontMcp())`;

describe('resource authorities with no engine configured to check them', () => {
  it('refuses to read a resource that declares authorities, saying what to configure', async () => {
    const flow = makeFlow(ReadResourceFlow, 'resources:read-resource', { resource: ledger, authInfo: {} });

    const check = flow.checkEntryAuthorities();

    await expect(check).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(check).rejects.toThrow(NOT_CONFIGURED);
  });

  it('still reads a resource that declares no authorities', async () => {
    const flow = makeFlow(ReadResourceFlow, 'resources:read-resource', { resource: readme, authInfo: {} });

    await expect(flow.checkEntryAuthorities()).resolves.toBeUndefined();
  });

  it('refuses to subscribe to a resource that declares authorities', async () => {
    const flow = makeFlow(SubscribeResourceFlow, 'resources:subscribe', { resource: ledger });

    await expect(flow.checkEntryAuthorities()).rejects.toThrow(NOT_CONFIGURED);
  });

  it('leaves the resources that declare authorities out of resources/list', async () => {
    const resources = [
      { ownerName: 'books', resource: ledger },
      { ownerName: 'books', resource: readme },
    ];
    const flow = makeFlow(ResourcesListFlow, 'resources:list-resources', { resources });

    await flow.filterByAuthorities();

    expect(flow.state.required.resources.map((item: { resource: { name: string } }) => item.resource.name)).toEqual([
      'readme',
    ]);
  });

  it('leaves the templates that declare authorities out of resources/templates/list', async () => {
    const templates = [
      { ownerName: 'books', template: ledger },
      { ownerName: 'books', template: readme },
    ];
    const flow = makeFlow(ResourceTemplatesListFlow, 'resources:list-resource-templates', { templates });

    await flow.filterByAuthorities();

    expect(flow.state.required.templates.map((item: { template: { name: string } }) => item.template.name)).toEqual([
      'readme',
    ]);
  });
});
