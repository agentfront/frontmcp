/**
 * `Adapter.init()` with no options (#660).
 *
 * `DynamicAdapter.init` read `options.name` straight away, so a call with no argument threw
 * `Cannot read properties of undefined (reading 'name')` instead of the error that names the
 * missing `name` option.
 */
import 'reflect-metadata';

import { DynamicAdapterNameError } from '../../../errors';
import { DynamicAdapter } from '../dynamic.adapter';

interface NamedOptions {
  name: string;
}

class NamelessInitAdapter extends DynamicAdapter<NamedOptions> {
  options: NamedOptions;

  constructor(options: NamedOptions) {
    super();
    this.options = options;
  }
}

describe('DynamicAdapter.init() without options', () => {
  it('throws the error that names the missing name option', () => {
    const init = NamelessInitAdapter.init as unknown as () => unknown;

    expect(() => init.call(NamelessInitAdapter)).toThrow(DynamicAdapterNameError);
    expect(() => init.call(NamelessInitAdapter)).toThrow(/requires a non-empty 'name' option/);
  });
});
