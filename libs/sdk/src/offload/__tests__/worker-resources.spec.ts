import 'reflect-metadata';

import { Resource, resource, ResourceContext, ResourceTemplate } from '../../common';
import { InvalidOffloadCallError } from '../../errors/offload.errors';
import { ProviderNotAvailableError } from '../../errors/provider.errors';
import {
  isOffloadWorker,
  OFFLOAD_WORKER_MARKER,
  workerResourceKey,
  workerResourceReaders,
} from '../offload-worker.globals';
import { readInWorker } from '../read-in-worker';
import { registerWorkerResourceHandler, workerResourceSourceOf } from '../worker-resources';

class Token {}

@Resource({ name: 'reads-in-worker', uri: 'report://reads', worker: true })
class ReadsInWorker extends ResourceContext {
  async execute(uri: string) {
    this.logger.info('building', uri, { step: 1 });
    this.logger.child('nested').warn(new Error('careful'));
    return { uri, token: this.tryGet(Token) ?? 'none' };
  }
}

@ResourceTemplate({ name: 'responds-in-worker', uriTemplate: 'report://users/{id}', worker: { budgetMs: 500 } })
class RespondsInWorker extends ResourceContext<{ id: string }> {
  async execute(_uri: string, params: { id: string }): Promise<never> {
    if (params.id === 'fail') this.fail(new Error('no such user'));
    if (params.id === 'scope') return this.scope.metadata as never;
    if (params.id === 'get') return this.get(Token) as never;
    this.respond({ user: params.id });
  }
}

@Resource({ name: 'stays-inline', uri: 'report://inline' })
class StaysInline extends ResourceContext {
  async execute() {
    return 'inline';
  }
}

@Resource({ name: 'twin', uri: 'twin://static', worker: true })
class StaticTwin extends ResourceContext {
  async execute() {
    return 'static';
  }
}

@ResourceTemplate({ name: 'twin', uriTemplate: 'twin://{id}', worker: true })
class TemplateTwin extends ResourceContext<{ id: string }> {
  async execute() {
    return 'template';
  }
}

@Resource({ name: 'same', uri: 'same://one', worker: true })
class FirstSame extends ResourceContext {
  async execute() {
    return 'first';
  }
}

@Resource({ name: 'same', uri: 'same://one', worker: true })
class SecondSame extends ResourceContext {
  async execute() {
    return 'second';
  }
}

@Resource({ name: 'split', uri: 'a://b#c://d', worker: true })
class SplitName extends ResourceContext {
  async execute() {
    return 'split name';
  }
}

@Resource({ name: 'split#a://b', uri: 'c://d', worker: true })
class SplitUri extends ResourceContext {
  async execute() {
    return 'split uri';
  }
}

const HandlerResource = resource({ name: 'handler-report', uri: 'report://handler', worker: true })((uri, params) => ({
  contents: [{ uri, text: JSON.stringify(params) }],
}));

function readerOf(name: string, uri: string) {
  const reader = workerResourceReaders().get(workerResourceKey(__filename, name, uri));
  if (!reader) throw new Error(`no reader for ${name}`);
  return reader;
}

describe('worker: true resources', () => {
  it('records the module that declared each worker resource, and nothing for the others', () => {
    void HandlerResource;
    expect(workerResourceSourceOf(ReadsInWorker)).toEqual({
      file: __filename,
      name: 'reads-in-worker',
      key: workerResourceKey(__filename, 'reads-in-worker', 'report://reads'),
    });
    expect(workerResourceSourceOf(RespondsInWorker)).toEqual({
      file: __filename,
      name: 'responds-in-worker',
      key: workerResourceKey(__filename, 'responds-in-worker', 'report://users/{id}'),
    });
    expect(workerResourceSourceOf(StaysInline)).toBeUndefined();
    expect(workerResourceSourceOf('not a function')).toBeUndefined();
  });

  it('reads a class resource with no DI container, forwarding its log lines', async () => {
    const log = jest.fn();

    await expect(readerOf('reads-in-worker', 'report://reads').read('report://reads', {}, log)).resolves.toEqual({
      uri: 'report://reads',
      token: 'none',
    });
    expect(log).toHaveBeenCalledWith('info', 'building report://reads {"step":1}');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Error: careful'));
  });

  it('answers with what respond() sends, rethrows what fail() throws, and refuses this.get() and this.scope', async () => {
    const reader = readerOf('responds-in-worker', 'report://users/{id}');
    const log = jest.fn();

    await expect(reader.read('report://users/7', { id: '7' }, log)).resolves.toEqual({ user: '7' });
    await expect(reader.read('report://users/fail', { id: 'fail' }, log)).rejects.toThrow('no such user');
    await expect(reader.read('report://users/get', { id: 'get' }, log)).rejects.toBeInstanceOf(
      ProviderNotAvailableError,
    );
    await expect(reader.read('report://users/scope', { id: 'scope' }, log)).rejects.toThrow(
      /resource "responds-in-worker" reads in a worker thread \(worker: true\), which has no DI container/,
    );
  });

  it('reads the right one of two worker resources of one module that share a name', async () => {
    const keyOf = (target: unknown) => workerResourceSourceOf(target)?.key ?? '';
    const reader = (target: unknown) => workerResourceReaders().get(keyOf(target));

    expect(keyOf(StaticTwin)).not.toBe(keyOf(TemplateTwin));
    await expect(reader(StaticTwin)?.read('twin://static', {}, jest.fn())).resolves.toBe('static');
    await expect(reader(TemplateTwin)?.read('twin://7', { id: '7' }, jest.fn())).resolves.toBe('template');
  });

  it('keeps apart two worker resources whose name and URI only differ in where a # falls', async () => {
    const reader = (target: unknown) => workerResourceReaders().get(workerResourceSourceOf(target)?.key ?? '');

    await expect(reader(SplitName)?.read('a://b#c://d', {}, jest.fn())).resolves.toBe('split name');
    await expect(reader(SplitUri)?.read('c://d', {}, jest.fn())).resolves.toBe('split uri');
  });

  it('refuses to read either of two worker resources of one module with the same name and URI', async () => {
    const reader = (target: unknown) => workerResourceReaders().get(workerResourceSourceOf(target)?.key ?? '');

    for (const target of [FirstSame, SecondSame]) {
      await expect(reader(target)?.read('same://one', {}, jest.fn())).rejects.toThrow(
        /declares more than one worker resource named "same" for "same:\/\/one".*give each its own name/,
      );
    }
  });

  it('reads a function-style resource through its handler', async () => {
    await expect(
      readerOf('handler-report', 'report://handler').read('report://handler', { a: '1' }, jest.fn()),
    ).resolves.toEqual({
      contents: [{ uri: 'report://handler', text: '{"a":"1"}' }],
    });
  });

  it('keeps no reader when the module could not be found', () => {
    const handler = () => 'x';
    registerWorkerResourceHandler(handler, { name: 'nowhere', uri: 'report://nowhere' }, undefined);

    expect(workerResourceSourceOf(handler)).toMatchObject({ file: undefined, name: 'nowhere' });
    expect([...workerResourceReaders().keys()].some((key) => key.includes('"nowhere"'))).toBe(false);
  });

  it('refuses to read in a worker a resource whose module is unknown', () => {
    const handler = () => 'x';
    registerWorkerResourceHandler(handler, { name: 'lost', uri: 'report://lost' }, undefined);
    const context = new StaysInline({
      metadata: { name: 'lost', uri: 'report://lost' },
      uri: 'report://lost',
      params: {},
      providers: { get: jest.fn() } as never,
      logger: { child: () => ({}) } as never,
      authInfo: {},
    });

    expect(() => readInWorker(context, handler, true, 'report://lost', {})).toThrow(InvalidOffloadCallError);
    expect(() => readInWorker(context, StaysInline, true, 'report://lost', {})).toThrow(
      /resource "lost" sets worker, but the module that declares it was not found/,
    );
  });

  it('tells a worker thread of the pool from any other thread', () => {
    expect(isOffloadWorker()).toBe(false);
    Reflect.set(globalThis, OFFLOAD_WORKER_MARKER, true);
    try {
      expect(isOffloadWorker()).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, OFFLOAD_WORKER_MARKER);
    }
  });
});
