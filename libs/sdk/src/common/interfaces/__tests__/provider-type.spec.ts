import 'reflect-metadata';

import { ProviderKind } from '@frontmcp/di';

import { DependencyCycleError } from '../../../errors';
import ProviderRegistry from '../../../provider/provider.registry';
import { normalizeProvider } from '../../../provider/provider.utils';
import { Plugin } from '../../decorators/plugin.decorator';
import { Provider } from '../../decorators/provider.decorator';
import { ProviderScope } from '../../metadata';
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

  it('take a factory without a name, as the decorators do', () => {
    expect(() => {
      @Plugin({ name: 'unnamed-factory', providers: [{ provide: GREETING, useFactory: () => 'hello' }] })
      class UnnamedFactoryPlugin {}
      return UnnamedFactoryPlugin;
    }).not.toThrow();
  });
});

describe('a provider without a name', () => {
  @Provider()
  class Clock {}

  @Provider({ scope: ProviderScope.CONTEXT })
  class Counter {}

  @Provider({ name: 'named-clock' })
  class NamedClock {}

  it.each([
    [
      'a symbol token, from its description',
      { provide: Symbol('api-url'), useValue: 'https://api.example.com' },
      'api-url',
    ],
    ['a string token, from the string', { provide: 'greeting', useFactory: () => 'hello' }, 'greeting'],
    ['a class token, from the class name', { provide: Punctuation, useClass: Punctuation }, 'Punctuation'],
  ])('is named from %s', (_case, provider: ProviderType, name) => {
    expect(annotatedFrontMcpProvidersSchema.safeParse(provider).success).toBe(true);
    expect(normalizeProvider(provider).metadata.name).toBe(name);
  });

  it('is named from its class when @Provider() names none', () => {
    expect(normalizeProvider(Clock).metadata.name).toBe('Clock');
    expect(normalizeProvider(Counter).metadata).toMatchObject({ name: 'Counter', scope: ProviderScope.CONTEXT });
  });

  it('keeps the name it is given', () => {
    expect(normalizeProvider(NamedClock).metadata.name).toBe('named-clock');
    expect(normalizeProvider({ name: 'api', provide: Symbol('api-url'), useValue: 'x' }).metadata.name).toBe('api');
  });

  it('names its symbol token by its description in a dependency cycle', () => {
    const alpha = Symbol('alpha');
    const beta = Symbol('beta');
    const building = () =>
      new ProviderRegistry([
        { provide: alpha, inject: () => [beta], useFactory: (dependency: unknown) => dependency },
        { provide: beta, inject: () => [alpha], useFactory: (dependency: unknown) => dependency },
      ]);

    expect(building).toThrow(new DependencyCycleError('alpha -> beta -> alpha'));
  });

  it('is still refused with an empty name', () => {
    expect(() => {
      @Provider({ name: '' })
      class EmptyName {}
      return EmptyName;
    }).toThrow();
  });
});
