import 'reflect-metadata';

import { type Token } from '@frontmcp/di';

import { createMockProviderRegistry } from '../../__test-utils__/mocks/provider-registry.mock';
import { type ProviderRegistryInterface } from '../../common';
import { FlowContextProviders } from '../flow-context-providers';

const GREETING: Token<string> = Symbol('greeting');

describe('FlowContextProviders.buildViews', () => {
  it('passes the session key, the pre-built providers and their source to the base registry', async () => {
    const baseBuildViews = jest.fn().mockResolvedValue({ global: new Map(), context: new Map() });
    const base = createMockProviderRegistry({ buildViews: baseBuildViews });
    const providers: ProviderRegistryInterface = new FlowContextProviders(base, new Map());
    const contextProviders = new Map<Token, unknown>([[GREETING, 'hello']]);

    await providers.buildViews('session-1', contextProviders, base);

    expect(baseBuildViews).toHaveBeenCalledWith('session-1', contextProviders, base);
  });
});
