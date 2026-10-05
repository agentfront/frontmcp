import 'reflect-metadata';

import { ProviderKind } from '@frontmcp/di';

import { InvalidDecoratorMetadataError } from '../../../errors';
import { normalizeProvider } from '../../../provider/provider.utils';
import { Plugin } from '../../decorators/plugin.decorator';
import { annotatedFrontMcpProvidersSchema } from '../../schemas/annotated-class.schema';
import { AsyncProvider, type ProviderType } from '../provider.interface';

const GREETING = Symbol('greeting');

class Punctuation {
  readonly mark = '!';
}

describe('ProviderType factory providers', () => {
  it('accept a factory without inject, which then receives no dependencies', () => {
    const provider: ProviderType = { name: 'greeting', provide: GREETING, useFactory: () => 'hello' };

    const record = normalizeProvider(provider);

    expect(annotatedFrontMcpProvidersSchema.safeParse(provider).success).toBe(true);
    expect(record.kind === ProviderKind.FACTORY && record.inject()).toEqual([]);
  });

  it('type the factory parameters from inject', () => {
    const provider = AsyncProvider({
      name: 'greeting',
      provide: GREETING,
      inject: () => [Punctuation] as const,
      // @ts-expect-error -- the parameter is the Punctuation instance inject() resolves
      useFactory: (punctuation) => `hello${punctuation.question}`,
    });

    expect(provider.inject?.()).toEqual([Punctuation]);
  });

  it('require a name, as the decorators do', () => {
    expect(() => {
      @Plugin({
        name: 'unnamed-factory',
        // @ts-expect-error -- a factory provider without `name` is refused at runtime
        providers: [{ provide: GREETING, inject: () => [], useFactory: () => 'hello' }],
      })
      class UnnamedFactoryPlugin {}
      return UnnamedFactoryPlugin;
    }).toThrow(InvalidDecoratorMetadataError);
  });
});
