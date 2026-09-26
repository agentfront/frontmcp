import { type EntryOwnerRef } from '../../common';
import { hookOwnerIdOf } from '../lineage.utils';

const scopeOwner: EntryOwnerRef = { kind: 'scope', id: 'gateway', ref: Symbol('gateway') };
const appOwner: EntryOwnerRef = { kind: 'app', id: 'orders', ref: Symbol('orders') };
const adapterOwner: EntryOwnerRef = { kind: 'adapter', id: 'orders-api', ref: Symbol('orders-api') };
const pluginOwner: EntryOwnerRef = { kind: 'plugin', id: 'order-exports', ref: Symbol('order-exports') };

describe('hookOwnerIdOf', () => {
  it('returns the app anywhere in the lineage', () => {
    expect(hookOwnerIdOf([scopeOwner, appOwner, pluginOwner, adapterOwner])).toBe('orders');
  });

  it('finds the app in the entry owner when the lineage does not carry it', () => {
    expect(hookOwnerIdOf([scopeOwner], appOwner)).toBe('orders');
  });

  it('falls back to the entry owner when no app is in the lineage', () => {
    expect(hookOwnerIdOf([scopeOwner], pluginOwner)).toBe('order-exports');
  });

  it('falls back to the leaf of the lineage when no owner is given', () => {
    expect(hookOwnerIdOf([scopeOwner, pluginOwner])).toBe('order-exports');
  });

  it('returns undefined for an empty lineage and no owner', () => {
    expect(hookOwnerIdOf([])).toBeUndefined();
  });
});
