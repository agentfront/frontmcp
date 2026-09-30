/**
 * `Plugin.init()` with no options (#647).
 *
 * The docs, the catalog and the plugin READMEs configure plugins whose options are all optional
 * as `ApprovalPlugin.init()` or `CodeCallPlugin.init()`, but `init` read `options.providers`
 * straight away and threw `Cannot read properties of undefined (reading 'providers')`.
 */
import 'reflect-metadata';

import { FrontMcpPlugin } from '../../decorators/plugin.decorator';
import { annotatedFrontMcpPluginsSchema } from '../../schemas/annotated-class.schema';
import { DynamicPlugin } from '../dynamic.plugin';

const LEVEL_TOKEN = Symbol('init-level');

interface LevelOptions {
  level?: string;
}

@FrontMcpPlugin({ name: 'init-without-options' })
class LevelPlugin extends DynamicPlugin<LevelOptions> {
  readonly options: LevelOptions;

  constructor(options: LevelOptions = {}) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: LevelOptions) {
    return [{ name: 'level', provide: LEVEL_TOKEN, useValue: options.level ?? 'default' }];
  }
}

describe('DynamicPlugin.init() without options', () => {
  it('builds the plugin record as init({}) does', () => {
    const record = LevelPlugin.init();

    expect(record).toMatchObject({ provide: LevelPlugin });
    expect((record as { useValue?: unknown }).useValue).toBeInstanceOf(LevelPlugin);
    expect((record as { providers?: { provide: unknown; useValue: unknown }[] }).providers).toEqual([
      expect.objectContaining({ provide: LEVEL_TOKEN, useValue: 'default' }),
    ]);
  });

  it('is accepted by the plugins schema', () => {
    expect(annotatedFrontMcpPluginsSchema.safeParse(LevelPlugin.init()).success).toBe(true);
  });
});
